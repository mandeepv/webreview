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
// The email's sign-in link needs 20261006000000_handoff_keys.sql; without it
// the email simply goes out with the email-code steps only.
//
// Secrets: DODO_WEBHOOK_SECRET, DODO_API_KEY, DODO_ENV, RESEND_API_KEY,
// EMAIL_FROM, SUPPORT_EMAIL, ALERT_EMAIL (optional), SITE_URL, APP_STORE_URL,
// META_PIXEL_ID, META_CAPI_TOKEN, META_TEST_EVENT_CODE (optional, testing
// only), POSTHOG_KEY, POSTHOG_HOST, PRICE_ANNUAL, PRICE_MONTHLY

import { createClient } from 'npm:@supabase/supabase-js@2';
import { accountPredatesSession } from '../_shared/accounts.ts';
import { alertOwner, escapeHtml } from '../_shared/email.ts';
import { cancelDodoSubscription, DODO_BASE } from '../_shared/dodo.ts';
import { decideSubscriptionWrite, isPaidThrough, laterOf, STATUS_BY_EVENT } from '../_shared/entitlement.ts';
import {
  classifyRefundOrDispute,
  describePlan as describePlanFrom,
  PlanSummary,
  refundedExtent,
  refundRevokes,
} from '../_shared/payment_events.ts';
import { mintHandoffKey } from '../_shared/handoff.ts';
import { sendCapiEvent } from '../_shared/meta.ts';
import { profileFromAnswers } from '../_shared/profile.ts';
import { isRateLimited } from '../_shared/ratelimit.ts';
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

/**
 * A run that has been 'processing' this long is presumed dead and may be
 * reclaimed. Longer than Supabase's edge wall-clock limit (400 s on paid
 * plans): reclaiming sooner could start a second run while the first is
 * still alive (it was 2 minutes — review 2026-10-07, P3).
 */
const STALE_PROCESSING_MS = 7 * 60 * 1000;

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

/** How often one delivery re-reads and decides again after losing a write to a concurrent one. */
const MAX_WRITE_ATTEMPTS = 3;

