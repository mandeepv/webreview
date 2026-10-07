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
cp supabase/migrations/20260930000000_webhook_hardening.sql ~/mamalearn/supabase/migrations/ # added 2026-09-30 — see §8.7
cp supabase/migrations/20261005000000_event_ordering.sql ~/mamalearn/supabase/migrations/    # added 2026-10-05 — see §8.7
# 20261006000000_handoff_keys.sql is authored in the app repo (SPEC-21) — already there.
cd ~/mamalearn && supabase db push        # linked to DEV per house rules
```
(Prod later, owner-run, via `scripts/db-push-prod.sh` — §9.)

### 2.2 Enable Email OTP auth
Dashboard → Authentication → Providers → **Email**: enable. Under Email
provider settings make sure **passwordless / OTP login** is allowed and set
OTP length 6. Do this on dev now, prod in §9. (The iOS app's "Continue with
Email" — Phase 0 app work — depends on this too.)

Then Authentication → **Email Templates**: BOTH of these must show the code,
`{{ .Token }}`, not only `{{ .ConfirmationURL }}` (review 2026-10-07, B-11):
- **Magic Link** — what an existing account (every web buyer) gets.
- **Confirm signup** — what a brand-new organic parent gets the first time
  they use "Continue with Email": GoTrue creates the user and sends THIS
  template, not Magic Link. With a link in it they land in Safari and never
  get into the app. Test once on dev with an address that has never been used.

### 2.3 Deploy the edge functions
**Use `scripts/deploy-functions.sh <name> [<name> …]`** — it refuses to deploy
anything that isn't committed, pushed and green in CI, reads which project the
CLI is linked to (`supabase/.temp/linked-project.json`) and refuses an unknown
one, then runs the same `deploy --no-verify-jwt` commands as below. **Name every
function** (since 2026-10-07 there is no "all" default): the usual set is
`capture-email create-checkout dodo-webhook winback-sweep unsubscribe resume`.
**Not `mint-handoff`** until app v1.3.0 is live — its deploy switches the
sign-in links on (§8.9 step 5); the script asks for a second confirmation.
Each successful deploy is appended to `DEPLOY_LOG.md` (date, project,
function, commit): commit and push it afterwards. That log is the record of
what runs where; check it against `supabase functions list` before the prod
flip and before ads.
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
supabase functions deploy resume --no-verify-jwt   # added 2026-09-30 (win-back / Safari links)
supabase functions deploy mint-handoff --no-verify-jwt   # added 2026-10-06 (SPEC-21, §8.9)
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
  SWEEP_SECRET=$(openssl rand -hex 24) \
  FUNNEL_PROXY_SECRET=<same value as in Vercel> \
  UNSUBSCRIBE_SECRET=$(openssl rand -hex 32) \
  MAILING_ADDRESS="<postal address for CAN-SPAM>" \
  SUPPORT_EMAIL=kinderwellteam@gmail.com \
  ALERT_EMAIL=<where owner alerts go; optional, defaults to SUPPORT_EMAIL>
```
Every secret the functions read, so a missing one is a choice, not a surprise
(review 2026-10-07, XR-16):

| Secret | Read by | Without it |
|---|---|---|
| `FUNNEL_PROXY_SECRET` | capture-email, create-checkout, resume, unsubscribe, mint-handoff | **every funnel call is refused** (fails closed). Same value in Vercel. |
| `UNSUBSCRIBE_SECRET` | unsubscribe, resume, winback-sweep | no unsubscribe/resume links; the win-back ladder is skipped |
| `MAILING_ADDRESS` | winback-sweep | in live mode the win-back ladder is skipped (CAN-SPAM) |
| `SWEEP_SECRET` | winback-sweep | the sweep refuses every call |
| `SUPPORT_EMAIL`, `ALERT_EMAIL` | email reply-to; owner alerts | alerts only reach the function logs |
| `DODO_*`, `RESEND_API_KEY`, `EMAIL_FROM`, `SITE_URL`, `APP_STORE_URL`, `PRICE_*` | as above | checkout/email/links break |
| `META_PIXEL_ID`, `META_CAPI_TOKEN` | Lead/InitiateCheckout/Purchase server events | no server-side Meta events |
| `META_TEST_EVENT_CODE` | the same | set ONLY during the Events Manager test run, then delete |
| `POSTHOG_KEY`, `POSTHOG_HOST` | dodo-webhook | no server-side `web_sub_*` events |
| `ALLOW_UNAUTHENTICATED_FUNNEL` | the proxy check | local dev only; ignored when `DODO_ENV=live` (IN-9) |

