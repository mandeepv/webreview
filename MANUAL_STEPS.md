# MANUAL_STEPS — everything the code can't do for you

Work top to bottom. Each section says **where**, **what**, and **which value
lands where**. Rough total: 2–3 hours of dashboard work (excluding Dodo KYC
review time, which is on their clock).

Everything below targets the **dev Supabase project + Dodo TEST mode** first.
The very last section flips to production. Never mix the two in one sitting.

---

## 0. Prerequisites you already have

- [ ] Supabase dev + prod projects (existing, from the app)
- [ ] PostHog project (existing — we reuse it; web + app = one user journey)
- [ ] Apple App Store listing URL for the app → goes in `NEXT_PUBLIC_APP_STORE_URL` and the `APP_STORE_URL` secret

## 1. Domain (blocks Meta verification, email, checkout branding — do first)

- [ ] Buy the domain (Namecheap). Candidates checked available on 2026-09-18:
      `kinderwell.app` (~$16–18/yr, my pick — brand-exact; .app forces HTTPS, which Vercel gives you anyway),
      `getkinderwell.com` (~$10–12/yr), `joinkinderwell.com`, `kinderwellapp.com`, `heykinderwell.com`,
      `kinderwell.me` (~$7 first yr, ~$20 renew), `kinderwell.family` (~$25/yr).
      `kinderwell.com` and `trykinderwell.com` are taken. Confirm price at checkout — promos move.
- [ ] Point it at Vercel later (§6). Plan a `mail.` subdomain for email sending (§4).

## 2. Supabase (dev project first)

### 2.1 Apply the migration
The canonical home is the app repo. Copy, then apply with the existing tooling:
```bash
cp supabase/migrations/20260918000000_web2app.sql ~/mamalearn/supabase/migrations/
cp supabase/migrations/20260928000000_email_opt_outs.sql ~/mamalearn/supabase/migrations/   # added 2026-09-28 — see §8.6
cd ~/mamalearn && supabase db push        # linked to DEV per house rules
```
(Prod later, owner-run, via `scripts/db-push-prod.sh` — §9.)

