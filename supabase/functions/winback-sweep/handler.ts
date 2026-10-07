// winback-sweep — the scheduled sweeper. Run hourly (MANUAL_STEPS.md §2.4).
// Three jobs, all idempotent via stage columns:
//   1. abandoned-after-email ladder: captured email, no purchase → nudge at
//      ~1h and ~24h (no discount codes — price parity is a locked decision)
//   2. paid-but-never-signed-in ladder: entitlement active but the user has
//      never completed an app sign-in → "finish setting up" at ~24h and ~72h.
//      This cohort is 10–25% of web2app buyers and is pure churn if ignored.
//   3. cancel retries: revoked rows whose Dodo cancel hasn't succeeded yet
//      (cancel_pending) — a refunded customer must never be billed again
//   4. expiry sweep: flip stale rows past period end. 'active' and
//      'past_due' rows past it are first reconciled against the Dodo API —
//      a late renewal webhook must not lock out someone who was just
//      billed — and when Dodo can't be asked, nobody is expired that run.
//
// Deploy: supabase functions deploy winback-sweep --no-verify-jwt
// Requires migration 20260930000000_webhook_hardening.sql — apply it first.
// Protect it with a shared secret since cron can't send a JWT: the caller
// passes SWEEP_SECRET as the x-sweep-key header (preferred — query strings
// end up in logs) or as ?key=.
//
// Ladder 1 is MARKETING mail: CAN-SPAM requires a working unsubscribe and a
// physical postal address in every one. Opt-outs live in email_opt_outs;
// the address comes from the MAILING_ADDRESS secret, and in live mode the
// ladder refuses to send without it. Ladder 2 is transactional (they paid;
// it's about the service they bought) and is unaffected.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { alertOwner, escapeHtml, resumeToken, signingConfigured, timingSafeEqual, unsubscribeParts } from '../_shared/email.ts';
import { accountPredatesSession } from '../_shared/accounts.ts';
import { hasAccess } from '../_shared/entitlement.ts';
import { cancelDodoSubscription, lookupDodoSubscription } from '../_shared/dodo.ts';
import { isRateLimited } from '../_shared/ratelimit.ts';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
/** Keep in sync with the 'active' grace in expire_stale_entitlements(). */
const ACTIVE_EXPIRY_GRACE_MS = 5 * DAY;
/** Overdue rows one run asks Dodo about (5 at a time, 15 s timeout each). */
const RECONCILE_LIMIT = 200;

