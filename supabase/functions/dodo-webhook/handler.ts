// dodo-webhook — the single writer of the entitlements table.
//
// Order of operations is load-bearing:
//   1. verify signature (Standard Webhooks spec) — reject anything unsigned
//   2. idempotency: first insert of webhook-id wins; a completed replay is a
//      200 no-op, a run that died mid-way can be reclaimed by a retry
//   3. resolve the user from metadata.supabase_user_id — NEVER by email
//      string matching (aliases/casing make that a false-link vector);
//      unresolvable purchases land in unlinked_purchases as an ALARM
//   4. decide the write with the pure state machine in _shared/entitlement.ts
//      (revoked guard, stale/duplicate subscriptions, period-end rules); a
//      full refund or a dispute revokes immediately AND cancels the Dodo
//      subscription, so nobody is re-billed for access they no longer have
//   5. side effects (handoff email, Meta CAPI Purchase, PostHog) only after
//      the entitlement row is safely written, and exactly once per Dodo
//      subscription whatever order Dodo delivers events in
//
// IMPORTANT: deploy with --no-verify-jwt (Dodo can't send a Supabase JWT):
//   supabase functions deploy dodo-webhook --no-verify-jwt
// Requires migration 20260930000000_webhook_hardening.sql — apply it first.
//
// Secrets: DODO_WEBHOOK_SECRET, DODO_API_KEY, DODO_ENV, RESEND_API_KEY,
// EMAIL_FROM, SUPPORT_EMAIL, ALERT_EMAIL (optional), SITE_URL, APP_STORE_URL,
// META_PIXEL_ID, META_CAPI_TOKEN, META_TEST_EVENT_CODE (optional, testing
// only), POSTHOG_KEY, POSTHOG_HOST, PRICE_ANNUAL, PRICE_MONTHLY

import { createClient } from 'npm:@supabase/supabase-js@2';
import { alertOwner, escapeHtml } from '../_shared/email.ts';
import { cancelDodoSubscription, DODO_BASE } from '../_shared/dodo.ts';
import { decideSubscriptionWrite, laterOf, STATUS_BY_EVENT } from '../_shared/entitlement.ts';
import { classifyRefundOrDispute, describePlan as describePlanFrom, PlanSummary } from '../_shared/payment_events.ts';
import { sendCapiEvent } from '../_shared/meta.ts';
import { profileFromAnswers } from '../_shared/profile.ts';
import { verifyStandardWebhook } from '../_shared/signature.ts';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

// ── Payload shapes (the fields we read — Dodo SDK types are the reference) ──

type SubscriptionData = {
  subscription_id?: string;
  status?: string;
  product_id?: string;
  next_billing_date?: string;
  recurring_pre_tax_amount?: number; // smallest currency unit
  currency?: string;
  tax_inclusive?: boolean;
  payment_frequency_interval?: string; // Day | Week | Month | Year
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

/** A run that has been 'processing' this long is presumed dead and may be reclaimed. */
const STALE_PROCESSING_MS = 2 * 60 * 1000;

/** The whole webhook. index.ts serves it; the integration tests call it directly. */
export async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const rawBody = await req.text();
  const signed = await verifyStandardWebhook({
    id: req.headers.get('webhook-id'),
    timestamp: req.headers.get('webhook-timestamp'),
    signatureHeader: req.headers.get('webhook-signature'),
    secret: Deno.env.get('DODO_WEBHOOK_SECRET'),
    rawBody,
  });
  if (!signed) {
    console.error('webhook signature verification FAILED');
    return new Response('invalid signature', { status: 401 });
  }

  const webhookId = req.headers.get('webhook-id')!;
  let event: { type: string; timestamp?: string; data: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response('bad json', { status: 400 });
  }

  const claim = await claimWebhook(webhookId, event.type);
  if (claim !== 'claimed') return claim;

  try {
    if (event.type.startsWith('subscription.')) {
      await handleSubscription(event.type, event.data as SubscriptionData, event.timestamp ?? null);
    } else if (event.type.startsWith('refund.') || event.type.startsWith('dispute.')) {
      await handleRefundOrDispute(event.type, event.data as RefundOrDisputeData);
    }
    // payment.* and everything else: acknowledged, no entitlement change —
    // subscription.* events are the entitlement truth.
    await admin.from('webhook_events').update({ status: 'done' }).eq('id', webhookId);
    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error('webhook handling failed', event.type, err);
    // Surface as 500 so Dodo retries, and free the idempotency row so the
    // retry is not answered as a duplicate.
    await admin.from('webhook_events').delete().eq('id', webhookId);
    return new Response('handler error', { status: 500 });
  }
}

