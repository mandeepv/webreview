// create-checkout — creates a Dodo Payments checkout session for a funnel
// session that already has a user (capture-email ran first).
//
// Money-path guarantees:
//   * refuses if the user already has an active Dodo entitlement (dup guard)
//   * reuses a recent checkout for the same funnel session + plan instead of
//     minting a second one, so a buyer who taps again while the webhook is
//     still landing can't pay twice (a Dodo session can only be paid once)
//   * locks the email on Dodo's checkout page: the entitlement lands on the
//     account for the email captured on /email, so that is what the buyer
//     must sign into the app with
//   * threads { supabase_user_id, funnel_session_id, event_id } through Dodo
//     metadata — the webhook resolves the buyer with zero inference
//   * stores fbp/fbc/ip/ua so the webhook can fire a well-matched CAPI Purchase
//
// Secrets (supabase secrets set): DODO_API_KEY, DODO_ENV (test|live),
// DODO_PRODUCT_ANNUAL, DODO_PRODUCT_MONTHLY, SITE_URL,
// FUNNEL_PROXY_SECRET (required in live mode)

import { createClient } from 'npm:@supabase/supabase-js@2';
import { isFromProxy } from '../_shared/email.ts';
import { DODO_BASE, fetchProductPrice } from '../_shared/dodo.ts';
import { alertOwner } from '../_shared/email.ts';
import { hasAccess } from '../_shared/entitlement.ts';
import { afterResponse, sendCapiEvent } from '../_shared/meta.ts';
import { isRateLimited } from '../_shared/ratelimit.ts';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How long a created-but-unpaid checkout is handed back instead of a new one. */
const REUSE_CHECKOUT_MS = 30 * 60 * 1000;

/**
 * Builds the function. Each handler owns its price check's cache and alert
 * latch (one per isolate in production; a fresh one per integration test, so
 * one test's cached price can't leak into the next).
 */
export function createHandler(priceGuard = new PriceGuard()): (req: Request) => Promise<Response> {
  return (req) => handle(req, priceGuard);
}