### 2.5 Schedule the sweeper (hourly)
Not optional: besides the win-back and "finish setting up" emails, it retries
refund cancels, heals or expires overdue subscriptions, and prunes rate-limit
windows, used sign-in keys and old webhook ids. Use the header form (the
secret stays out of URLs and logs).
Dashboard → SQL editor (pg_cron + pg_net are available on Supabase):
```sql
select cron.schedule(
  'winback-sweep-hourly', '0 * * * *',
  $$ select net.http_get('https://<PROJECT-REF>.supabase.co/functions/v1/winback-sweep?key=<SWEEP_SECRET>') $$
  -- Preferred since 2026-09-30 (secret out of the URL/logs):
  -- $$ select net.http_post('https://<PROJECT-REF>.supabase.co/functions/v1/winback-sweep',
  --      headers := '{"x-sweep-key":"<SWEEP_SECRET>"}'::jsonb) $$
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
- [ ] `NEXT_PUBLIC_DODO_ENV`: `test` on Preview (and on Production while it
      still points at dev + Dodo test mode); `live` on Production at go-live.
      It decides where kinderwell.app/manage sends subscribers — `test` →
      Dodo's TEST customer portal, anything else → the live one (review
      2026-10-07, B-10) — and `live` disables the dev-skip buttons. Check after
      every Production change: `curl -sI https://kinderwell.app/manage` →
      `location:` on `customer.dodopayments.com`, not `test.customer…`.

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

- [x] `app/legal/*` filled (2026-09-19) and brought in line with the code
      (2026-10-07, §8.10). Keep them true: the refund policy's 14 days must
      match the /offer page, and the privacy policy must change whenever the
      code changes what it collects or who receives it.
- [x] **Proof stats** — owner confirmed 2026-10-07 that "83% of parents"
      and the "two weeks" claims are real; keep how each was measured on
      file (Meta ad review and the FTC can ask). "12 lessons" / "10-week
      path" / "Week 10" did not match the app and were fixed in code
      (review B-12). Same checklist as the app's
      `docs/specs/variant-b-onboarding-copy.md`.

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
      `NEXT_PUBLIC_`), then redeploy Vercel. Without it, anyone can call the
      edge functions directly with the public anon key. **Since 2026-09-30 the
      functions refuse every funnel request without it, in test mode too** —
      set it BEFORE deploying the new functions or email capture and checkout
      break. (Local `supabase functions serve` only: `ALLOW_UNAUTHENTICATED_FUNNEL=1`.)
- [ ] **`MAILING_ADDRESS`** secret — a real postal address (a PO box or virtual
      mailbox is fine). CAN-SPAM requires one in every marketing email; in
      live mode the win-back emails refuse to send without it.
- [ ] **`UNSUBSCRIBE_SECRET`** — **required since 2026-10-05** (`openssl rand -hex 32`).
      It signs unsubscribe and resume links; the old fallback to
      SWEEP_SECRET is gone (review P3-1). Without it the sweep sends no
      win-back emails (cancel retries still run) and resume/unsubscribe links
      answer 503. Never rotate it casually: rotation breaks every link already
      emailed.
- [ ] Optional secret: `ALERT_EMAIL` (else alerts go to SUPPORT_EMAIL).
- [ ] **Vercel Firewall → rate-limit rule** on `/api/capture-email` and
      `/api/create-checkout` (e.g. 10 requests / minute / IP). This is what
      stops a script from creating thousands of accounts and making us email
      strangers — which gets the sending domain blocklisted.