/**
 * Idempotency (P2-10). The row is inserted as 'processing' and flipped to
 * 'done' only after the handler finishes, so:
 *   - a completed replay → 200 duplicate
 *   - a delivery racing an in-flight run → 500, Dodo retries later
 *   - a run killed mid-way (row stuck in 'processing') → reclaimed by the
 *     next retry after STALE_PROCESSING_MS instead of silently acknowledged
 */
async function claimWebhook(webhookId: string, eventType: string): Promise<'claimed' | Response> {
  const { error } = await admin
    .from('webhook_events')
    .insert({ id: webhookId, event_type: eventType, status: 'processing' });
  if (!error) return 'claimed';
  if (error.code !== '23505') {
    console.error('idempotency insert failed', error.message);
    return new Response('storage error', { status: 500 }); // 500 → Dodo retries
  }

  const { data: existing, error: readError } = await admin
    .from('webhook_events')
    .select('status, received_at')
    .eq('id', webhookId)
    .maybeSingle();
  if (readError) return new Response('storage error', { status: 500 });
  if (!existing || existing.status === 'done') return new Response('duplicate', { status: 200 });

  const cutoff = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
  const { data: reclaimed } = await admin
    .from('webhook_events')
    .update({ received_at: new Date().toISOString() })
    .eq('id', webhookId)
    .eq('status', 'processing')
    .lt('received_at', cutoff)
    .select('id');
  if (reclaimed && reclaimed.length > 0) return 'claimed';
  return new Response('in progress', { status: 500 });
}

