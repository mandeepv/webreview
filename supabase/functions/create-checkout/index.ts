// create-checkout — creates a Dodo Payments checkout session for a funnel
// session that already has a user (capture-email ran first).
//
// Money-path guarantees:
//   * refuses if the user already has an active Dodo entitlement (dup guard)
//   * threads { supabase_user_id, funnel_session_id, event_id } through Dodo
//     metadata — the webhook resolves the buyer with zero inference
//   * stores fbp/fbc/ip/ua so the webhook can fire a well-matched CAPI Purchase
//
// Secrets (supabase secrets set): DODO_API_KEY, DODO_ENV (test|live),
// DODO_PRODUCT_ANNUAL, DODO_PRODUCT_MONTHLY, SITE_URL,
// FUNNEL_PROXY_SECRET (required in live mode)

import { createClient } from 'npm:@supabase/supabase-js@2';
import { isFromProxy } from '../_shared/email.ts';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

const DODO_BASE =
  (Deno.env.get('DODO_ENV') ?? 'test') === 'live'
    ? 'https://live.dodopayments.com'
    : 'https://test.dodopayments.com';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!isFromProxy(req)) return json({ error: 'forbidden' }, 403);

  let body: {
    sessionId?: string;
    plan?: 'annual' | 'monthly';
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
  if (!body.sessionId) return json({ error: 'missing_session' }, 400);

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
  if (
    existing &&
    ['active', 'past_due', 'cancelled'].includes(existing.status) &&
    existing.current_period_end &&
    new Date(existing.current_period_end) > new Date()
  ) {
    return json({ error: 'already_subscribed' }, 409);
  }

  const productId =
    plan === 'monthly'
      ? Deno.env.get('DODO_PRODUCT_MONTHLY')
      : Deno.env.get('DODO_PRODUCT_ANNUAL');
  if (!productId) return json({ error: 'product_not_configured' }, 500);

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
    }),
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
  };
  const { error: saveError } = await admin
    .from('funnel_sessions')
    .update({ capi, updated_at: new Date().toISOString() })
    .eq('id', session.id);
  if (saveError) {
    // Non-fatal: checkout works, attribution degrades. Log loudly.
    console.error('capi save failed', saveError.message);
  }

  return json({ checkoutUrl: checkout.checkout_url, eventId });
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
