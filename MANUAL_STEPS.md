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
cd ~/mamalearn && supabase db push        # linked to DEV per house rules
```
(Prod later, owner-run, via `scripts/db-push-prod.sh` — §9.)

### 2.2 Enable Email OTP auth
Dashboard → Authentication → Providers → **Email**: enable. Under Email
provider settings make sure **passwordless / OTP login** is allowed and set
OTP length 6. Do this on dev now, prod in §9. (The iOS app's "Continue with
Email" — Phase 0 app work — depends on this too.)

### 2.3 Deploy the edge functions
**Preferred since 2026-10-05: `scripts/deploy-functions.sh [names…]`** — it refuses to deploy
anything that isn't committed, pushed and green in CI, shows which project is linked, and
then runs the same `deploy --no-verify-jwt` commands as below.
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
  SWEEP_SECRET=$(openssl rand -hex 24)
```

### 2.5 Schedule the sweeper (hourly)
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

- [ ] **1. Add the address in Vercel (about 5 minutes).**
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
  6. Check: open https://open.kinderwell.app/.well-known/apple-app-site-association
     in a browser. You should see a short block of text starting with
     `{"applinks"`. Opening https://open.kinderwell.app/ should take you to
     kinderwell.app. (The code is live since 2026-10-07, so both work as
     soon as the domain is added.)
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
      test, while no ads run and Dodo is in test mode. Steps 1, 2 and 4 are
      safe any time.
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

## 9. Production flip (only after §7 passes)

- [x] **Dodo KYC/business verification APPROVED** (owner-reported 2026-09-28).
- [ ] Dodo live mode: **recreate both products** (product IDs do NOT carry
      over from test), new live API key, new webhook endpoint + secret.
- [ ] Supabase prod: migration via `scripts/db-push-prod.sh`; enable Email OTP;
      apply ALL FIVE migrations (`20260918…_web2app`, `20260928…_email_opt_outs`,
      `20260930…_webhook_hardening`, `20261005…_event_ordering`, `20261006…_handoff_keys`) BEFORE deploying the functions;
      deploy all seven functions against prod (mint-handoff since 2026-10-06); set secrets with `DODO_ENV=live`,
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

**Status 2026-10-04:** all three are built (plus a paywall "Use a different
account" rescue and Dodo cancellation on account deletion) on the app's
`feat/web-purchase-unlock` branch, shipping in v1.3.0 — not yet released.
The owner steps they need are in `OPS_RUNBOOK.md` §1b.1.

## Three prices must always agree

`NEXT_PUBLIC_PRICE_*` (display) · Dodo products (charged) · App Store IAP
(parity policy). Change one → change all three the same day.
