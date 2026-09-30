// dodo-webhook — the single writer of the entitlements table.
//
// Order of operations is load-bearing:
//   1. verify signature (Standard Webhooks spec) — reject anything unsigned
//   2. idempotency: first insert of webhook-id wins; replays return 200 no-op
//   3. resolve the user from metadata.supabase_user_id — NEVER by email
//      string matching (aliases/casing make that a false-link vector);
//      unresolvable purchases land in unlinked_purchases as an ALARM
//   4. map event → status; a full refund or a dispute revokes immediately
//      AND cancels the Dodo subscription, so nobody is re-billed for access
//      they no longer have
//   5. side effects (handoff email, Meta CAPI Purchase, PostHog) only after
//      the entitlement row is safely written, and only on first activation
//
// IMPORTANT: deploy with --no-verify-jwt (Dodo can't send a Supabase JWT):
//   supabase functions deploy dodo-webhook --no-verify-jwt
//
// Secrets: DODO_WEBHOOK_SECRET, DODO_API_KEY, DODO_ENV, RESEND_API_KEY,
// EMAIL_FROM, SUPPORT_EMAIL, ALERT_EMAIL (optional), SITE_URL, APP_STORE_URL,
// META_PIXEL_ID, META_CAPI_TOKEN, META_TEST_EVENT_CODE (optional, testing
// only), POSTHOG_KEY, POSTHOG_HOST, PRICE_ANNUAL, PRICE_MONTHLY

import { createClient } from 'npm:@supabase/supabase-js@2';
import { alertOwner, escapeHtml } from '../_shared/email.ts';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

const DODO_BASE =
  (Deno.env.get('DODO_ENV') ?? 'test') === 'live'
    ? 'https://live.dodopayments.com'
    : 'https://test.dodopayments.com';

// ── Payload shapes (the fields we read — Dodo SDK types are the reference) ──

type SubscriptionData = {
  subscription_id?: string;
  status?: string;
  product_id?: string;
  next_billing_date?: string;
  metadata?: Record<string, string>;
  customer?: { customer_id?: string; email?: string };
};

// Refunds and disputes carry NO subscription_id and NOT the checkout
// metadata (a refund's metadata is its own, set at refund time). What they
// do carry is payment_id — the only reliable path back to the subscription.
type RefundOrDisputeData = {
  payment_id?: string;
  is_partial?: boolean; // refunds only
  customer?: { customer_id?: string; email?: string }; // refunds only
};

// ── Standard Webhooks signature verification ────────────────────────────────

