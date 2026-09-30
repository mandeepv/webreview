// winback-sweep — the scheduled sweeper. Run hourly (MANUAL_STEPS.md §2.4).
// Three jobs, all idempotent via stage columns:
//   1. abandoned-after-email ladder: captured email, no purchase → nudge at
//      ~1h and ~24h (no discount codes — price parity is a locked decision)
//   2. paid-but-never-signed-in ladder: entitlement active but the user has
//      never completed an app sign-in → "finish setting up" at ~24h and ~72h.
//      This cohort is 10–25% of web2app buyers and is pure churn if ignored.
//   3. expiry sweep: flip stale active/cancelled rows past period end.
//
// Deploy: supabase functions deploy winback-sweep --no-verify-jwt
// Protect it with a shared secret since cron can't send a JWT:
// the caller must pass ?key=<SWEEP_SECRET>.
//
// Ladder 1 is MARKETING mail: CAN-SPAM requires a working unsubscribe and a
// physical postal address in every one. Opt-outs live in email_opt_outs;
// the address comes from the MAILING_ADDRESS secret, and in live mode the
// ladder refuses to send without it. Ladder 2 is transactional (they paid;
// it's about the service they bought) and is unaffected.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { escapeHtml, unsubscribeParts } from '../_shared/email.ts';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

const HOUR = 3600 * 1000;

Deno.serve(async (req) => {
  const key = new URL(req.url).searchParams.get('key');
  if (!key || key !== Deno.env.get('SWEEP_SECRET')) {
    return new Response('forbidden', { status: 403 });
  }

  const results = { abandoned: 0, unactivated: 0, expired: 0 };

  // ── 1. Abandoned after email capture (marketing) ──────────────────────────
  const mailingAddress = Deno.env.get('MAILING_ADDRESS');
  const marketingAllowed = !!mailingAddress || Deno.env.get('DODO_ENV') !== 'live';
  if (!marketingAllowed) console.error('MAILING_ADDRESS not set in LIVE mode — win-back ladder skipped');

  const { data: abandoned } = marketingAllowed
    ? await admin
        .from('funnel_sessions')
        .select('id, user_id, winback_stage, created_at')
        .is('purchased_at', null)
        .not('user_id', 'is', null)
        .lt('winback_stage', 2)
        .limit(200)
    : { data: [] };

  for (const row of abandoned ?? []) {
    const age = Date.now() - new Date(row.created_at).getTime();
    const dueStage = age > 24 * HOUR ? 2 : age > 1 * HOUR ? 1 : 0;
    if (dueStage <= row.winback_stage) continue;

    const { data: optedOut } = await admin
      .from('email_opt_outs')
      .select('user_id')
      .eq('user_id', row.user_id)
      .maybeSingle();
    if (optedOut) {
      // Park at the top stage so this row is never considered again.
      await admin.from('funnel_sessions').update({ winback_stage: 2 }).eq('id', row.id);
      continue;
    }

    const email = await emailFor(row.user_id);
    if (!email) continue;

    const unsub = await unsubscribeParts(site(), row.user_id);
    const footer = `<p style="${muted()}">Don’t want these? <a href="${unsub.pageUrl}">Unsubscribe</a>.${
      mailingAddress ? `<br/>Kinderwell · ${escapeHtml(mailingAddress)}` : ''
    }</p>`;

    const sent = await sendEmail(
      email,
      dueStage === 1 ? 'Your Kinderwell plan is ready' : 'Still thinking it over?',
      dueStage === 1
        ? `<p>Your personalized plan is built and waiting.</p>
           <p><a href="${site()}/plan" style="${btn()}">See my plan</a></p>
           <p style="${muted()}">It takes about a minute to pick up where you left off.</p>${footer}`
        : `<p>The hard moments don't wait — and ten minutes a day is the whole ask.</p>
           <p>Your plan (built from your answers) is still saved.</p>
           <p><a href="${site()}/plan" style="${btn()}">Start my plan</a></p>
           <p style="${muted()}">14-day money-back guarantee. Cancel anytime.</p>${footer}`,
      unsub.headers
    );
    if (sent) {
      await admin.from('funnel_sessions').update({ winback_stage: dueStage }).eq('id', row.id);
      results.abandoned++;
    }
  }

  // ── 2. Paid but never signed into the app ─────────────────────────────────
  const { data: unactivated } = await admin
    .from('entitlements')
    .select('user_id, nudge_stage, updated_at')
    .eq('source', 'dodo')
    .in('status', ['active', 'past_due'])
    .lt('nudge_stage', 2)
    .limit(200);

  for (const row of unactivated ?? []) {
    const { data: userData } = await admin.auth.admin.getUserById(row.user_id);
    const user = userData?.user;
    if (!user?.email) continue;
    // last_sign_in_at is set the first time the user completes an OTP or
    // OAuth sign-in — a web-created account that finished app setup has one.
    if (user.last_sign_in_at) continue;

    const age = Date.now() - new Date(user.created_at).getTime();
    const dueStage = age > 72 * HOUR ? 2 : age > 24 * HOUR ? 1 : 0;
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

  // ── 3. Expiry sweep ────────────────────────────────────────────────────────
  const { data: expiredCount } = await admin.rpc('expire_stale_entitlements');
  results.expired = (expiredCount as number) ?? 0;

  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json' },
  });
});

async function emailFor(userId: string): Promise<string | null> {
  const { data } = await admin.auth.admin.getUserById(userId);
  return data?.user?.email ?? null;
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
  return Deno.env.get('SITE_URL') ?? '';
}
function btn(): string {
  return 'display:inline-block;background:#4F8F8B;color:#fff;padding:14px 28px;border-radius:14px;text-decoration:none;font-weight:600';
}
function muted(): string {
  return 'color:#6B6B6B;font-size:13px';
}