async function handleSubscription(type: string, data: SubscriptionData, occurredAt: string | null, attempt = 1) {
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
    // latency window, on two devices, or a renewal retry that finally went
    // through on an old subscription after they bought a new one). Any
    // activating event counts — active, renewed or plan_changed (B-4: a
    // `renewed` used to be dropped silently, billing the customer twice).
    if (data.subscription_id) await stopDuplicate(userId, data.subscription_id, decision.reason);
    return;
  }

  const fields = {
    status: decision.status,
    product_id: data.product_id ?? current?.product_id ?? 'unknown',
    dodo_customer_id: data.customer?.customer_id ?? current?.dodo_customer_id ?? null,
    dodo_subscription_id: data.subscription_id ?? current?.dodo_subscription_id ?? null,
    current_period_end: decision.currentPeriodEnd,
    last_event_at: decision.replacesSubscription ? occurredAt : laterOf(current?.last_event_at, occurredAt),
    ...(decision.replacesSubscription ? { cancel_pending: false } : {}),
    updated_at: new Date().toISOString(),
  };

  // Optimistic concurrency (B-4): the write lands only if the row is still
  // what the decision was made on — absent, or on the same subscription.
  // Dodo delivers bursts concurrently, and a blind upsert let one first
  // purchase overwrite another's row moments after it activated: a live
  // subscription nothing pointed at, billing with no alert. A delivery that
  // loses reads the row again and decides again; the other subscription is
  // then a duplicate. The same-subscription burst loses only its INSERT
  // (23505) and then updates the winner's row (the W2b test).
  let error: { code?: string; message: string } | null;
  let lost: boolean;
  if (!current) {
    ({ error } = await admin.from('entitlements').insert({ user_id: userId, source: 'dodo', ...fields }));
    lost = error?.code === '23505';
  } else {
    const base = admin.from('entitlements').update(fields).eq('user_id', userId).eq('source', 'dodo');
    const guarded = current.dodo_subscription_id
      ? base.eq('dodo_subscription_id', current.dodo_subscription_id)
      : base.is('dodo_subscription_id', null);
    const { data: updated, error: updateError } = await guarded.select('user_id');
    error = updateError;
    lost = updateError?.code === '23505' || (!updateError && (!updated || updated.length === 0));
  }
  if (lost) {
    if (attempt >= MAX_WRITE_ATTEMPTS) throw new Error(`entitlement write lost ${attempt} times to concurrent deliveries`);
    return handleSubscription(type, data, occurredAt, attempt + 1);
  }
  if (error) {
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
    throw new Error(`entitlement write failed: ${error.message}`);
  }

  if (decision.replacesSubscription && current?.cancel_pending && current.dodo_subscription_id) {
    // The row now points at the new subscription, so the sweep has stopped
    // retrying the old one's cancel. Hand it to a human instead.
    await alertOwner(
      'Cancel the previous subscription manually',
      `User ${userId} bought again, but cancelling their previous subscription ` +
        `${current.dodo_subscription_id} had not succeeded yet. Cancel it in the Dodo dashboard.`
    );
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
  if (!claimed || claimed.length === 0) {
    // Usually a sibling delivery of the same burst already fired them. But if
    // the row has since moved to ANOTHER subscription that still has access,
    // this one is live with nothing pointing at it: a duplicate (B-4).
    const { data: row, error: rowError } = await admin
      .from('entitlements')
      .select('status, dodo_subscription_id, current_period_end')
      .eq('user_id', userId)
      .eq('source', 'dodo')
      .maybeSingle();
    if (rowError) throw new Error(`entitlement re-read failed: ${rowError.message}`);
    if (row?.dodo_subscription_id && row.dodo_subscription_id !== subscriptionId && isPaidThrough(row, new Date())) {
      await stopDuplicate(
        userId,
        subscriptionId,
        `${subscriptionId} activated while ${row.dodo_subscription_id} holds the entitlement`
      );
    }
    return;
  }

  const metadata = data.metadata ?? {};
  let sessionCreatedAt: string | null = null;
  if (metadata.funnel_session_id) {
    // The nonce hash BEFORE purchased_at: mint-handoff reads a session with
    // purchased_at set as final, so the hash must already be there.
    await saveHandoffNonce(metadata.funnel_session_id, metadata.handoff_nonce_hash);
    const { data: session } = await admin
      .from('funnel_sessions')
      .update({ purchased_at: new Date().toISOString() })
      .eq('id', metadata.funnel_session_id)
      .select('created_at')
      .maybeSingle();
    sessionCreatedAt = session?.created_at ?? null;
    await createAppProfile(userId, metadata.funnel_session_id);
  }

  // The account the entitlement is on is the Supabase user — that is the
  // email they must sign into the app with, whatever Dodo's copy says (P1-2).
  const { data: userData } = await admin.auth.admin.getUserById(userId);
  const accountEmail = userData?.user?.email ?? '';
  const checkoutEmail = data.customer?.email ?? '';

  // B-1: the purchase landed on an account that existed before this funnel
  // session — an app user buying on the web, a returning lead, or someone
  // who typed another person's email and paid. Whoever paid may not own the
  // account, so no sign-in link (below); the owner's inbox gets the email
  // and the email-code steps. No session found at all: no link either (no
  // proof), but nothing to tell the owner about.
  const existingAccount = accountPredatesSession(userData?.user?.created_at, sessionCreatedAt);
  if (existingAccount && sessionCreatedAt) {
    await alertOwner(
      'Web purchase on an existing account',
      `User ${userId} bought subscription ${subscriptionId} on the web, but their account was created ` +
        `${userData?.user?.created_at ?? '(unknown)'}, before this funnel session (${sessionCreatedAt}). ` +
        `Usually an app user or a returning lead buying on the web — then nothing to do. The welcome ` +
        `email went to the account's own inbox WITHOUT the one-tap sign-in link. If the account owner ` +
        `writes in about a purchase they didn't make, someone paid with their email: refund it.`
    );
  }
  if (accountEmail && checkoutEmail && accountEmail.toLowerCase() !== checkoutEmail.toLowerCase()) {
    await alertOwner(
      'Checkout email differs from account email',
      `User ${userId} paid (subscription ${subscriptionId}) with checkout email ${checkoutEmail}, ` +
        `but their account is ${accountEmail}. The welcome email went to both and names the ` +
        `account email. Watch for a "paid but locked out" support request.`
    );
  }

  const plan = describePlan(data);
  // SPEC-21: the email's "Open Kinderwell" button signs the buyer straight
  // in. That is a login credential, so it goes only to the account's own
  // inbox: when Dodo's email differs (P1-2) the email keeps just the
  // email-code steps. So does a purchase on an existing account (B-1, above)
  // and a failed mint.
  const sameInbox =
    !!accountEmail && (!checkoutEmail || checkoutEmail.toLowerCase() === accountEmail.toLowerCase());
  const signInLink =
    sameInbox && !existingAccount ? await mintHandoffKey(admin, userId, 'email').catch(() => null) : null;
  // Side effects are best-effort: a failed email must not 500 the webhook
  // (that would retry the entitlement write it already made). But they run
  // once — the activation is claimed — so a welcome email that still fails
  // after a retry goes to a human (review 2026-10-07, MP-5): it carries the
  // buyer's only App Store link and sign-in steps.
  const [email] = await Promise.allSettled([
    sendHandoffEmail(accountEmail || checkoutEmail, checkoutEmail, plan, signInLink),
    fireCapiPurchase(userId, accountEmail || checkoutEmail, metadata, plan),
  ]);
  const emailError = email.status === 'rejected' ? String(email.reason) : email.value;
  if (emailError) {
    await alertOwner(
      'Welcome email failed — send the app steps by hand',
      `User ${userId} paid (subscription ${subscriptionId}) but the welcome email to ` +
        `${accountEmail || checkoutEmail || '(no address)'} was not sent: ${emailError}. Email them the ` +
        `App Store link and "sign in with ${accountEmail || 'their email'}" steps. The paid-but-not-` +
        `signed-in nudge (winback-sweep) follows in a day either way.`
    );
  }
}