async function handleSubscription(type: string, data: SubscriptionData, occurredAt: string | null, isRetry = false) {
  if (!STATUS_BY_EVENT[type]) return; // updated / paused / unpaused / update_payment_method: no entitlement change in v1

  const userId = data.metadata?.supabase_user_id;
  if (!userId) {
    await parkUnlinked(data, data.subscription_id, `no supabase_user_id in metadata for ${type}`);
    return;
  }

  // A failed read must NOT be treated as "no row" — that would bypass the
  // revoked guard and re-fire first-activation side effects (P2-3b).
  const { data: current, error: readError } = await admin
    .from('entitlements')
    .select('status, dodo_subscription_id, current_period_end, product_id, dodo_customer_id, cancel_pending, last_event_at')
    .eq('user_id', userId)
    .eq('source', 'dodo')
    .maybeSingle();
  if (readError) throw new Error(`entitlement read failed: ${readError.message}`);

  const decision = decideSubscriptionWrite(
    current,
    {
      type,
      subscriptionId: data.subscription_id ?? null,
      nextBillingDate: data.next_billing_date ?? null,
      plan: data.metadata?.plan,
      occurredAt,
    },
    new Date()
  );

  if (decision.kind === 'ignore') {
    console.log('subscription event ignored:', type, decision.reason);
    return;
  }

  if (decision.kind === 'duplicate') {
    // Two live subscriptions for one person (paid twice inside the webhook
    // latency window, or on two devices). Stop the newer one billing; the
    // owner refunds its first charge by hand (P1-3b). Act once, on the
    // activation event — the rest of its burst would only repeat the alert.
    if (type !== 'subscription.active' || !data.subscription_id) return;
    const cancelled = await cancelDodoSubscription(data.subscription_id, 'a duplicate purchase');
    await alertOwner(
      'Duplicate purchase — refund the newer subscription',
      `User ${userId}: ${decision.reason}.\n` +
        `The newer subscription ${data.subscription_id} was ${cancelled ? 'cancelled' : 'NOT cancelled (see the other alert)'} ` +
        `so it won't renew. Refund its first payment in the Dodo dashboard.`
    );
    return;
  }

  if (decision.replacesSubscription && current?.cancel_pending && current.dodo_subscription_id) {
    // The row is about to point at the new subscription, so the sweep will
    // stop retrying the old one's cancel. Hand it to a human instead.
    await alertOwner(
      'Cancel the previous subscription manually',
      `User ${userId} bought again, but cancelling their previous subscription ` +
        `${current.dodo_subscription_id} had not succeeded yet. Cancel it in the Dodo dashboard.`
    );
  }

  const { error } = await admin.from('entitlements').upsert(
    {
      user_id: userId,
      source: 'dodo',
      status: decision.status,
      product_id: data.product_id ?? current?.product_id ?? 'unknown',
      dodo_customer_id: data.customer?.customer_id ?? current?.dodo_customer_id ?? null,
      dodo_subscription_id: data.subscription_id ?? current?.dodo_subscription_id ?? null,
      current_period_end: decision.currentPeriodEnd,
      last_event_at: decision.replacesSubscription ? occurredAt : laterOf(current?.last_event_at, occurredAt),
      ...(decision.replacesSubscription ? { cancel_pending: false } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,source' }
  );
  if (error) {
    if (error.code === '23505' && !isRetry) {
      // Dodo sends the first-purchase burst concurrently. Two deliveries that
      // both read "no row" both INSERT; the upsert's ON CONFLICT covers
      // (user_id, source) but not the unique dodo_subscription_id, so the
      // second one fails here. The winner's row is committed by now: read it
      // and decide again instead of returning 500 and waiting for Dodo's
      // retry (caught by the W2b integration test).
      return handleSubscription(type, data, occurredAt, true);
    }
    if (error.code === '23503') {
      // Foreign-key violation: the auth user was deleted (account deletion
      // in the app cascades the entitlement away) but Dodo is still billing.
      // Retrying can never succeed — stop the billing and tell a human (P2-3).
      if (data.subscription_id) {
        await cancelDodoSubscription(data.subscription_id, `${type} for a deleted user`);
      }
      await alertOwner(
        'Subscription event for a deleted user',
        `${type} for subscription ${data.subscription_id ?? '(none)'} names user ${userId}, ` +
          `which no longer exists (account deleted?). The subscription was cancelled so they are ` +
          `not billed again. Check whether the last charge needs refunding.`
      );
      return;
    }
    throw new Error(`entitlement upsert failed: ${error.message}`);
  }

  if (decision.periodEndFallback) {
    await alertOwner(
      'Subscription event without next_billing_date',
      `${type} for ${data.subscription_id} (user ${userId}) had no next_billing_date. Access was ` +
        `set to ${decision.periodEndFallback} as a fallback. Check the subscription in Dodo.`
    );
  }

  await captureServerEvent(userId, `web_sub_${decision.status}`, { event_type: type });

  if (decision.status === 'active' && data.subscription_id) {
    await fireFirstActivation(userId, data.subscription_id, data);
  }
}

/**
 * First-activation side effects, exactly once per Dodo subscription (P0-2).
 * Dodo sends the first-purchase burst (active / renewed / updated /
 * payment.succeeded) concurrently and unordered, so "was the row active
 * before?" is not a safe test. Instead, a single conditional UPDATE claims
 * the activation; Postgres re-checks the WHERE under the row lock, so only
 * one concurrent run gets the row back.
 */
async function fireFirstActivation(userId: string, subscriptionId: string, data: SubscriptionData) {
  if (!/^[A-Za-z0-9_-]+$/.test(subscriptionId)) {
    console.error('unexpected subscription id format; activation skipped', subscriptionId);
    return;
  }
  const { data: claimed, error } = await admin
    .from('entitlements')
    .update({ activated_subscription_id: subscriptionId, activated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('source', 'dodo')
    .eq('dodo_subscription_id', subscriptionId)
    .or(`activated_subscription_id.is.null,activated_subscription_id.neq.${subscriptionId}`)
    .select('user_id');
  if (error) throw new Error(`activation claim failed: ${error.message}`);
  if (!claimed || claimed.length === 0) return; // another delivery already fired them

  const metadata = data.metadata ?? {};
  if (metadata.funnel_session_id) {
    await admin
      .from('funnel_sessions')
      .update({ purchased_at: new Date().toISOString() })
      .eq('id', metadata.funnel_session_id);
    await createAppProfile(userId, metadata.funnel_session_id);
  }

  // The account the entitlement is on is the Supabase user — that is the
  // email they must sign into the app with, whatever Dodo's copy says (P1-2).
  const { data: userData } = await admin.auth.admin.getUserById(userId);
  const accountEmail = userData?.user?.email ?? '';
  const checkoutEmail = data.customer?.email ?? '';
  if (accountEmail && checkoutEmail && accountEmail.toLowerCase() !== checkoutEmail.toLowerCase()) {
    await alertOwner(
      'Checkout email differs from account email',
      `User ${userId} paid (subscription ${subscriptionId}) with checkout email ${checkoutEmail}, ` +
        `but their account is ${accountEmail}. The welcome email went to both and names the ` +
        `account email. Watch for a "paid but locked out" support request.`
    );
  }

  const plan = describePlan(data);
  // Side effects are best-effort: a failed email must not 500 the webhook
  // (that would retry the entitlement write it already made).
  await Promise.allSettled([
    sendHandoffEmail(accountEmail || checkoutEmail, checkoutEmail, plan),
    fireCapiPurchase(userId, accountEmail || checkoutEmail, metadata, plan),
  ]);
}

/**
 * Gives a web buyer an app profile built from their quiz answers, so the iOS
 * app treats them as onboarded and skips its own questions (03-app-changes
 * §5). Runs once, at first activation — never at email capture: leads who
 * don't buy should still see the app's onboarding. INSERT ONLY: an existing
 * profile (an app user who later bought on the web) is never touched.
 * Best-effort — a failure here only means the buyer answers the app's
 * questions again, so it must not fail the webhook.
 */
async function createAppProfile(userId: string, funnelSessionId: string) {
  try {
    const { data: session } = await admin
      .from('funnel_sessions')
      .select('answers')
      .eq('id', funnelSessionId)
      .maybeSingle();
    const profile = profileFromAnswers(userId, session?.answers as Record<string, unknown> | null);
    if (!profile) return;
    const { data: inserted, error } = await admin
      .from('user_profiles')
      .upsert({ ...profile, updated_at: new Date().toISOString() }, { onConflict: 'id', ignoreDuplicates: true })
      .select('id');
    if (error) {
      console.error('app profile insert failed', error.message);
      return;
    }
    // The app's onboarding_completed fires only for app sign-ups; this is the
    // web buyer's equivalent.
    if (inserted && inserted.length > 0) await captureServerEvent(userId, 'web_profile_created', {});
  } catch (err) {
    console.error('app profile insert failed', err);
  }
}

function describePlan(data: SubscriptionData): PlanSummary {
  return describePlanFrom(data, {
    annual: Number(Deno.env.get('PRICE_ANNUAL') ?? '59.99'),
    monthly: Number(Deno.env.get('PRICE_MONTHLY') ?? '12.99'),
  });
}

async function handleRefundOrDispute(type: string, data: RefundOrDisputeData) {
  const paymentId = data.payment_id;
  const action = classifyRefundOrDispute(type, data.is_partial);

  if (action === 'ignore') return;

  if (action === 'alert_dispute_closed') {
    // Access was revoked (and the subscription cancelled) when the dispute
    // opened. Winning or withdrawal doesn't undo that — a human decides.
    await alertOwner(
      `Dispute closed (${type}) — decide whether to restore access`,
      `Payment ${paymentId ?? '(unknown)'}: ${type}. Access was revoked and the subscription ` +
        `cancelled when the dispute opened. If the customer should keep access, set their ` +
        `entitlements row back to 'active' in Supabase and contact them.`
    );
    return;
  }

  if (action === 'alert_partial_refund') {
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
  if (!subscriptionId) {
    // No guessing by customer id: with an edited checkout email that could
    // revoke a different account than the one refunded (P3-27).
    await parkUnlinked(data, null, `${type} for payment ${paymentId} resolved to no subscription`);
    return;
  }

  const { data: rows, error } = await admin
    .from('entitlements')
    .select('user_id, status, dodo_subscription_id, cancel_pending')
    .eq('source', 'dodo')
    .eq('dodo_subscription_id', subscriptionId);
  if (error) throw new Error(`revocation lookup failed: ${error.message}`);

  if (!rows || rows.length === 0) {
    // Usually a refund on an OLD subscription after the customer bought
    // again (the row now points at the new one). Nobody's current access
    // depends on it — just make sure it stops billing.
    const cancelled = await cancelDodoSubscription(subscriptionId, type);
    await alertOwner(
      `${type} on a subscription with no entitlement row`,
      `Payment ${paymentId} → subscription ${subscriptionId} matched no entitlement row, so no ` +
        `access was changed. The subscription was ${cancelled ? 'cancelled' : 'NOT cancelled'}. ` +
        `Check unlinked_purchases and the customer's current subscription.`
    );
    return;
  }

  for (const row of rows) {
    // dispute.opened then dispute.lost both land here — revoke once, but
    // keep retrying the cancel while it is still pending.
    if (row.status !== 'revoked') {
      const { error: updateError } = await admin
        .from('entitlements')
        .update({ status: 'revoked', cancel_pending: true, updated_at: new Date().toISOString() })
        .eq('user_id', row.user_id)
        .eq('source', 'dodo');
      if (updateError) throw new Error(`revocation update failed: ${updateError.message}`);
      await captureServerEvent(row.user_id, 'web_sub_revoked', { event_type: type });
    } else if (!row.cancel_pending) {
      continue;
    }
    // Stop billing. A refund doesn't cancel a Dodo subscription by itself —
    // without this the refunded customer is charged again at renewal, with
    // no access, which is a guaranteed chargeback. Never throws; on failure
    // cancel_pending stays true and winback-sweep retries hourly.
    if (await cancelDodoSubscription(subscriptionId, type)) {
      await admin
        .from('entitlements')
        .update({ cancel_pending: false })
        .eq('user_id', row.user_id)
        .eq('source', 'dodo');
    }
  }
}

/** payment_id → subscription_id via the Dodo API. Throws on API failure so Dodo retries the webhook. */
async function subscriptionIdForPayment(paymentId: string): Promise<string | null> {
  const res = await fetch(`${DODO_BASE}/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${Deno.env.get('DODO_API_KEY')}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`payment lookup ${paymentId} failed: ${res.status}`);
  const payment = (await res.json()) as { subscription_id?: string | null };
  return payment.subscription_id ?? null;
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

async function sendHandoffEmail(accountEmail: string, checkoutEmail: string, plan: PlanSummary) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey || !accountEmail) return;
  const appStoreUrl = Deno.env.get('APP_STORE_URL') ?? '';
  const siteUrl = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
  const manageLabel = `${siteUrl.replace(/^https?:\/\//, '')}/manage`;
  const safeEmail = escapeHtml(accountEmail);
  const recipients = [accountEmail];
  if (checkoutEmail && checkoutEmail.toLowerCase() !== accountEmail.toLowerCase()) {
    recipients.push(checkoutEmail);
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('EMAIL_FROM') ?? 'Kinderwell <hello@example.com>',
      // Replies go to a real inbox — this email explicitly invites them.
      reply_to: Deno.env.get('SUPPORT_EMAIL') ?? 'kinderwellteam@gmail.com',
      to: recipients,
      subject: 'Welcome to Kinderwell — 2 steps to start',
      html: `
<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;color:#2E2E2E">
  <h1 style="font-size:22px">You're in. Two steps left.</h1>
  <p style="line-height:1.6"><strong>Step 1 — Download Kinderwell on your iPhone</strong></p>
  <p><a href="${appStoreUrl}" style="display:inline-block;background:#4F8F8B;color:#fff;padding:14px 28px;border-radius:14px;text-decoration:none;font-weight:600">Download on the App Store</a></p>
  <p style="line-height:1.6"><strong>Step 2 — Sign in with ${safeEmail}</strong></p>
  <ol style="line-height:1.6;padding-left:20px">
    <li>Open Kinderwell. At the bottom of the first screen, tap <strong>Sign in</strong>
    (next to "Already have an account?") — not <strong>Get started</strong>, which is for new users.</li>
    <li>Choose <strong>Continue with Email</strong> and enter <strong>${safeEmail}</strong>.
    We'll send a 6-digit code — no password needed. Your subscription unlocks automatically.</li>
  </ol>
  <p style="line-height:1.6;color:#6B6B6B;font-size:13px">
  Your plan: ${escapeHtml(plan.label)}. It renews automatically until you cancel at
  <a href="${siteUrl}/manage">${manageLabel}</a> (sign in with this email).
  Your receipt comes separately from Dodo Payments, our payment partner.
  See our <a href="${siteUrl}/legal/refunds">refund policy</a>
  · reply to this email for help.</p>
</div>`,
    }),
  });
  if (!res.ok) console.error('handoff email failed', res.status, await res.text().catch(() => ''));
}

async function fireCapiPurchase(
  userId: string,
  email: string,
  metadata: Record<string, string>,
  plan: PlanSummary
) {
  // Match keys stored at checkout creation.
  const { data: session } = await admin
    .from('funnel_sessions')
    .select('capi')
    .eq('id', metadata.funnel_session_id ?? '')
    .maybeSingle();
  const capi = (session?.capi as Record<string, string>) ?? {};

  await sendCapiEvent({
    eventName: 'Purchase',
    // The PAID checkout's own id first. capi.event_id is the id of the most
    // recently CREATED checkout, which differs if the buyer opened checkout
    // more than once — and then the browser Purchase (fired with the paid
    // session's id) would not dedup against this one.
    eventId: metadata.event_id ?? capi.event_id,
    sourcePath: '/offer',
    user: { email, userId, fbp: capi.fbp, fbc: capi.fbc, ip: capi.ip, ua: capi.ua },
    // The charged amount from Dodo, not the display price (P1-11).
    customData: { value: plan.value, currency: plan.currency },
  });
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