### 2.2 Enable Email OTP auth
Dashboard → Authentication → Providers → **Email**: enable. Under Email
provider settings make sure **passwordless / OTP login** is allowed and set
OTP length 6. Do this on dev now, prod in §9. (The iOS app's "Continue with
Email" — Phase 0 app work — depends on this too.)

### 2.3 Deploy the edge functions
```bash
cd <this repo>
# ALL functions deploy with --no-verify-jwt: this Supabase project uses the
# new sb_publishable_* API keys, which are not JWTs, so verify_jwt would 401
# every call from the site. The gateway still requires a valid apikey header;
# dodo-webhook is guarded by its signature, winback-sweep by SWEEP_SECRET.
supabase functions deploy capture-email --no-verify-jwt
supabase functions deploy create-checkout --no-verify-jwt
supabase functions deploy dodo-webhook --no-verify-jwt
supabase functions deploy winback-sweep --no-verify-jwt
supabase functions deploy unsubscribe --no-verify-jwt
```

### 2.4 Set function secrets
```bash
supabase secrets set \
  DODO_API_KEY=<from §3>            \
  DODO_ENV=test                     \
  DODO_PRODUCT_ANNUAL=<from §3>     \
  DODO_PRODUCT_MONTHLY=<from §3>    \
  DODO_WEBHOOK_SECRET=<from §3>     \
  RESEND_API_KEY=<from §4>          \
  EMAIL_FROM="Kinderwell <hello@mail.YOURDOMAIN>" \
  SITE_URL=https://YOURDOMAIN       \
  APP_STORE_URL=<app store link>    \
  META_PIXEL_ID=<from §5>           \
  META_CAPI_TOKEN=<from §5>         \
  POSTHOG_KEY=<existing phc_ key>   \
  POSTHOG_HOST=https://us.i.posthog.com \
  PRICE_ANNUAL=59.99 PRICE_MONTHLY=12.99 \
  SWEEP_SECRET=$(openssl rand -hex 24)
```

### 2.5 Schedule the sweeper (hourly)
Dashboard → SQL editor (pg_cron + pg_net are available on Supabase):
```sql
select cron.schedule(
  'winback-sweep-hourly', '0 * * * *',
  $$ select net.http_get('https://<PROJECT-REF>.supabase.co/functions/v1/winback-sweep?key=<SWEEP_SECRET>') $$
);
```

## 3. Dodo Payments

- [ ] Create account at dodopayments.com → complete **KYC** and connect payout
      bank. (Their review takes time — start this first thing.)
- [ ] **Verify Apple Pay appears on their hosted checkout in test mode.** The
      code requests it (`allowed_payment_method_types` includes `apple_pay`).
      If it doesn't show on an iPhone Safari test, ask their support before
      spending on ads — Apple Pay is make-or-break for iOS conversion.
- [ ] Products (test mode): two auto-renewing subscriptions —
      **Annual $59.99/year** and **Monthly $12.99/month**, USD.
      → product IDs into `DODO_PRODUCT_ANNUAL` / `DODO_PRODUCT_MONTHLY` (§2.4).
- [ ] API key (test mode) → `DODO_API_KEY`.
- [ ] Webhook: add endpoint
      `https://<PROJECT-REF>.supabase.co/functions/v1/dodo-webhook`
      subscribed to **all subscription.*, payment.*, refund.*, dispute.*
      events** → signing secret (`whsec_…`) into `DODO_WEBHOOK_SECRET`.
- [ ] Statement descriptor: set to **KINDERWELL** (a descriptor parents don't
      recognize = chargebacks).
- [ ] Branding: logo + brand color `#4F8F8B` on the checkout page settings.
- [ ] Note where the **customer portal / manage-subscription link** lives for
      your account setup — support macros and the app's Settings copy need it.

## 4. Resend (email)

- [ ] Create account → add domain `mail.YOURDOMAIN` → add the DKIM/SPF DNS
      records it shows you at Namecheap → verify.
- [ ] API key → `RESEND_API_KEY` (§2.4). Set `EMAIL_FROM` to a real address on
      that domain, e.g. `Kinderwell <hello@mail.YOURDOMAIN>`.
- [ ] Set up a reply-to inbox (replies go to your support email — receipts say
      "reply for help").

## 5. Meta

> ⚠️ **Read `OPS_RUNBOOK.md` §6 first** if the advertising entity may change
> (individual → company). Tax details generally cannot be edited after
> submission, and getting the Business Manager / pixel ownership right on day
> one is what makes a later entity change survivable.

- [ ] Business Manager: create/confirm, **named "Kinderwell"** (not a personal
      name). **Add a second admin** (recovery — ad accounts get falsely
      flagged; a lone-admin lockout is unrecoverable).
- [ ] Verify the domain (Business settings → Brand safety → Domains → DNS TXT
      record at Namecheap).
- [ ] Events Manager → create a **Pixel owned by the Business Manager** (never
      under a personal profile — BM-owned pixels are reassignable later) → ID
      into `NEXT_PUBLIC_META_PIXEL_ID`. Record the pixel + ad account IDs in
      `OPS_RUNBOOK.md` §2.
- [ ] Same pixel → Settings → **Conversions API** → Generate access token →
      `META_CAPI_TOKEN` (§2.4).
- [ ] Ad account: payment method + a conservative spending limit.

## 6. Vercel

- [ ] Create the project from this repo (push it to GitHub first —
      `git init && git add -A && git commit` in this folder, new **private** repo).
- [ ] Environment variables (Preview = dev Supabase; Production = prod later):
      everything in `.env.example`. Preview values: dev Supabase URL + anon
      key, real PostHog key, real pixel ID.
- [ ] Attach the domain (Vercel gives you the DNS records for Namecheap).

## 7. End-to-end test (test mode, before any ads)

**Test cards** (test mode only; any future expiry, any 3-digit CVC):

| Scenario | Card |
|---|---|
| Success | `4242 4242 4242 4242` |
| Declined | `4000 0000 0000 0002` |
| Insufficient funds | `4000 0000 0000 9995` |
| **Renewal fails at next billing** | `4000 0000 0000 0069` |

Optional but handy — the Dodo CLI can forward real test-mode webhooks to a
local endpoint (`npm install -g dodopayments-cli`, `dodo login`, then
`dodo wh listen <url>`). Note `dodo wh trigger` sends UNSIGNED mock payloads,
which our handler correctly rejects — don't use it against the real function.

- [ ] Run the full quiz on your iPhone (Safari) → email capture with a real
      address you control → offer → checkout opens, **Apple Pay visible** →
      pay with `4242…` → land on /welcome.
- [ ] Check: `entitlements` row exists (Supabase table editor), status
      `active`, `current_period_end` set; handoff email arrived; PostHog shows
      the whole funnel under one person; Meta Events Manager → Test Events
      shows **one** deduped Purchase (browser + server).
- [ ] Refund the test payment in Dodo → entitlement flips to `revoked`.
- [ ] Replay the webhook from Dodo's dashboard → no duplicate side effects,
      status still `revoked` (the resurrect guard).
- [ ] Hit checkout again as the same session while active → 409 (dup guard).
- [ ] **Renewal-failure path:** subscribe with `4000 0000 0000 0069`, then
      force the renewal early by patching the subscription's
      `next_billing_date` to now (Dodo dashboard or API). Expect
      `subscription.on_hold` → entitlement `past_due` → **app access
      continues** until `current_period_end`, then the sweep expires it.
- [ ] Watch the function logs during all of the above: a
      `webhook signature verification FAILED` line means `DODO_WEBHOOK_SECRET`
      is wrong — fix before going further, since every entitlement depends on it.

## 8. Legal + claims (before launch, not after)

- [ ] Fill every `[BRACKET]` in `app/legal/*` — support email, business
      name/address, dates. The privacy policy's Meta hashed-email disclosure
      and the refund policy's 14-day promise are already written; keep them
      true (the /offer page promises the same 14 days — they must match).
- [ ] **⚠︎ Confirm every proof stat is defensible before ads run.** The quiz
      keeps variant B's hard-hitting placeholder numbers by your decision
      (e.g. the Mirror beat's "83% of parents", the "two weeks" results
      claims, "12 lessons"). Same checklist as the app's
      `docs/specs/variant-b-onboarding-copy.md` — but the web versions are
      ALSO Meta ad-policy and FTC surface, so either back each number or
      soften it to an unfalsifiable form before spend starts.

## 8.5 Preview skips — REMOVE BEFORE ADS

While testing, the Vercel env var `NEXT_PUBLIC_DEV_SKIP=1` makes the
"Dev: skip backend →" / "Dev: skip checkout →" links appear on the deployed
site so the full flow can be previewed without a backend.
- [ ] **Before any ad spend: delete `NEXT_PUBLIC_DEV_SKIP` from Vercel and
      redeploy.** Real visitors must never see a way around email capture or
      checkout (they'd unlock nothing, but the funnel data would lie).

## 8.6 Hardening from the 2026-09-28 review — before the first ad dollar

Code for all of this is in the repo; these are the parts only you can do.

- [ ] **Apply the new migration** `supabase/migrations/20260928000000_email_opt_outs.sql`
      (dev now, prod in §9) and **deploy the new `unsubscribe` function** (§2.3).
      Redeploy the other four too — every one of them changed.
      **Order: migration FIRST, then functions** — the new `winback-sweep`
      reads `email_opt_outs`. Like the first migration, copy it into the app
      repo and apply from there (§2.1):
      `cp supabase/migrations/20260928000000_email_opt_outs.sql ~/mamalearn/supabase/migrations/`
      Additive only (one new table, RLS on, no policies) — safe for the live app.
- [ ] **`FUNNEL_PROXY_SECRET`** — `openssl rand -hex 32`, set the SAME value in
      Supabase secrets AND in Vercel as a plain server env var (NOT
      `NEXT_PUBLIC_`). Without it, anyone can call the edge functions directly
      with the public anon key. Test mode tolerates it missing; **live mode
      refuses every funnel request until it's set.**
- [ ] **`MAILING_ADDRESS`** secret — a real postal address (a PO box or virtual
      mailbox is fine). CAN-SPAM requires one in every marketing email; in
      live mode the win-back emails refuse to send without it.
- [ ] Optional secrets: `UNSUBSCRIBE_SECRET` (else SWEEP_SECRET signs
      unsubscribe links — fine, but rotating SWEEP_SECRET would break old
      links), `ALERT_EMAIL` (else alerts go to SUPPORT_EMAIL).
- [ ] **Vercel Firewall → rate-limit rule** on `/api/capture-email` and
      `/api/create-checkout` (e.g. 10 requests / minute / IP). This is what
      stops a script from creating thousands of accounts and making us email
      strangers — which gets the sending domain blocklisted.
- [ ] **Dodo → Settings → Communication → Customer Emails:** turn ON
      *Upcoming Renewal Reminder* (the refund policy promises a renewal
      reminder) and the refund/subscription lifecycle emails.
- [ ] **Dodo → Webhooks:** turn on failure email alerts for the endpoint.
- [ ] **Customer portal check:** after the first live purchase, open
      `kinderwell.app/manage`, sign in with the buyer email and confirm the
      Kinderwell subscription is listed with a Cancel button. If Dodo gives you
      a business-specific portal URL, set `NEXT_PUBLIC_DODO_PORTAL_URL`.
- [ ] **Refunds from the Dodo dashboard now auto-cancel the subscription** and
      revoke access (the webhook does it). Partial refunds deliberately do
      neither — you get an alert email and decide.
- [ ] **Meta test run:** set `META_TEST_EVENT_CODE` from Events Manager → Test
      events, run one test purchase, confirm ONE deduplicated Purchase with
      email + external_id matched, then **delete the secret**.
- [ ] **Testimonials:** every review on /start, /email and /offer must be from a
      real customer who said it (names can be changed, words can't be
      invented). Replace or remove any that aren't — see OPS_RUNBOOK §1b.

## 9. Production flip (only after §7 passes)

- [x] **Dodo KYC/business verification APPROVED** (owner-reported 2026-09-28).
- [ ] Dodo live mode: **recreate both products** (product IDs do NOT carry
      over from test), new live API key, new webhook endpoint + secret.
- [ ] Supabase prod: migration via `scripts/db-push-prod.sh`; enable Email OTP;
      apply BOTH migrations (`20260918…_web2app`, `20260928…_email_opt_outs`);
      deploy all five functions against prod; set secrets with `DODO_ENV=live`,
      the live key/product IDs/webhook secret, and `SITE_URL=https://kinderwell.app`.
- [ ] Vercel Production env vars: prod Supabase URL + anon key, and
      `NEXT_PUBLIC_SITE_URL=https://kinderwell.app`.
- [ ] Confirm the live webhook URL in Dodo points at the PROD Supabase project
      (a prod webhook still aimed at dev is the classic silent failure).
- [ ] One real purchase with a real card (refund yourself after) — full §7
      checklist against prod.
- [ ] Update `~/mamalearn/docs/OPS_STATE.md` with every new external-state row:
      Dodo dashboard (live), webhook secret location, Resend, Meta pixel/CAPI
      token, Vercel project, domain registrar, SWEEP_SECRET.

## ⚠️ What this site does NOT include — the app-side work (Phase 0)

The funnel can take money as soon as the above is done, but a buyer can only
UNLOCK the app after the app-side changes ship (spec:
`~/kinderwell-web2app/03-app-changes.md`):
1. "Continue with Email" (OTP) on the app's AuthScreen
2. The LoadingScreen gate checking the `entitlements` table before Superwall
3. Settings wording for web-billed users + docs/INVARIANTS updates

**Do not spend on ads until Phase 0 is live in the App Store.** Until then,
test-mode purchases only.

## Three prices must always agree

`NEXT_PUBLIC_PRICE_*` (display) · Dodo products (charged) · App Store IAP
(parity policy). Change one → change all three the same day.