/**
 * A second live subscription for someone already entitled: stop it billing
 * and have the owner refund its charge (P1-3b, B-4). Acts once per
 * subscription a day — the rest of its burst (active, renewed, plan_changed,
 * Dodo's retries) would only repeat the cancel and the alert. The dedupe
 * fails open: a database hiccup costs at most a second alert.
 */
async function stopDuplicate(userId: string, subscriptionId: string, reason: string) {
  if (await isRateLimited(admin, [{ key: `dup:${subscriptionId}`, windowSeconds: 86_400, max: 1 }])) return;
  const cancelled = await cancelDodoSubscription(subscriptionId, 'a duplicate purchase');
  await alertOwner(
    'Duplicate purchase — refund the extra subscription',
    `User ${userId}: ${reason}.\n` +
      `Subscription ${subscriptionId} (not the one their access is on) was ` +
      `${cancelled ? 'cancelled' : 'NOT cancelled (see the other alert)'} so it won't renew. ` +
      `Refund its latest charge in the Dodo dashboard.`
  );
}

/**
 * SPEC-21: puts the PAID checkout's handoff-nonce hash (create-checkout put
 * it in that checkout's metadata) on the funnel session, so only the browser
 * that created this checkout can mint the buyer's welcome-page sign-in link
 * (B-3). No hash, or a malformed one, clears it: no proof, no link. Its own
 * write: if it fails (say the handoff_keys migration isn't applied yet) only
 * the welcome-page link is lost; the email code still signs them in.
 */