/** The whole function. index.ts serves it; the integration tests call it directly. */
export async function handler(req: Request): Promise<Response> {
  const expected = Deno.env.get('SWEEP_SECRET');
  const key = req.headers.get('x-sweep-key') ?? new URL(req.url).searchParams.get('key') ?? '';
  if (!expected || !timingSafeEqual(key, expected)) {
    return new Response('forbidden', { status: 403 });
  }

  const results = { abandoned: 0, unactivated: 0, cancelRetried: 0, reconciled: 0, expired: 0, expiryPaused: false, retentionCleared: 0, retentionDeleted: 0 };

  // ── 1. Abandoned after email capture (marketing) ──────────────────────────
  const mailingAddress = Deno.env.get('MAILING_ADDRESS');
  // Every marketing email needs a signed unsubscribe link (CAN-SPAM) and a
  // signed resume link. Without the signing secret, skip only this ladder —
  // the cancel retries and expiry below must still run.
  const canSign = signingConfigured();
  const marketingAllowed = canSign && (!!mailingAddress || Deno.env.get('DODO_ENV') !== 'live');
  if (!canSign) console.error('UNSUBSCRIBE_SECRET not set — win-back ladder skipped');
  else if (!marketingAllowed) console.error('MAILING_ADDRESS not set in LIVE mode — win-back ladder skipped');

  // Oldest first, and ONLY rows with an email actually due: stage 0 past an
  // hour, stage 1 past a day. Selecting every row below stage 2 let leads who
  // already had email 1 hold the oldest-first batch until they turned 24h
  // old, so with a backlog over 50 newer leads got nothing for up to a day
  // (P2-4; caught by the S9 integration test).
  const hourAgo = new Date(Date.now() - HOUR).toISOString();
  const dayAgo = new Date(Date.now() - DAY).toISOString();
  const { data: abandoned } = marketingAllowed
    ? await admin
        .from('funnel_sessions')
        .select('id, user_id, winback_stage, created_at')
        .is('purchased_at', null)
        .not('user_id', 'is', null)
        .or(`and(winback_stage.eq.0,created_at.lt."${hourAgo}"),and(winback_stage.eq.1,created_at.lt."${dayAgo}")`)
        .order('created_at', { ascending: true })
        .limit(50)
    : { data: [] };

  const userIds = [...new Set((abandoned ?? []).map((r) => r.user_id as string))];
  const [optedOut, paying, stageByUser] = await Promise.all([
    userSet('email_opt_outs', userIds),
    // Anyone who has bought (possibly on another funnel session, or with
    // the webhook still landing) is never "still thinking". A row whose
    // first payment failed (subscription.failed → expired, never activated)
    // is not a purchase: that lead still gets the ladder (review P3).
    buyers(userIds),
    highestStageByUser(userIds),
  ]);

  for (const row of abandoned ?? []) {
    const age = Date.now() - new Date(row.created_at).getTime();
    const dueStage = age > DAY ? 2 : age > HOUR ? 1 : 0;
    if (dueStage <= row.winback_stage) continue;

    // Park at the top stage so this row is never considered again: opted
    // out, already paying, or already emailed at this stage from another
    // session (the ladder is per person, not per session — P1-7).
    if (optedOut.has(row.user_id) || paying.has(row.user_id) || (stageByUser.get(row.user_id) ?? 0) >= dueStage) {
      await admin.from('funnel_sessions').update({ winback_stage: 2 }).eq('id', row.id);
      continue;
    }

    const { data: userData } = await admin.auth.admin.getUserById(row.user_id);
    const user = userData?.user;
    if (!user?.email) continue;
    if (accountPredatesSession(user.created_at, row.created_at)) {
      // The account predates this funnel session: an existing app user, or
      // someone typing another person's address. Not a lead we created.
      await admin.from('funnel_sessions').update({ winback_stage: 2 }).eq('id', row.id);
      continue;
    }
    const email = user.email;

    const unsub = await unsubscribeParts(site(), row.user_id);
    // The email is usually opened in a different browser than the quiz ran
    // in; the signed link rebuilds their session there (P1-6).
    const planUrl = `${site()}/r/${encodeURIComponent(await resumeToken(row.id))}`;
    const footer = `<p style="${muted()}">Don’t want these? <a href="${unsub.pageUrl}">Unsubscribe</a>.${
      mailingAddress ? `<br/>Kinderwell · ${escapeHtml(mailingAddress)}` : ''
    }</p>`;

    const sent = await sendEmail(
      email,
      dueStage === 1 ? 'Your Kinderwell plan is ready' : 'Still thinking it over?',
      dueStage === 1
        ? `<p>Your personalized plan is built and waiting.</p>
           <p><a href="${planUrl}" style="${btn()}">See my plan</a></p>
           <p style="${muted()}">It takes about a minute to pick up where you left off.</p>${footer}`
        : `<p>The hard moments don't wait — and ten minutes a day is the whole ask.</p>
           <p>Your plan (built from your answers) is still saved.</p>
           <p><a href="${planUrl}" style="${btn()}">Start my plan</a></p>
           <p style="${muted()}">14-day money-back guarantee. Cancel anytime.</p>${footer}`,
      unsub.headers
    );
    if (sent) {
      await admin.from('funnel_sessions').update({ winback_stage: dueStage }).eq('id', row.id);
      stageByUser.set(row.user_id, dueStage);
      results.abandoned++;
    }
  }

  // ── 2. Paid but never signed into the app ─────────────────────────────────
  // Same rule as the ladder above: only rows with a nudge due (stage 0 a day
  // after paying, stage 1 three days after), oldest first. Rows that were
  // never due — above all, customers who HAVE signed in — used to fill the
  // 200-row batch forever, so past ~200 web subscribers new buyers would
  // silently stop being nudged.
  const threeDaysAgo = new Date(Date.now() - 72 * HOUR).toISOString();
  const { data: unactivated } = await admin
    .from('entitlements')
    .select('user_id, nudge_stage, activated_at')
    .eq('source', 'dodo')
    .in('status', ['active', 'past_due'])
    .or(`and(nudge_stage.eq.0,activated_at.lt."${dayAgo}"),and(nudge_stage.eq.1,activated_at.lt."${threeDaysAgo}")`)
    .order('activated_at', { ascending: true })
    .limit(200);

  for (const row of unactivated ?? []) {
    const { data: userData } = await admin.auth.admin.getUserById(row.user_id);
    const user = userData?.user;
    if (!user?.email) continue;
    // last_sign_in_at is set the first time the user completes an OTP or
    // OAuth sign-in — a web-created account that finished app setup has one.
    // They never need a nudge: close their ladder so they leave the batch.
    if (user.last_sign_in_at) {
      await admin.from('entitlements').update({ nudge_stage: 2 }).eq('user_id', row.user_id).eq('source', 'dodo');
      continue;
    }

    // Aged from the purchase, not the account: a lead who gave their email
    // days ago and buys today must not get "don't leave your plan unused"
    // an hour after the welcome email (P2-4).
    const age = Date.now() - new Date(row.activated_at).getTime();
    const dueStage = age > 72 * HOUR ? 2 : age > DAY ? 1 : 0;
    if (dueStage <= row.nudge_stage) continue;

    const sent = await sendEmail(
      user.email,
      dueStage === 1 ? 'Your Kinderwell subscription is waiting' : 'Don’t leave your plan unused',
      `<p>You're all paid up — the last step is the app.</p>
       <p><strong>1.</strong> <a href="${Deno.env.get('APP_STORE_URL') ?? ''}">Download Kinderwell</a> on your iPhone<br/>
       <strong>2.</strong> Open it and tap <strong>Sign in</strong> at the bottom of the first screen (not <strong>Get started</strong>)<br/>
       <strong>3.</strong> Choose <strong>Continue with Email</strong> and enter <strong>${escapeHtml(user.email)}</strong></p>
       <p style="${muted()}">Your subscription unlocks automatically. Reply to this email if anything's in the way.</p>`
    );
    if (sent) {
      await admin
        .from('entitlements')
        .update({ nudge_stage: dueStage })
        .eq('user_id', row.user_id)
        .eq('source', 'dodo');
      results.unactivated++;
    }
  }

  // ── 3. Retry pending cancels (refunded / disputed customers) ──────────────
  const { data: pendingCancels } = await admin
    .from('entitlements')
    .select('user_id, dodo_subscription_id, updated_at')
    .eq('source', 'dodo')
    .eq('cancel_pending', true)
    .not('dodo_subscription_id', 'is', null)
    .limit(50);

  for (const row of pendingCancels ?? []) {
    // The webhook already alerted on the first failure; don't re-alert hourly.
    if (await cancelDodoSubscription(row.dodo_subscription_id, 'a refund/dispute (sweep retry)', { alert: false })) {
      await admin
        .from('entitlements')
        .update({ cancel_pending: false })
        .eq('user_id', row.user_id)
        .eq('source', 'dodo');
      results.cancelRetried++;
    } else if (
      // Still failing two days after the revocation (updated_at is when it
      // was revoked): remind the owner once a day instead of retrying
      // silently forever (review P3) — the next renewal would bill someone
      // who was refunded.
      Date.now() - new Date(row.updated_at).getTime() > 2 * DAY &&
      !(await isRateLimited(admin, [{ key: `sweep:cancel:${row.dodo_subscription_id}`, windowSeconds: 86_400, max: 1 }]))
    ) {
      await alertOwner(
        'Cancel still failing — cancel this subscription by hand',
        `Dodo subscription ${row.dodo_subscription_id} (user ${row.user_id}) was refunded or disputed ` +
          `on ${row.updated_at}, and cancelling it has failed every hour since. Cancel it in the Dodo ` +
          `dashboard before its next renewal. (Repeats daily while it stays pending.)`
      );
    }
  }

  // ── 4. Expiry sweep ────────────────────────────────────────────────────────
  // Before expire_stale_entitlements() flips rows, ask Dodo about every one
  // that is still paying in our books: 'active' past its 5-day grace and
  // 'past_due' past its 1-day grace. If Dodo says the subscription is active
  // with a future billing date, a renewal webhook went missing: heal the row
  // instead of locking out a payer (P1-8). 'past_due' too (MP-3): a card
  // retry that succeeded is a payer whose `renewed` may be the lost webhook.
  //
  // An answer we can't trust (Dodo down, a timeout) is NOT "not active"
  // (MP-3): then the expiry is skipped this run — everyone keeps access an
  // hour longer — and the next run asks again. So is a backlog bigger than
  // one run can check, rather than expiring the rest unchecked.
  const pastDueCutoff = new Date(Date.now() - DAY).toISOString();
  const activeCutoff = new Date(Date.now() - ACTIVE_EXPIRY_GRACE_MS).toISOString();
  const { data: overdue } = await admin
    .from('entitlements')
    .select('user_id, status, dodo_subscription_id, current_period_end')
    .eq('source', 'dodo')
    .not('dodo_subscription_id', 'is', null)
    .or(`and(status.eq.active,current_period_end.lt."${activeCutoff}"),and(status.eq.past_due,current_period_end.lt."${pastDueCutoff}")`)
    .order('current_period_end', { ascending: true })
    .limit(RECONCILE_LIMIT + 1);
  const toCheck = (overdue ?? []).slice(0, RECONCILE_LIMIT);
  const backlog = (overdue ?? []).length > RECONCILE_LIMIT;

  const healed: string[] = [];
  const unknown: string[] = [];
  await forEachLimit(toCheck, 5, async (row) => {
    const answer = await lookupDodoSubscription(row.dodo_subscription_id);
    if (answer.kind === 'unknown') {
      unknown.push(row.dodo_subscription_id);
      return;
    }
    const sub = answer.kind === 'found' ? answer.subscription : null;
    if (sub?.status === 'active' && sub.next_billing_date && new Date(sub.next_billing_date) > new Date()) {
      await admin
        .from('entitlements')
        .update({ status: 'active', current_period_end: sub.next_billing_date, updated_at: new Date().toISOString() })
        .eq('user_id', row.user_id)
        .eq('source', 'dodo')
        .eq('dodo_subscription_id', row.dodo_subscription_id);
      healed.push(row.dodo_subscription_id);
    }
  });
  results.reconciled = healed.length;

  const expiryPaused = unknown.length > 0 || backlog;
  const { data: expiredCount } = expiryPaused ? { data: 0 } : await admin.rpc('expire_stale_entitlements');
  if (expiryPaused && !(await isRateLimited(admin, [{ key: 'sweep:expiry-paused', windowSeconds: 6 * 3600, max: 1 }]))) {
    await alertOwner(
      'Expiry paused — Dodo could not confirm overdue subscriptions',
      `${unknown.length} overdue subscription(s) got no usable answer from Dodo` +
        `${unknown.length ? ` (${unknown.slice(0, 20).join(', ')}${unknown.length > 20 ? ', …' : ''})` : ''}` +
        `${backlog ? `, and more than ${RECONCILE_LIMIT} rows are overdue at once` : ''}. Nobody was expired ` +
        `this run, so no payer is locked out while Dodo can't be asked; each hourly run tries again. ` +
        `If this lasts, check status.dodopayments.com and the Dodo API key. (Repeats at most every 6 hours.)`
    );
  }
  results.expiryPaused = expiryPaused;

  // ── 5. Data retention (P3-18; stated in the privacy policy) ───────────────
  // IP, user agent and Meta cookie ids are only needed to match a purchase to
  // an ad: cleared 30 days after the session started (a later checkout stores
  // fresh ones). Sessions no longer linked to anyone — the account was
  // deleted, or the visitor never gave an email — are deleted after 90 days.
  const { data: cleared } = await admin
    .from('funnel_sessions')
    .update({ capi: null })
    .lt('created_at', new Date(Date.now() - 30 * DAY).toISOString())
    .not('capi', 'is', null)
    .select('id');
  results.retentionCleared = cleared?.length ?? 0;
  const { data: deleted } = await admin
    .from('funnel_sessions')
    .delete()
    .is('user_id', null)
    .lt('created_at', new Date(Date.now() - 90 * DAY).toISOString())
    .select('id');
  results.retentionDeleted = deleted?.length ?? 0;

  // Rate-limit windows only matter for minutes; keep the table small.
  await admin
    .from('rate_limit_hits')
    .delete()
    .lt('window_start', new Date(Date.now() - DAY).toISOString());
  // Handoff keys past their 7 days (used or not) can never sign anyone in;
  // a day's margin keeps them around for a support question (review P3).
  await admin.from('handoff_keys').delete().lt('expires_at', new Date(Date.now() - DAY).toISOString());
  // Webhook ids only need to outlive Dodo's retries (about 3 days).
  await admin
    .from('webhook_events')
    .delete()
    .eq('status', 'done')
    .lt('received_at', new Date(Date.now() - 30 * DAY).toISOString());
  results.expired = (expiredCount as number) ?? 0;

  // Only 'active' rows: an active row Dodo no longer confirms means renewal
  // webhooks went missing. A past_due row that lapses is ordinary churn.
  const expiredUnconfirmed = expiryPaused
    ? 0
    : toCheck.filter((r) => r.status === 'active' && !healed.includes(r.dodo_subscription_id)).length;
  if (healed.length > 0 || expiredUnconfirmed > 0) {
    await alertOwner(
      'Expiry sweep found overdue active subscriptions',
      `${healed.length} overdue row(s) were past their period end but Dodo says they're still active — ` +
        `renewal webhooks are probably failing (check Dodo → Webhooks → Message attempts). Healed: ` +
        `${healed.join(', ') || 'none'}.\n${expiredUnconfirmed} active row(s) were expired because Dodo ` +
        `says they are no longer active.`
    );
  }

  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Runs `fn` over `items`, at most `limit` at a time. */
async function forEachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * The subset of userIds who have bought: an entitlement that was ever
 * activated, or one that still grants access. Not a row whose first payment
 * failed.
 */
async function buyers(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const { data } = await admin
    .from('entitlements')
    .select('user_id, status, current_period_end, activated_subscription_id')
    .in('user_id', userIds);
  return new Set(
    (data ?? []).filter((r) => r.activated_subscription_id || hasAccess(r, new Date())).map((r) => r.user_id as string)
  );
}

/** The subset of userIds that have a row in `table`. */
async function userSet(table: string, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const { data } = await admin.from(table).select('user_id').in('user_id', userIds);
  return new Set((data ?? []).map((r) => r.user_id as string));
}

/** Highest win-back stage already sent to each user across all their sessions. */
async function highestStageByUser(userIds: string[]): Promise<Map<string, number>> {
  const stages = new Map<string, number>();
  if (userIds.length === 0) return stages;
  const { data } = await admin
    .from('funnel_sessions')
    .select('user_id, winback_stage')
    .in('user_id', userIds)
    .gt('winback_stage', 0);
  for (const r of data ?? []) {
    stages.set(r.user_id, Math.max(stages.get(r.user_id) ?? 0, r.winback_stage));
  }
  return stages;
}

async function sendEmail(
  to: string,
  subject: string,
  inner: string,
  headers?: Record<string, string>
): Promise<boolean> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('EMAIL_FROM') ?? 'Kinderwell <hello@example.com>',
      // See dodo-webhook: the sending subdomain has no mailbox.
      reply_to: Deno.env.get('SUPPORT_EMAIL') ?? 'kinderwellteam@gmail.com',
      to: [to],
      subject,
      ...(headers ? { headers } : {}),
      html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;margin:0 auto;color:#2E2E2E;line-height:1.6">${inner}</div>`,
    }),
  });
  if (!res.ok) console.error('winback email failed', res.status);
  return res.ok;
}

function site(): string {
  return (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
}
function btn(): string {
  return 'display:inline-block;background:#4F8F8B;color:#fff;padding:14px 28px;border-radius:14px;text-decoration:none;font-weight:600';
}
function muted(): string {
  return 'color:#6B6B6B;font-size:13px';
}