async function verifySignature(req: Request, rawBody: string): Promise<boolean> {
  const id = req.headers.get('webhook-id');
  const timestamp = req.headers.get('webhook-timestamp');
  const signatureHeader = req.headers.get('webhook-signature');
  const secret = Deno.env.get('DODO_WEBHOOK_SECRET');
  if (!id || !timestamp || !signatureHeader || !secret) return false;

  // Reject stale timestamps (>5 min) — standard replay protection.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  // Secret encoding: Standard Webhooks specifies a base64 secret after the
  // "whsec_" prefix, but the dashboard can also hand out a raw string. Trying
  // both costs one extra HMAC and removes a whole class of silent 401s that
  // would break entitlements without any obvious cause.
  const rawSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const candidates: Uint8Array[] = [];
  try {
    candidates.push(Uint8Array.from(atob(rawSecret), (c) => c.charCodeAt(0)));
  } catch {
    // Not valid base64 — the raw-bytes candidate below is the only option.
  }
  candidates.push(new TextEncoder().encode(rawSecret));

  const message = new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`);
  const expectedSignatures: string[] = [];
  for (const secretBytes of candidates) {
    const key = await crypto.subtle.importKey(
      'raw',
      secretBytes as BufferSource,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signed = await crypto.subtle.sign('HMAC', key, message as BufferSource);
    expectedSignatures.push(btoa(String.fromCharCode(...new Uint8Array(signed))));
  }

  // Header format: "v1,<base64> v1,<base64> ..." — any match passes.
  return signatureHeader
    .split(' ')
    .map((part) => part.split(',')[1] ?? '')
    .some((candidate) =>
      expectedSignatures.some((expected) => timingSafeEqual(candidate, expected))
    );
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Event → status mapping ──────────────────────────────────────────────────

const STATUS_BY_EVENT: Record<string, string> = {
  'subscription.active': 'active',
  'subscription.renewed': 'active',
  'subscription.plan_changed': 'active',
  'subscription.past_due': 'past_due',
  'subscription.on_hold': 'past_due', // still entitled until period end — never cut mid-period on a failed retry
  'subscription.cancelled': 'cancelled', // access continues until current_period_end (app + sweep enforce)
  'subscription.expired': 'expired',
  'subscription.failed': 'expired',
};

// Refund/dispute events that END access. Everything else in those families
// is informational: refund.failed means no money moved; dispute.won /
// .cancelled / .expired mean the money stayed with us; .challenged is our
// own response in progress.
const REVOKING_EVENTS = new Set([
  'refund.succeeded',
  'dispute.opened',
  'dispute.accepted',
  'dispute.lost',
]);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const rawBody = await req.text();
  if (!(await verifySignature(req, rawBody))) {
    console.error('webhook signature verification FAILED');
    return new Response('invalid signature', { status: 401 });
  }

  const webhookId = req.headers.get('webhook-id')!;
  let event: { type: string; data: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response('bad json', { status: 400 });
  }

  // Idempotency: first insert wins; a replay (unique violation) is a no-op.
  const { error: idempotencyError } = await admin
    .from('webhook_events')
    .insert({ id: webhookId, event_type: event.type });
  if (idempotencyError) {
    if (idempotencyError.code === '23505') return new Response('duplicate', { status: 200 });
    console.error('idempotency insert failed', idempotencyError.message);
    return new Response('storage error', { status: 500 }); // 500 → Dodo retries
  }

  try {
    if (event.type.startsWith('subscription.')) {
      await handleSubscription(event.type, event.data as SubscriptionData);
    } else if (event.type.startsWith('refund.') || event.type.startsWith('dispute.')) {
      await handleRefundOrDispute(event.type, event.data as RefundOrDisputeData);
    }
    // payment.* and everything else: acknowledged, no entitlement change —
    // subscription.* events are the entitlement truth.
    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error('webhook handling failed', event.type, err);
    // Surface as 500 so Dodo retries; idempotency row blocks double side
    // effects only for COMPLETED runs, so remove it to allow the retry.
    await admin.from('webhook_events').delete().eq('id', webhookId);
    return new Response('handler error', { status: 500 });
  }
});

async function handleSubscription(type: string, data: SubscriptionData) {
  const status = STATUS_BY_EVENT[type];
  if (!status) return; // updated / paused / unpaused / update_payment_method: no entitlement change in v1

  const userId = data.metadata?.supabase_user_id;

  if (!userId) {
    await parkUnlinked(data, data.subscription_id, `no supabase_user_id in metadata for ${type}`);
    return;
  }

  // A revoked entitlement (refund/chargeback) must never be resurrected by a
  // late-arriving or replayed lifecycle event.
  const { data: current } = await admin
    .from('entitlements')
    .select('status')
    .eq('user_id', userId)
    .eq('source', 'dodo')
    .maybeSingle();
  if (current?.status === 'revoked') return;

  const isFirstActivation = type === 'subscription.active' && current?.status !== 'active';

  const { error } = await admin.from('entitlements').upsert(
    {
      user_id: userId,
      source: 'dodo',
      status,
      product_id: data.product_id ?? 'unknown',
      dodo_customer_id: data.customer?.customer_id ?? null,
      dodo_subscription_id: data.subscription_id ?? null,
      current_period_end: data.next_billing_date ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,source' }
  );
  if (error) throw new Error(`entitlement upsert failed: ${error.message}`);

  await captureServerEvent(userId, `web_sub_${status}`, { event_type: type });

  if (isFirstActivation && data.metadata?.funnel_session_id) {
    await admin
      .from('funnel_sessions')
      .update({ purchased_at: new Date().toISOString() })
      .eq('id', data.metadata.funnel_session_id);
    // Side effects are best-effort: a failed email must not 500 the webhook
    // (that would retry the entitlement write it already made).
    await Promise.allSettled([
      sendHandoffEmail(data.customer?.email ?? ''),
      fireCapiPurchase(userId, data.customer?.email ?? '', data.metadata),
    ]);
  }
}

async function handleRefundOrDispute(type: string, data: RefundOrDisputeData) {
  const paymentId = data.payment_id;

  if (!REVOKING_EVENTS.has(type)) {
    if (type === 'dispute.won') {
      // Access was revoked (and the subscription cancelled) when the dispute
      // opened. Winning it doesn't undo that automatically — a human decides.
      await alertOwner(
        'Dispute won — decide whether to restore access',
        `Payment ${paymentId ?? '(unknown)'}: the dispute was won. Access was revoked and the ` +
          `subscription cancelled when it opened. If the customer should keep access, set their ` +
          `entitlements row back to 'active' in Supabase and contact them.`
      );
    }
    return;
  }

  if (type === 'refund.succeeded' && data.is_partial) {
    // A partial refund is a goodwill gesture, not "give me my money back" —
    // never cut access automatically for one.
    await alertOwner(
      'Partial refund issued — access left unchanged',
      `Payment ${paymentId ?? '(unknown)'} was partially refunded. Access and the subscription ` +
        `were NOT changed. Revoke manually if that was the intent.`
    );
    return;
  }

  const subscriptionId = paymentId ? await subscriptionIdForPayment(paymentId) : null;
  const customerId = data.customer?.customer_id;

  let query = admin
    .from('entitlements')
    .select('user_id, status, dodo_subscription_id')
    .eq('source', 'dodo');
  if (subscriptionId) {
    query = query.eq('dodo_subscription_id', subscriptionId);
  } else if (customerId) {
    query = query.eq('dodo_customer_id', customerId);
  } else {
    await parkUnlinked(data, null, `${type} for payment ${paymentId} resolved to no subscription`);
    return;
  }
  const { data: rows, error } = await query;
  if (error) throw new Error(`revocation lookup failed: ${error.message}`);
  if (!rows || rows.length === 0) {
    await parkUnlinked(data, subscriptionId, `${type} matched no entitlement`);
    return;
  }

  for (const row of rows) {
    // dispute.opened then dispute.lost both land here — act once.
    if (row.status === 'revoked') continue;
    const { error: updateError } = await admin
      .from('entitlements')
      .update({ status: 'revoked', updated_at: new Date().toISOString() })
      .eq('user_id', row.user_id)
      .eq('source', 'dodo');
    if (updateError) throw new Error(`revocation update failed: ${updateError.message}`);
    await captureServerEvent(row.user_id, 'web_sub_revoked', { event_type: type });
    // Stop billing. A refund doesn't cancel a Dodo subscription by itself —
    // without this the refunded customer is charged again at renewal, with
    // no access, which is a guaranteed chargeback.
    if (row.dodo_subscription_id) await cancelDodoSubscription(row.dodo_subscription_id, type);
  }
}

/** payment_id → subscription_id via the Dodo API. Throws on API failure so Dodo retries the webhook. */
async function subscriptionIdForPayment(paymentId: string): Promise<string | null> {
  const res = await fetch(`${DODO_BASE}/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${Deno.env.get('DODO_API_KEY')}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`payment lookup ${paymentId} failed: ${res.status}`);
  const payment = (await res.json()) as { subscription_id?: string | null };
  return payment.subscription_id ?? null;
}