async function handle(req: Request, priceGuard: PriceGuard): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!isFromProxy(req)) return json({ error: 'forbidden' }, 403);

  let body: {
    sessionId?: string;
    plan?: 'annual' | 'monthly';
    displayedPrice?: number;
    meta?: { fbp?: string; fbc?: string };
    client_ip?: string;
    client_ua?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  const plan = body.plan === 'monthly' ? 'monthly' : 'annual';
  if (!body.sessionId || !UUID_RE.test(body.sessionId)) return json({ error: 'missing_session' }, 400);

  // Every call can create a Dodo session under our API key (P1-7).
  if (
    await isRateLimited(admin, [
      { key: `cc:ip:${body.client_ip ?? ''}`, windowSeconds: 60, max: 20 },
      { key: `cc:session:${body.sessionId}`, windowSeconds: 600, max: 10 },
    ])
  ) {
    return json({ error: 'rate_limited' }, 429);
  }

  const { data: session, error: sessionError } = await admin
    .from('funnel_sessions')
    .select('id, user_id, capi')
    .eq('id', body.sessionId)
    .maybeSingle();
  if (sessionError || !session?.user_id) {
    return json({ error: 'session_not_found' }, 404);
  }

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(
    session.user_id
  );
  if (userError || !userData?.user?.email) return json({ error: 'user_not_found' }, 404);
  const email = userData.user.email;

  // Duplicate-purchase guard: an already-active web subscriber must never be
  // charged twice from a re-run funnel.
  const { data: existing } = await admin
    .from('entitlements')
    .select('status, current_period_end')
    .eq('user_id', session.user_id)
    .eq('source', 'dodo')
    .maybeSingle();
  if (hasAccess(existing, new Date())) {
    return json({ error: 'already_subscribed' }, 409);
  }

  // Reuse a checkout created moments ago for this session + plan. Covers the
  // double-tap, the back button after paying, and a failed redirect to
  // /welcome: Dodo won't take a second payment on a completed session, so
  // the buyer can't be charged twice while the webhook is in flight.
  const prior = (session.capi as Record<string, string> | null) ?? {};
  if (
    prior.checkout_url &&
    prior.plan === plan &&
    prior.checkout_created_at &&
    Date.now() - new Date(prior.checkout_created_at).getTime() < REUSE_CHECKOUT_MS
  ) {
    return json({ checkoutUrl: prior.checkout_url, eventId: prior.event_id });
  }

  const productId =
    plan === 'monthly'
      ? Deno.env.get('DODO_PRODUCT_MONTHLY')
      : Deno.env.get('DODO_PRODUCT_ANNUAL');
  if (!productId) return json({ error: 'product_not_configured' }, 500);

  // The page's price comes from Vercel env vars; the charge comes from the
  // Dodo product. If they've drifted, charging would be billing a price the
  // buyer wasn't shown — refuse and tell the owner (P1-11).
  if (typeof body.displayedPrice === 'number') {
    const mismatch = await priceGuard.mismatch(productId, plan, body.displayedPrice);
    if (mismatch) return json({ error: 'price_mismatch' }, 409);
  }

  // One event_id for BOTH the browser Purchase pixel (returned to the client)
  // and the webhook's CAPI Purchase — Meta dedups the pair into one.
  const eventId = crypto.randomUUID();

  const checkoutRes = await fetch(`${DODO_BASE}/checkouts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('DODO_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: { email },
      return_url: `${Deno.env.get('SITE_URL') ?? ''}/welcome`,
      metadata: {
        supabase_user_id: session.user_id,
        funnel_session_id: session.id,
        event_id: eventId,
        plan,
      },
      // Apple Pay front and center for iOS Safari; credit/debit as the
      // required fallback per Dodo's docs.
      allowed_payment_method_types: ['credit', 'debit', 'apple_pay', 'google_pay'],
      // Dodo lets the buyer edit the email by default. An edited email would
      // get the receipt while the entitlement sits on the /email account.
      feature_flags: { allow_customer_editing_email: false },
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!checkoutRes.ok) {
    const detail = await checkoutRes.text().catch(() => '');
    console.error('dodo checkout create failed', checkoutRes.status, detail);
    return json({ error: 'checkout_failed' }, 502);
  }
  const checkout = (await checkoutRes.json()) as { session_id: string; checkout_url: string };

  // Persist CAPI match keys + event id for the webhook.
  const capi = {
    ...((session.capi as Record<string, string>) ?? {}),
    fbp: body.meta?.fbp ?? '',
    fbc: body.meta?.fbc ?? '',
    ip: body.client_ip ?? '',
    ua: body.client_ua ?? '',
    event_id: eventId,
    plan,
    checkout_url: checkout.checkout_url,
    checkout_created_at: new Date().toISOString(),
  };
  const { error: saveError } = await admin
    .from('funnel_sessions')
    .update({ capi, updated_at: new Date().toISOString() })
    .eq('id', session.id);
  if (saveError) {
    // Non-fatal: checkout works, attribution degrades. Log loudly.
    console.error('capi save failed', saveError.message);
  }

  // Server twin of the browser's InitiateCheckout pixel (P2-2). Only for a
  // newly created checkout — a reused one already sent it. The browser uses
  // the same `ic-<eventId>` id, so Meta keeps one of the pair.
  await afterResponse(
    sendCapiEvent({
      eventName: 'InitiateCheckout',
      eventId: `ic-${eventId}`,
      sourcePath: '/offer',
      user: {
        email,
        userId: session.user_id,
        fbp: capi.fbp,
        fbc: capi.fbc,
        ip: capi.ip,
        ua: capi.ua,
      },
      customData: {
        value: typeof body.displayedPrice === 'number' ? body.displayedPrice : Number(Deno.env.get(plan === 'monthly' ? 'PRICE_MONTHLY' : 'PRICE_ANNUAL') ?? 0),
        currency: 'USD',
      },
    })
  );

  return json({ checkoutUrl: checkout.checkout_url, eventId });
}

/**
 * Compares the price the page showed with the Dodo product's price. Dodo is
 * asked at most every 10 minutes per product, and the owner is alerted at
 * most once per guard.
 */
export class PriceGuard {
  private cache = new Map<string, { amount: number; currency: string; at: number }>();
  private alerted = false;

  async mismatch(productId: string, plan: string, displayed: number): Promise<boolean> {
    let price = this.cache.get(productId);
    if (!price || Date.now() - price.at > 10 * 60 * 1000) {
      const fresh = await fetchProductPrice(productId);
      if (!fresh) return false; // can't check → don't block the sale
      price = { ...fresh, at: Date.now() };
      this.cache.set(productId, price);
    }
    const mismatch = price.currency !== 'USD' || Math.abs(price.amount - displayed) > 0.005;
    if (mismatch && !this.alerted) {
      this.alerted = true;
      await alertOwner(
        'Checkout blocked: displayed price ≠ Dodo price',
        `The ${plan} plan shows $${displayed} on the site but Dodo product ${productId} charges ` +
          `${price.amount} ${price.currency}. Checkouts for this plan are refused until they match. ` +
          `Fix NEXT_PUBLIC_PRICE_${plan.toUpperCase()} in Vercel (and redeploy) or the Dodo product.`
      );
    }
    return mismatch;
  }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