async function saveHandoffNonce(funnelSessionId: string, nonceHash: string | undefined) {
  const { error } = await admin
    .from('funnel_sessions')
    .update({ handoff_nonce_hash: /^[0-9a-f]{64}$/.test(nonceHash ?? '') ? nonceHash : null })
    .eq('id', funnelSessionId);
  if (error) console.error('handoff nonce save failed', error.message);
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

  // payment_id → the payment: its subscription, and for a refund, how much
  // of it has been refunded in all. Throws on an API failure so Dodo retries.
  const payment = paymentId ? await fetchPayment(paymentId) : null;

  if (action === 'check_refund_total') {
    const extent = refundedExtent(payment);
    if (!refundRevokes(data.is_partial, extent)) {
      // A partial refund is a goodwill gesture, not "give me my money back" —
      // never cut access automatically for one.
      await alertOwner(
        'Partial refund issued — access left unchanged',
        `Payment ${paymentId ?? '(unknown)'} was partially refunded` +
          `${data.is_partial === undefined ? ' (Dodo did not say partial; the payment shows money left)' : ''}. ` +
          `Access and the subscription were NOT changed. Revoke manually if that was the intent.`
      );
      return;
    }
    if (data.is_partial === true) {
      await alertOwner(
        'Partial refunds add up to the whole payment — access revoked',
        `Payment ${paymentId}: the refunds now total the full amount, so access is revoked and the ` +
          `subscription cancelled, as for a full refund (MP-4). Restore access by hand if that was not the intent.`
      );
    } else if (extent === 'unknown') {
      await alertOwner(
        'Refund without is_partial — treated as a full refund',
        `Payment ${paymentId}: Dodo's refund event did not say whether it was partial, and the payment ` +
          `lookup did not show the refunded total. Access was revoked and the subscription cancelled, ` +
          `so nobody is billed again. If it was a goodwill partial refund, restore access by hand.`
      );
    }
  }

  const subscriptionId = payment?.subscription_id ?? null;
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

type DodoPayment = { subscription_id?: string | null; total_amount?: unknown; refunds?: unknown };

/** GET /payments/{id}: null when Dodo has no such payment. Throws on API failure so Dodo retries the webhook. */
async function fetchPayment(paymentId: string): Promise<DodoPayment | null> {
  const res = await fetch(`${DODO_BASE}/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${Deno.env.get('DODO_API_KEY')}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`payment lookup ${paymentId} failed: ${res.status}`);
  return (await res.json()) as DodoPayment;
}

/**
 * What unlinked_purchases keeps of a payload: the ids and amounts a human
 * needs to find the purchase in Dodo, and our own metadata — not the
 * customer's name, email or billing address (they are one click away in the
 * Dodo dashboard by customer_id; review 2026-10-07, P3).
 */
export function unlinkedPayload(data: unknown): Record<string, unknown> {
  const d = (data ?? {}) as Record<string, unknown>;
  const keep = [
    'subscription_id', 'payment_id', 'refund_id', 'dispute_id', 'product_id', 'status',
    'next_billing_date', 'recurring_pre_tax_amount', 'amount', 'currency', 'is_partial',
    'payment_frequency_interval', 'metadata',
  ];
  const out: Record<string, unknown> = {};
  for (const k of keep) if (d[k] !== undefined) out[k] = d[k];
  const customer = d.customer as { customer_id?: unknown } | undefined;
  if (customer?.customer_id) out.customer = { customer_id: customer.customer_id };
  return out;
}

async function parkUnlinked(data: unknown, subscriptionId: string | null | undefined, reason: string) {
  console.error('UNLINKED PURCHASE:', reason);
  await admin.from('unlinked_purchases').insert({
    dodo_subscription_id: subscriptionId ?? null,
    payload: unlinkedPayload(data),
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

/** Sends the welcome email. Returns null when sent (or email isn't configured), else why it failed. */
async function sendHandoffEmail(
  accountEmail: string,
  checkoutEmail: string,
  plan: PlanSummary,
  signInLink: string | null
): Promise<string | null> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) return null; // email not configured (local dev): nothing to alert about
  if (!accountEmail) return 'no address to send to';
  const appStoreUrl = Deno.env.get('APP_STORE_URL') ?? '';
  const siteUrl = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
  const manageLabel = `${siteUrl.replace(/^https?:\/\//, '')}/manage`;
  const safeEmail = escapeHtml(accountEmail);
  const recipients = [accountEmail];
  if (checkoutEmail && checkoutEmail.toLowerCase() !== accountEmail.toLowerCase()) {
    recipients.push(checkoutEmail);
  }

  const send = () => fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15_000),
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
  ${signInLink ? signInLinkSteps(signInLink, safeEmail) : signInSteps(safeEmail, 'Step 2 — Sign in with')}
  <p style="line-height:1.6;color:#6B6B6B;font-size:13px">
  Your plan: ${escapeHtml(plan.label)}. It renews automatically until you cancel at
  <a href="${siteUrl}/manage">${manageLabel}</a> (sign in with this email).
  Your receipt comes separately from Dodo Payments, our payment partner.
  See our <a href="${siteUrl}/legal/refunds">refund policy</a>
  · reply to this email for help.</p>
</div>`,
    }),
  });
  // One retry for a server error or a dropped connection; a 4xx (a bad
  // address, a config problem) won't get better by asking again.
  let failure: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await send();
      if (res.ok) return null;
      failure = `Resend ${res.status}: ${await res.text().catch(() => '')}`.slice(0, 300);
      if (res.status < 500) break;
    } catch (err) {
      failure = `network error: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (attempt === 1) await new Promise((r) => setTimeout(r, 1500));
  }
  console.error('handoff email failed', failure);
  return failure;
}

/**
 * Step 2 when there is a sign-in link (SPEC-21): one tap opens the app signed
 * in, or, without the app, the link page that gets it. The email-code steps
 * stay underneath as the fallback for an expired or used link.
 */
function signInLinkSteps(link: string, safeEmail: string): string {
  return `
  <p style="line-height:1.6"><strong>Step 2 — Open Kinderwell from this email</strong></p>
  <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#2f6b4a;color:#fff;padding:14px 28px;border-radius:14px;text-decoration:none;font-weight:600">Open Kinderwell</a></p>
  <p style="line-height:1.6">Tap it on your iPhone and Kinderwell opens already signed in to your
  account. No password, no code.</p>
  <p style="line-height:1.6;color:#6B6B6B;font-size:13px">The button works once, for 7 days, and it
  signs in as you, so please don't forward this email.</p>
  ${signInSteps(safeEmail, 'If the button doesn’t work, sign in with')}`;
}

/** Button labels quoted EXACTLY as the app shows them — see the note in app/welcome/welcome-client.tsx. */
function signInSteps(safeEmail: string, heading: string): string {
  return `
  <p style="line-height:1.6"><strong>${heading} ${safeEmail}</strong></p>
  <ol style="line-height:1.6;padding-left:20px">
    <li>Open Kinderwell. At the bottom of the first screen, tap <strong>Sign in</strong>
    (next to "Already have an account?") — not <strong>Get started</strong>, which is for new users.</li>
    <li>Choose <strong>Continue with Email</strong> and enter <strong>${safeEmail}</strong>.
    We'll send a 6-digit code — no password needed. Your subscription unlocks automatically.</li>
  </ol>`;
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
  // The same environment tags the app and the website register (XR-7), so
  // a dashboard filtered on environment = prod keeps these events.
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const environment = url.includes('<PROD_PROJECT_REF>') ? 'prod' : url.includes('<DEV_PROJECT_REF>') ? 'dev' : 'unknown';
  await fetch(`${host}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      event,
      distinct_id: distinctId,
      properties: { ...properties, environment, app_env: environment, surface: 'server' },
    }),
  }).catch((err) => console.error('posthog capture failed', err));
}