- [ ] **Dodo → Settings → Communication → Customer Emails:** turn ON
      *Upcoming Renewal Reminder* (the refund policy promises a renewal
      reminder) and the refund/subscription lifecycle emails.
- [ ] **Dodo → Webhooks:** turn on failure email alerts for the endpoint.
- [ ] **Customer portal:** `/manage` defaults to Dodo's Unified Customer
      Portal (`customer.dodopayments.com`, documented, works). Better: set
      `NEXT_PUBLIC_DODO_PORTAL_URL` in Vercel to the business-specific login
      `https://customer.dodopayments.com/login/<business_id>` (test mode:
      `https://test.customer.dodopayments.com/login/<business_id>`; business
      id is in the Dodo dashboard). Check it NOW in test mode, not after
      launch: sign in with a test buyer's email and confirm the subscription
      shows with a Cancel button (review P1-1).
- [ ] **Refunds from the Dodo dashboard now auto-cancel the subscription** and
      revoke access (the webhook does it). Partial refunds deliberately do
      neither — you get an alert email and decide.
- [ ] **Meta test run:** set `META_TEST_EVENT_CODE` from Events Manager → Test
      events, run one test purchase, confirm ONE deduplicated Purchase with
      email + external_id matched, then **delete the secret**.
- [ ] **Testimonials:** every review on /start, /email and /offer must be from a
      real customer who said it (names can be changed, words can't be
      invented). Replace or remove any that aren't — see OPS_RUNBOOK §1b.

## 8.7 Fixes from the 2026-09-30 external review — before the first ad dollar

Code is in `40eaa96`, `66f32c8` and `f556fc8`; every finding's status is
marked inline in `reviews/PROD_REVIEW.md`. What only you can do, **in this order**:

- [ ] **`FUNNEL_PROXY_SECRET` first** (§8.6) — the new functions fail closed
      without it, in test mode too.