async function cancelDodoSubscription(subscriptionId: string, reason: string): Promise<void> {
  const res = await fetch(`${DODO_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${Deno.env.get('DODO_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'cancelled' }),
  });
  if (!res.ok) {
    // Access is already revoked; the remaining risk is a future charge. A
    // human can cancel in the dashboard in ten seconds — make sure they know.
    const detail = await res.text().catch(() => '');
    await alertOwner(
      'Cancel this subscription manually',
      `After ${reason}, cancelling Dodo subscription ${subscriptionId} failed (${res.status}): ` +
        `${detail}\nCancel it in the Dodo dashboard so the customer is not billed again.`
    );
  }
}

async function parkUnlinked(data: unknown, subscriptionId: string | null | undefined, reason: string) {
  console.error('UNLINKED PURCHASE:', reason);
  await admin.from('unlinked_purchases').insert({
    dodo_subscription_id: subscriptionId ?? null,
    payload: data,
    reason,
  });
  await captureServerEvent('system', 'web_purchase_unlinked', { reason });
  // A row here can be a paying customer without access — a human must look.
  await alertOwner(
    'Unlinked purchase — check unlinked_purchases',
    `${reason}\n\nSee the unlinked_purchases table in Supabase (OPS_RUNBOOK §4).`
  );
}

// ── Side effects ─────────────────────────────────────────────────────────────

async function sendHandoffEmail(email: string) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey || !email) return;
  const appStoreUrl = Deno.env.get('APP_STORE_URL') ?? '';
  const siteUrl = Deno.env.get('SITE_URL') ?? '';
  const safeEmail = escapeHtml(email);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('EMAIL_FROM') ?? 'Kinderwell <hello@example.com>',
      // Replies go to a real inbox — this email explicitly invites them.
      reply_to: Deno.env.get('SUPPORT_EMAIL') ?? 'kinderwellteam@gmail.com',
      to: [email],
      subject: 'Welcome to Kinderwell — 2 steps to start',
      html: `
<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;color:#2E2E2E">
  <h1 style="font-size:22px">You're in. Two steps left.</h1>
  <p style="line-height:1.6"><strong>Step 1 — Download Kinderwell on your iPhone</strong></p>
  <p><a href="${appStoreUrl}" style="display:inline-block;background:#4F8F8B;color:#fff;padding:14px 28px;border-radius:14px;text-decoration:none;font-weight:600">Download on the App Store</a></p>
  <p style="line-height:1.6"><strong>Step 2 — Sign in with this email</strong></p>
  <ol style="line-height:1.6;padding-left:20px">
    <li>Open Kinderwell. At the bottom of the first screen, tap <strong>Sign in</strong>
    (next to "Already have an account?") — not <strong>Get started</strong>, which is for new users.</li>
    <li>Choose <strong>Continue with Email</strong> and enter <strong>${safeEmail}</strong>.
    We'll send a 6-digit code — no password needed. Your subscription unlocks automatically.</li>
  </ol>
  <p style="line-height:1.6;color:#6B6B6B;font-size:13px">
  Your receipt comes separately from Dodo Payments, our payment partner.
  To cancel or manage your subscription, go to <a href="${siteUrl}/manage">${siteUrl.replace(/^https?:\/\//, '')}/manage</a>
  and sign in with this email.
  See our <a href="${siteUrl}/legal/refunds">refund policy</a>
  · reply to this email for help.</p>
</div>`,
    }),
  });
  if (!res.ok) console.error('handoff email failed', res.status, await res.text().catch(() => ''));
}

async function fireCapiPurchase(userId: string, email: string, metadata: Record<string, string>) {
  const pixelId = Deno.env.get('META_PIXEL_ID');
  const token = Deno.env.get('META_CAPI_TOKEN');
  if (!pixelId || !token) return;

  // Match keys stored at checkout creation.
  const { data: session } = await admin
    .from('funnel_sessions')
    .select('capi')
    .eq('id', metadata.funnel_session_id ?? '')
    .maybeSingle();
  const capi = (session?.capi as Record<string, string>) ?? {};

  const value =
    metadata.plan === 'monthly'
      ? Number(Deno.env.get('PRICE_MONTHLY') ?? '12.99')
      : Number(Deno.env.get('PRICE_ANNUAL') ?? '59.99');

  const hashedEmail = email ? await sha256Hex(email.trim().toLowerCase()) : undefined;
  // Same hashed value the browser pixel sends (lib/meta.ts) — a stable,
  // cross-device match key that doesn't depend on cookies surviving.
  const externalId = await sha256Hex(userId);
  const testEventCode = Deno.env.get('META_TEST_EVENT_CODE');

  const res = await fetch(`https://graph.facebook.com/v21.0/${pixelId}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: token,
      // Set ONLY while verifying in Events Manager → Test events; remove after.
      ...(testEventCode ? { test_event_code: testEventCode } : {}),
      data: [
        {
          event_name: 'Purchase',
          event_time: Math.floor(Date.now() / 1000),
          // The PAID checkout's own id first. capi.event_id is the id of the
          // most recently CREATED checkout, which differs if the buyer opened
          // checkout more than once — and then the browser Purchase (fired
          // with the paid session's id) would not dedup against this one.
          event_id: metadata.event_id ?? capi.event_id,
          action_source: 'website',
          event_source_url: `${Deno.env.get('SITE_URL') ?? ''}/offer`,
          user_data: {
            ...(hashedEmail ? { em: [hashedEmail] } : {}),
            external_id: [externalId],
            ...(capi.fbp ? { fbp: capi.fbp } : {}),
            ...(capi.fbc ? { fbc: capi.fbc } : {}),
            ...(capi.ip ? { client_ip_address: capi.ip } : {}),
            ...(capi.ua ? { client_user_agent: capi.ua } : {}),
          },
          custom_data: { value, currency: 'USD' },
        },
      ],
    }),
  });
  if (!res.ok) console.error('CAPI purchase failed', res.status, await res.text().catch(() => ''));
}

async function captureServerEvent(
  distinctId: string,
  event: string,
  properties: Record<string, unknown>
) {
  // HOUSE INVARIANT: identify by Supabase user id only; no email to PostHog.
  const key = Deno.env.get('POSTHOG_KEY');
  if (!key) return;
  const host = Deno.env.get('POSTHOG_HOST') ?? 'https://us.i.posthog.com';
  await fetch(`${host}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key, event, distinct_id: distinctId, properties }),
  }).catch((err) => console.error('posthog capture failed', err));
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