- [ ] **Apply migration** `20260930000000_webhook_hardening.sql` (dev now,
      prod in §9), same way as the others: copy into
      `~/mamalearn/supabase/migrations/` and push from there. Additive: new
      columns on `entitlements` / `webhook_events` (with a backfill so existing
      subscribers don't get a second welcome email), a longer expiry grace
      for `active` rows, and the `rate_limit_hits` table + `hit_rate_limit()`
      function the funnel's rate limits use.
      `cp supabase/migrations/20260930000000_webhook_hardening.sql ~/mamalearn/supabase/migrations/`
- [ ] **Apply migration** `20261005000000_event_ordering.sql` the same way
      (added 2026-10-05, review P2-17): one nullable column,
      `entitlements.last_event_at`. The webhook writes it, so it must exist
      first.
      `cp supabase/migrations/20261005000000_event_ordering.sql ~/mamalearn/supabase/migrations/`
- [ ] **Set `UNSUBSCRIBE_SECRET`** (§8.6) — now required.
- [ ] **Then deploy the six functions** (§2.3 — `resume` is new) with
      `scripts/deploy-functions.sh`. They read the new columns; deploying
      before the migrations breaks the webhook. The seventh, `mint-handoff`,
      is not part of this step: it is deployed in §8.9 step 3 (from `main`,
      like everything since 2026-10-07), after its own migration.
- [ ] **Vercel env:** `NEXT_PUBLIC_DODO_BUSINESS_ID` = your Dodo business id
      (dashboard) so `/manage` opens Dodo's Kinderwell-specific login. Redeploy.
- [ ] **Vercel firewall rule** (§8.6) is still worth adding on top: the code
      now limits per IP/email itself (10 captures/min/IP, 40/hour/IP, 5/hour
      per address; 20 checkouts/min/IP), but the firewall stops traffic before
      it costs a function call.
- [ ] **Sweep cron:** optionally move `SWEEP_SECRET` from the URL to an
      `x-sweep-key` header (`net.http_post(url, headers := …)`) so it stops
      appearing in logs. The `?key=` form still works.
- [ ] **Check CI is green** on the commit you deploy (PR → Checks: `site`,
      `functions`, `backend`, `e2e`). `npm test` runs the fast part locally;
      the database and integration tests need Docker and run in CI.
      `scripts/deploy-functions.sh` checks this for you.
- [ ] **Extra §7 checks** (all in test mode except the refund):
  - Buy, then tap "Get my plan" again within 30 min → same checkout comes
    back, no second charge possible.
  - Watch Dodo → Webhooks → Message attempts for one purchase: whatever order
    the 4 events land in, exactly ONE welcome email and ONE CAPI Purchase.
  - Confirm the email field on Dodo's checkout page is locked.
  - **Price guard:** temporarily set `NEXT_PUBLIC_PRICE_ANNUAL` in a Vercel
    *preview* to a wrong value → "Get my plan" says pricing is being updated
    and you get a `[Kinderwell alert] Checkout blocked` email. Revert.
  - **Resume link:** capture an email, wait for the 1-hour win-back email (or
    run the sweep), open its button in a DIFFERENT browser → lands on your
    plan with your answers; "This is me" → /offer works; the purchase shows
    under the same user.
  - **Open in Safari:** on /offer inside the Instagram in-app browser, tap
    "Prefer Apple Pay? Copy a link for Safari", paste in Safari → same offer,
    Apple Pay visible (with a card in Wallet).
  - (Live, with the refund test) refund, then buy again with the same email →
    entitlement goes back to `active` with the NEW subscription id.
  - From an **Instagram ad preview on an iPhone** with a card in Wallet: run
    the funnel in the in-app browser AND in Safari. Expect no Apple Pay in the
    in-app browser (Apple doesn't allow it there) — make sure card entry is
    painless (review P1-5).

## 8.8 Tests and CI — owner steps (added 2026-10-05)

The test suite is in code (README → Tests); these parts are dashboard or
judgement steps.

- [ ] **Capture real Dodo payloads** to replace the schema-built fixtures —
      steps in `supabase/functions/_fixtures/dodo/README.md`. Do it during the
      §7 test purchase/refund. Until then the webhook tests prove our logic,
      not our assumptions about Dodo's payloads.
- [ ] **Turn on branch protection for `main`** (GitHub → Settings → Branches
      → Add rule → require status checks `site`, `functions`, `backend`,
      `e2e`). Until then CI reports problems but nothing stops a red merge —
      and Vercel deploys whatever lands on `main`.
- [x] **Merge PR #1** (`test/coverage`) — merged 2026-10-07 together with
      PR #3; the site is live, the functions are not deployed.
- [ ] Optional — **weekly preview check:** GitHub → Settings → Secrets and
      variables → Actions: variable `E2E_BASE_URL` (a stable preview URL) and
      secret `VERCEL_BYPASS_SECRET` (Vercel → Settings → Deployment
      Protection → Protection Bypass for Automation). Each run creates one
      test user and one unpaid Dodo test checkout.
- [ ] Decide review P3-23 (turn away ages 0–1 / 13–17?) — a `todo` test in
      `lib/quiz/questions.test.ts` waits on it.

### Added 2026-10-05 with the remaining review fixes
- [ ] **During the §7 test purchase, check the new app profile:** Supabase →
      Table Editor → `user_profiles` → the buyer's row exists with
      `user_type` set. Then sign into the app with that email: no
      questionnaire, straight to the paywall-free home.
- [ ] **Meta Events Manager → Test events (with `META_TEST_EVENT_CODE`):**
      Lead, InitiateCheckout and Purchase each arrive from BOTH Browser and
      Server and are shown as deduplicated.
- [ ] **Read the updated privacy policy** (`/legal/privacy`, dated
      2026-10-05): it now discloses IP / browser / Meta cookie ids and the
      30- and 90-day retention. Make sure you're happy with the wording, and
      mirror it in the app's legal docs if they cover the website.
- [ ] **CSP:** after a few weeks of real traffic, search the Vercel logs for
      `[csp-report]`. If nothing comes from our own pages, change the header
      `Content-Security-Policy-Report-Only` → `Content-Security-Policy` in
      `next.config.mjs` (review P3-6).
- [ ] **Confirm two accepted risks** (reviews/PROD_REVIEW.md): P2-16
      (capture-email returns the user id — kept for web↔app analytics) and
      P2-13 (`/welcome` trusts Dodo's `status`; the server Purchase is the
      authoritative copy).
- [ ] **P3-21:** look at the webhook secret in Dodo's dashboard. If it starts
      with `whsec_`, the raw-string fallback in `_shared/signature.ts` can be
      dropped — tell me and I'll remove it.

## 8.9 Sign-in links for buyers (SPEC-21, added 2026-10-06)

What it does: after paying, a buyer taps **Get Kinderwell** on the welcome
page. That copies a one-time sign-in link and opens the App Store. When they
open the app, it offers to paste the link, and they're in: no sign-in screen,
no code. The welcome email gets an **Open Kinderwell** button with its own
link. The old email-code steps stay on both, as the fallback.

The links live on a new address, `open.kinderwell.app`. It has to be a
separate address: a link to the same site you're already on opens in Safari,
not in the app.

**Order matters:** the database change first, then the functions, then the
website. Dev first, then the same on prod.

- [ ] **1. Add the address in Vercel (about 5 minutes) — at least 24 hours
      before ANY v1.3.0 install** (TestFlight, ad hoc, App Review included).
      iOS fetches the association file through Apple's CDN when the app is
      installed; if it is missing then, iOS remembers "no association" until
      its next periodic refresh, so the email button and the link page open
      Safari for every early installer — and for App Review (review
      2026-10-07, B-9).
  1. Vercel → project **kinderwell-web** → **Settings** → **Domains**.
  2. Type `open.kinderwell.app` → **Add**. If it asks, choose "connect to
     an environment: Production" (not a redirect).
  3. Vercel shows one DNS record to add, usually **CNAME**, name `open`,
     value `cname.vercel-dns.com` (copy whatever Vercel shows).
  4. Namecheap → **Domain List** → kinderwell.app → **Manage** →
     **Advanced DNS** → **Add New Record** → **CNAME Record**. Host: `open`.
     Value: the one from Vercel. TTL: Automatic. Save (the green tick).
  5. Back in Vercel, wait for the domain to say **Valid Configuration**
     (a few minutes).
  6. Check, on BOTH hosts, from a terminal:
     ```bash
     curl -sI https://open.kinderwell.app/.well-known/apple-app-site-association   # 200, content-type application/json, no redirect
     curl -sI https://kinderwell.app/.well-known/apple-app-site-association       # the same
     ```
     The body starts with `{"applinks"` and lists one app id,
     `8B52Q4QNLH.com.kinderwell.app`. Opening https://open.kinderwell.app/
     should take you to kinderwell.app. (The code is live since 2026-10-07,
     so both work as soon as the domain is added.)
- [ ] **2. Database (dev):** apply `20261006000000_handoff_keys.sql`. It is
      the app repo's migration (copied here unchanged), so apply it the
      app's way, from `~/mamalearn` (`supabase db push` against dev). Skip
      if the app work already applied it to dev; Table Editor shows a
      `handoff_keys` table when it's there.
- [ ] **3. Functions (dev):** from a pushed commit with green CI, run
      `scripts/deploy-functions.sh capture-email create-checkout dodo-webhook mint-handoff`.
      (`mint-handoff` is new and needs no new secret. `capture-email` is in
      the list because Meta's Lead event id changed with this work: the live
      site already sends the new id, and the new capture-email sends its
      server twin with the same one. The old capture-email sends no server
      Lead, so nothing mismatches before this step.)
      ⚠️ **The live site uses the DEV Supabase project** (until §9), so this
      step on dev is also what switches the sign-in links on for
      kinderwell.app — see step 5.
- [ ] **4. Resend: keep click tracking OFF** (it is today). With it on,
      Resend rewrites every link in the email through its own address, and
      the sign-in button would open Safari instead of the app.
- [ ] **5. Going live = deploying `mint-handoff`.** The website code was
      merged and deployed on 2026-10-07 but stays dormant: while
      `mint-handoff` isn't deployed, `/welcome` shows today's steps. Once it
      answers (step 3, on the project the site uses), buyers are told to
      tap **Paste**, which only v1.3.0 understands. So deploy it **with or
      after** v1.3.0 is live in the App Store — or earlier only for the step 6
      test, while no ads run and Dodo is in test mode. Steps 2 and 4 are safe
      any time; step 1 is safe any time and must come first (24 h ahead).
      Two rules since 2026-10-07 (review B-1, B-3): a key is minted only for
      the browser that created the checkout that was PAID, and never when the
      purchase lands on an account older than its funnel session (an app user
      buying on the web, a returning lead, or someone paying with another
      person's email): those get the email-code steps, and you get a "Web
      purchase on an existing account" alert.
- [ ] **6. Test it once, end to end, in test mode (§7):** pay on an iPhone
      → tap **Get Kinderwell** → install the v1.3.0 build → open it → tap
      **Paste** → you land in the lessons. Also: tap **Open Kinderwell** in
      the welcome email on the iPhone: the app should open, not Safari.
      Last, the link page's own button, with the app installed:
      1. In the email, press and hold **Open Kinderwell** → **Copy Link**.
      2. Open Safari, paste the link into the address bar, and go. (Typing or
         pasting a link is the one way to see this page with the app installed.)
      3. Tap **Open Kinderwell** on that page. The app should open straight
         away, with no "Open in Kinderwell?" question from Safari. (If you
         used the email button first, the app will say the link was already
         used. That's fine: this step only checks how the app opens.)
- [ ] **7. Prod:** the same steps 2–3 on prod (the migration through the
      app's `scripts/db-push-prod.sh`), as part of the v1.3.0 release, close
      to the website merge (step 5): until both are out, Meta counts Leads twice.

## 8.10 Go-live checklist from the 2026-10-07 review (owner)

The review (`reviews/WEB2APP_PROD_READINESS_REVIEW.md`) consolidated
everything still undone into one ordered list. Its code findings are fixed on
`fix/prod-readiness-review` (website) and `release/1.3.0` (app). This is the
rest, adjusted for those fixes. **Order matters:** (A) before any ad spend,
(B) on dev before the device pass, (C) the prod flip in one sitting.

### (A) Before any ad spend
- [ ] Review and merge `fix/prod-readiness-review` (CI green: `site`,
      `functions`, `backend`, `e2e`), and push the app's `release/1.3.0`
      commits. **No new migrations** came with the fixes.
- [ ] Testimonials and stats: confirmed real (2026-10-07). File the evidence
      somewhere you can produce it (consent, the original messages, how
      "83%" and "two weeks" were measured).
- [ ] B-13: check the annual price in App Store Connect against the web's
      $59.99 ("Three prices must always agree", below).
- [ ] Vercel: add `open.kinderwell.app` + the Namecheap CNAME; the AASA
      `curl` checks pass on **both** hosts — **≥ 24 h before any v1.3.0
      install** (§8.9 step 1).
- [ ] Meta (§5): Business Manager "Kinderwell" + second admin, domain
      verified, BM-owned pixel → `NEXT_PUBLIC_META_PIXEL_ID`, CAPI token →
      `META_CAPI_TOKEN`; ids in OPS_RUNBOOK §2. Test run with
      `META_TEST_EVENT_CODE` (Lead, InitiateCheckout and Purchase each
      deduplicated browser + server), then **delete** the secret.
- [ ] Vercel: delete `NEXT_PUBLIC_DEV_SKIP`; a Firewall rate-limit rule on
      both `/api` routes; `NEXT_PUBLIC_DODO_BUSINESS_ID`;
      `NEXT_PUBLIC_DODO_ENV` per §6; `FUNNEL_PROXY_SECRET`.
- [ ] Dodo: live products (new `pdt_` ids), live key, new webhook endpoint +
      secret → **prod** ref; statement descriptor `KINDERWELL`;
      renewal-reminder and lifecycle emails ON (the refund policy promises a
      reminder before annual renewals); webhook failure alerts ON; the
      customer portal shows Cancel.
- [ ] Resend: click/open tracking OFF on the prod sending domain too.
- [ ] Superwall `subscription_gate`: "Use a different account" → custom
      action `switch_account`, published.
- [ ] PostHog: the two alerts the app's OPS_STATE marks "required before ad
      spend" (`paywall_skipped_by_superwall` > 1%, purchases −50% day over
      day). Web and server events now carry `environment`/`app_env`/`surface`,
      so filter on `environment = prod`.
- [ ] Sentry sourcemaps for 1.3.0 build 12.
- [ ] App v1.3.0 live (the app's `docs/releases/v1.3.0.md`): `release/1.3.0` →
      `main`, build from `main`, the first EAS build's entitlements show both
      `applinks:` domains, TestFlight upgrade test, App Review note about the
      setup link, sandbox tester under the post-transfer account, phased
      release on.
- [ ] Device pass on a real iPhone with a card in Wallet, in Safari **and**
      from an Instagram ad preview: quiz → pay → Get Kinderwell → install →
      Paste → Learn; the email's "Open Kinderwell" opens the app; the link
      page's button opens the app; `/manage` opens Safari; card entry is
      painless in-app; "Prefer Apple Pay? Copy a link for Safari" copies (or
      offers press-and-hold) and the link carries the plan into Safari;
      Instagram's own "Open in browser" shows the "saved, just not in this
      browser" card; the "tapped Get Kinderwell before the link arrived" path
      (review FE-10: does the App Store open inside Instagram's WebView?).
- [x] Legal (website): privacy policy and terms updated 2026-10-07 to what
      the site does (review §8). One support address,
      `kinderwellteam@gmail.com`. No postal address is published, as before.
- [ ] Legal (app, owner-only): mirror the site's changes in the app's
      `legal/` docs. Their privacy policy also says PostHog receives your
      email, which the app does not do (INVARIANTS #8); correct that line.
- [ ] OPS_STATE / OPS_RUNBOOK rows updated as each step lands.

### (B) Dev, before the device pass
- [ ] Dev Auth (§2.2): Magic Link **and** Confirm signup templates show
      `{{ .Token }}`; OTP length 6; SMTP via Resend; 100 emails/h; 60 s
      interval. Confirm each; test once with a never-used address.
- [ ] Dev secrets: `FUNNEL_PROXY_SECRET` (Supabase **and** Vercel, then
      redeploy Vercel), `UNSUBSCRIBE_SECRET`, `MAILING_ADDRESS` (§2.4). The
      dev migrations are already all applied (checked 2026-10-07).
- [ ] `scripts/deploy-functions.sh capture-email create-checkout dodo-webhook winback-sweep unsubscribe resume`
      from a green `main` — **not** `mint-handoff` yet.
- [ ] Deploy the app's new `delete-account` to dev (needs `DODO_API_KEY`,
      `DODO_ENV`; dev runs the 2026-07-11 version) and re-run E2E flow 6
      against it (review XR-18).
- [ ] Schedule the hourly sweep (§2.5, header form).
- [ ] `mint-handoff` to dev only for the one end-to-end handoff test, while
      no ads run (it switches the live site's links on).
- [ ] During the test purchase, capture the payloads
      `supabase/functions/_fixtures/dodo/README.md` lists, plus one
      `subscription.renewed` (test mode can force a renewal) and the
      `GET /payments/{id}` of a refunded payment; swap them in and run CI
      (review MP-13: `is_partial`, `refunds[]`, `total_amount`, `metadata` on
      `renewed`, the envelope `timestamp` and cents amounts are all still read
      from Dodo's schema, not from a real delivery).
- [ ] Preview EAS build, ad hoc install, the app's acceptance tests incl.
      refund, cancel, delete-as-web-subscriber, existing-user-buys-on-web (no
      one-tap link, email code works, owner alert arrives); the
      `user_profiles` row and "no questionnaire".
- [ ] Decide P3-23 (ages 0–1 / 13–17), P3-21 (`whsec_` prefix).

### (C) The prod flip, one sitting, in this order
1. [ ] `~/mamalearn/scripts/check-migration-parity.sh` (now also compares
       the access-rule case table) → `scripts/db-push-prod.sh` applies **all
       five** web migrations (prod is at `20260710010000`).
2. [ ] Prod secrets: the full §2.4 list (`DODO_ENV=live`, live ids/key/secret,
       `FUNNEL_PROXY_SECRET`, `UNSUBSCRIBE_SECRET`, `MAILING_ADDRESS`,
       `SITE_URL`, Resend, Meta, PostHog, `SWEEP_SECRET`, `APP_STORE_URL`,
       `PRICE_*`, `SUPPORT_EMAIL`, `ALERT_EMAIL`).
3. [ ] `delete-account` → prod (after the migrations, never before);
       `redeem-handoff --no-verify-jwt` → prod; `supabase functions list`
       shows the right JWT settings.
4. [ ] Prod Auth: OTP 6, both templates, SMTP with a separate prod Resend key,
       100/h, 60 s.
5. [ ] Website functions → prod with explicit names (§2.3); `mint-handoff`
       last and only once 1.3.0 is live.
6. [ ] Dodo live webhook endpoint → prod ref, confirmed by one delivery.
7. [ ] Vercel Production env → prod URL/key, `NEXT_PUBLIC_SITE_URL`,
       `NEXT_PUBLIC_DODO_ENV=live`, delete `NEXT_PUBLIC_DEV_SKIP`, redeploy;
       `curl -sI https://kinderwell.app/manage` → `customer.dodopayments.com`.
       Don't pause between 5 and 7.
8. [ ] Hourly sweep scheduled on prod.
9. [ ] One real-card purchase → refund → `revoked` + Dodo cancelled → replay →
       no resurrection → re-buy with the same email → `active` on the new
       subscription id; Apple Pay visible with a card in Wallet; one
       deduplicated Purchase in Events Manager.
10. [ ] OPS_STATE rows + OPS_RUNBOOK §1 updated.

## 9. Production flip (only after §7 passes)

- [x] **Dodo KYC/business verification APPROVED** (owner-reported 2026-09-28).
- [ ] Dodo live mode: **recreate both products** (product IDs do NOT carry
      over from test), new live API key, new webhook endpoint + secret.
- [ ] Supabase prod: migration via `scripts/db-push-prod.sh`; enable Email OTP;
      apply ALL FIVE migrations (`20260918…_web2app`, `20260928…_email_opt_outs`,
      `20260930…_webhook_hardening`, `20261005…_event_ordering`, `20261006…_handoff_keys`) BEFORE deploying the functions;
      deploy the functions against prod with explicit names (`scripts/deploy-functions.sh`,
      `mint-handoff` last and only once 1.3.0 is live); set secrets with `DODO_ENV=live`,
      the live key/product IDs/webhook secret, and `SITE_URL=https://kinderwell.app`
      — the full list is §2.4. The ordered one-sitting version is §8.10 (C).
- [ ] Vercel Production env vars: prod Supabase URL + anon key,
      `NEXT_PUBLIC_SITE_URL=https://kinderwell.app`, `NEXT_PUBLIC_DODO_ENV=live`
      (then `curl -sI https://kinderwell.app/manage` → `customer.dodopayments.com`).
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

**Status 2026-10-04:** all three are built (plus a paywall "Use a different
account" rescue and Dodo cancellation on account deletion) on the app's
`feat/web-purchase-unlock` branch, shipping in v1.3.0 — not yet released.
The owner steps they need are in `OPS_RUNBOOK.md` §1b.1.

## Three prices must always agree

`NEXT_PUBLIC_PRICE_*` (display) · Dodo products (charged) · App Store IAP
(parity policy). Change one → change all three the same day.

⚠️ **Open (review 2026-10-07, B-13):** the app's docs give the App Store
annual price as **$69.99** (`~/mamalearn/docs/RELEASE_CHECKLIST.md`,
`STOREKIT_SETUP_GUIDE.md`); the web charges **$59.99**. Owner to check App
Store Connect and settle it (deferred 2026-10-07). Until then the three do
not provably agree.
