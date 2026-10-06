# Web2App — Ops Runbook

**What this is:** the living record of what is ACTUALLY deployed, where every
value lives, and how to operate/repair it. `MANUAL_STEPS.md` (same folder) is
the *plan* (what to do); this file is the *state* (what was done).

**Update this file whenever you change external state.** If it's stale, it's
worse than nothing.

Companion: `~/mamalearn/docs/OPS_STATE.md` (the app's own register — add rows
there too when prod goes live).

---

## 1. Current state (as of 2026-10-07)

| Layer | Status | Detail |
|---|---|---|
| Domain | ✅ live | `kinderwell.app`, Namecheap, auto-renew ON, WhoisGuard ON |
| DNS | ✅ live | Single A record `@` → `216.198.79.1` (Vercel). Namecheap BasicDNS. Parking page OFF, domain redirect REMOVED. |
| Hosting | ✅ live | Vercel project `kinderwell-web`, GitHub `mandeepv/kinderwell-web` (private), auto-deploys from `main` |
| Supabase (dev) | ⚠️ behind code | `<DEV_PROJECT_REF>` (kinderwell-dev) — only migration `…0918_web2app` applied and the 4 original functions deployed (**Sep 19 versions**). **Not applied:** `…0928_email_opt_outs`, `…0930_webhook_hardening`, `…1005_event_ordering`, and SPEC-21's `…1006_handoff_keys`. **Not set:** `FUNNEL_PROXY_SECRET`, `UNSUBSCRIBE_SECRET` (both now required). **Not deployed:** new code for all 7 functions (`capture-email`, `create-checkout`, `dodo-webhook`, `winback-sweep`, plus new `unsubscribe` and `resume`, and SPEC-21's new `mint-handoff`). Order and steps: MANUAL_STEPS §8.6 → §8.7. Deploy from `main` (everything is merged since 2026-10-07) with `scripts/deploy-functions.sh`: that code also carries the 2026-10-05 work: the buyer's app profile at first purchase, server-side Meta Lead/InitiateCheckout, event ordering, retention, and two bug fixes (§3). |
| Website code | ✅ `main` = everything, live | **Merged 2026-10-07** (PR #1 test coverage + review fixes, PR #3 SPEC-21); Vercel deployed it to production. The site works with the OLD (Sep 19) functions still on Supabase: new parts that need new functions stay dormant until those are deployed: server-side Meta Lead/InitiateCheckout, the buyer's app profile, the sign-in links (`/welcome` keeps today's steps while `mint-handoff` doesn't answer). Vercel Production still points at the **dev** Supabase project + Dodo test mode (§5 switches it). |
| Tests / CI | ✅ green on `main` | GitHub Actions on every PR and push to `main`: `site` (typecheck, lint, 120 Vitest, build), `functions` (55 Deno unit), `backend` (local Supabase: pgTAP `access`, `functions` and `handoff` tests + 89 integration tests, coverage gate ≥ 80% on the webhook, checkout and mint-handoff handlers), `e2e` (19 Playwright, iPhone WebKit). ~10 CI minutes per push (free tier: 2,000/month). **Branch protection on `main` is NOT on yet** — CI reports but does not block. Weekly preview workflow exists but is inert until configured (MANUAL_STEPS §8.8). Dodo test fixtures are schema-built, not captured. See README → Tests. |
| External review | 🟡 in progress | `reviews/PROD_REVIEW.md` (2026-09-30). Status marked inline under every finding. All P0/P1 code fixes done; what's left is owner/dashboard steps + P2/P3 leftovers. |
| Supabase (prod) | ⬜ untouched | `<PROD_PROJECT_REF>` (kinderwell) — NOTHING done yet, by design |
| Dodo | ✅ test mode working | 2 products, test API key, webhook `<WEBHOOK_ENDPOINT_ID>` (all event types). **Full purchase→entitlement loop verified.** **KYC APPROVED (owner-reported 2026-09-28)** → live mode is now *available*, but nothing is provisioned in it yet (see §5 steps 2–3). |
| Site routes | ✅ in code | `/` = brand homepage (App Store badge + quiz CTA), static. `/start` = the paid-ad landing (`?a=` variants, server-rendered). Ad params (`a`, `fbclid`, `utm_*`) hitting `/` are redirected to `/start` with the query intact (`next.config.mjs`). **Ad URLs should point at `/start`.** `/r/<token>` = resume link (win-back emails, "open in Safari"). `/manage` → Dodo portal. Mid-funnel pages send `X-Robots-Tag: noindex`. |
| Sign-in links (SPEC-21) | 🟡 merged, dormant | Website half **merged to `main` 2026-10-07** (PR #3; CI green). Dormant until `mint-handoff` and the `…1006_handoff_keys` migration are deployed to the Supabase project the live site uses — today that is **dev**, so deploying them to dev switches the links on for kinderwell.app. **Deploying `mint-handoff` is the go-live: do it with or after app v1.3.0 is live** (an older app has no Paste screen). Buyers then open the app already signed in: `/welcome`'s **Get Kinderwell** copies a one-time link, the email gets an **Open Kinderwell** button, `open.kinderwell.app/k/<key>` serves the no-app fallback page. Also needs the Vercel domain `open.kinderwell.app`. Owner steps: MANUAL_STEPS §8.9. App half (redeem-handoff, paste screen): `~/mamalearn`, SPEC-21. |
| Resend (email) | ✅ verified + sending | `kinderwell.app` (root, branded sender) + `mail.kinderwell.app` (fallback), region **us-east-1**, click/open tracking OFF (hurts transactional deliverability). DKIM+2 CNAMEs+DMARC live in Namecheap and verified by `dig`. `RESEND_API_KEY` + `EMAIL_FROM` set in Supabase. **Verified 2026-09-19** — a live API send returned a message id. NOTE: the API key is scoped to sending only, so it cannot read domain status; test by sending, not by querying. |
| Meta pixel/CAPI | ⬜ not started | Funnel runs; no ad attribution until configured |
| iOS app (Phase 0) | 🟡 code done, not shipped | Built 2026-10-04 in `~/mamalearn` on branch `feat/web-purchase-unlock` (8 commits, stacked on `design/onboarding-lesson-revamp`), shipping in **app v1.3.0 (build 12)**. Local only — not pushed, not on a device yet. **Web buyers still cannot unlock the app until 1.3.0 is live in the App Store.** Details + owner steps: §1b.1 and §3 (2026-10-04). |

### Verified working (smoke test, 2026-09-19)
`capture-email` → creates Supabase auth user + funnel_sessions row → returns userId.
`create-checkout` → resolves user, dup-guard passes, calls Dodo test API →
returns a real `https://test.checkout.dodopayments.com/session/cks_…` URL with
`supabase_user_id` + `event_id` in metadata. **The account-linking mechanism is live.**

---

## 1b. Launch blockers — what must be true before the first ad dollar

Ordered. Nothing below is optional.

1. **iOS app Phase 0 must be LIVE in the App Store.** Until then a web buyer
   pays, installs, and hits the hard paywall as a paying customer. Spec:
   `03-app-changes.md`, superseded for the app by the "Kinderwell iOS — Web
   Purchase Unlock Spec" (Claude doc, 2026-10-04,
   https://claude.ai/code/artifact/e7024860-900e-4c7f-9d5a-f90587d8a18c).
   ~~Decision (2026-09-19): wait until the redesign is merged, then build on
   main.~~ **Decision changed 2026-10-04 (owner): Phase 0 ships IN app v1.3.0
   alongside the redesign.** It is built on its own branch,
   `feat/web-purchase-unlock`, stacked on `design/onboarding-lesson-revamp`,
   so the two are still reviewed and merged separately: **merge the redesign
   PR to main first, then the web-purchase PR, then release 1.3.0.** Code is
   done; what is left:

   **Owner steps — dev first (needed before ANY device test):**
   - [ ] Supabase → Authentication → Providers → **Email**: enabled, Email OTP
         length **6**.
   - [ ] Supabase → Authentication → Email Templates → **Magic Link**: body
         shows `{{ .Token }}`. With only `{{ .ConfirmationURL }}` buyers get a
         link instead of a code and cannot sign in inside the app.
   - [ ] Supabase → Authentication → **SMTP**: custom SMTP via Resend —
         `smtp.resend.com`, port 465, user `resend`, password = a Resend API
         key, sender `hello@kinderwell.app`. The built-in mailer only
         delivers to project team members, a few an hour; without this real
         customers never get their code (the app reports
         `email_address_not_authorized` to Sentry when this is missing).
   - [ ] Supabase → Authentication → **Rate Limits**: raise "emails sent per
         hour" for launch traffic (e.g. 100).
   - [ ] Apply `…0928_email_opt_outs`, `…0930_webhook_hardening` and
         `…1005_event_ordering` to dev, set `FUNNEL_PROXY_SECRET` and
         `UNSUBSCRIBE_SECRET`, deploy the six website functions
         (MANUAL_STEPS §8.6 → §8.7). Until then test purchases go through the
         old webhook.
   - [ ] Deploy the app's changed **`delete-account`** function to dev (from
         `~/mamalearn`, on the feature branch). It now reads `DODO_API_KEY`
         and `DODO_ENV` — already secrets on this shared project — to cancel
         a renewing web subscription before deleting the user.
   - [ ] Superwall → the `subscription_gate` paywall: add a small text button
         **"Use a different account"** wired to the custom action
         **`switch_account`**. Open question: is the label OK, and does the
         current template allow a free-text button?

   **Then:** run the spec's acceptance tests on TestFlight against dev
   Supabase + Dodo test mode (card `4242…`). **Before App Review:** repeat
   the four Supabase Auth settings on **prod**, apply all three web2app
   migrations to prod via `~/mamalearn/scripts/db-push-prod.sh`, deploy
   `delete-account` to prod, and re-run the email-code test against prod.
   ⚠️ **Prod order: migrations BEFORE `delete-account`.** The new function
   reads `entitlements` before deleting anything; deployed first, every
   account deletion fails — organic users included.

   The app-side release runbook with all of this as tickable boxes (merge
   order, dev setup, acceptance tests, prod order):
   `~/mamalearn/docs/releases/v1.3.0.md` (on the app's feature branch until
   it merges). Test builds are the `preview` EAS profile (dev backend,
   ad hoc) — no TestFlight build points at dev.
2. **Meta setup (MANUAL_STEPS §5)** — Business Manager, verify
   `kinderwell.app`, create pixel → `NEXT_PUBLIC_META_PIXEL_ID` in Vercel,
   generate CAPI token → `META_CAPI_TOKEN` in Supabase. ~30 min.
3. ~~Legal page placeholders~~ — **DONE 2026-09-19.** Filled from the app's
   own `legal/` docs so the two stay consistent: support address
   `kinderwellteam@gmail.com`, entity "Kinderwell", California governing law
   (clause added to the web Terms to match), dated 2026-09-19. No physical
   address is published, matching the app's existing policy.
   ⚠️ If the app's legal docs change, change these too — a customer can read
   both and they must not contradict.
4. ~~Reply-to address~~ — **DONE 2026-09-19.** Both email-sending functions
   now set `reply_to` from the `SUPPORT_EMAIL` secret
   (`kinderwellteam@gmail.com`), so replies reach a real inbox.
   **Why not the branded address:** Resend verified the SUBDOMAIN
   `mail.kinderwell.app`, not the root, and it refuses (403) to send from an
   unverified root domain. A Namecheap forwarder `hello@kinderwell.app` →
   `kinderwellteam@gmail.com` also exists but is currently unused.
   **DONE 2026-09-19:** the ROOT domain `kinderwell.app` is now verified in
   Resend (us-east-1, tracking off) and `EMAIL_FROM` is
   `Kinderwell <hello@kinderwell.app>`. Verified by a live send.
   Both domains stay registered in Resend and all 6 DNS records stay in
   Namecheap — the hosts differ (`resend._domainkey` vs
   `resend._domainkey.mail`) so they do not conflict, and `mail.` remains a
   working fallback.
   Replies are covered twice over: the `reply_to` header
   (`SUPPORT_EMAIL` = `kinderwellteam@gmail.com`) AND the Namecheap forwarder
   `hello@kinderwell.app` → `kinderwellteam@gmail.com`.

5. **Proof stats must be defensible.** The quiz keeps variant B's
   hard-hitting placeholder numbers by owner decision (Mirror beat's "83% of
   parents", the "two weeks" claims, "12 lessons"). On the web these are Meta
   ad-policy and FTC surface, not just App Review. Back them or soften them.
6. **App Store URL** — the live app is
   `https://apps.apple.com/us/app/kinderwell/id6758403231` (verified HTTP 200;
   `/us/` is deliberate since we target US only, and it avoids a redirect hop).
   ✅ `APP_STORE_URL` set in Supabase (handoff email).
   ✅ **Web side resolved 2026-09-28:** `lib/config.ts` now defaults
   `appStoreUrl` to this URL, so the homepage badge, /welcome button and
   desktop QR code work with no Vercel env var. `NEXT_PUBLIC_APP_STORE_URL`
   is now only an override.
7. **Delete `NEXT_PUBLIC_DEV_SKIP` from Vercel and redeploy** (see §2).
7b. ~~`NEXT_PUBLIC_DODO_ENV` must match `DODO_ENV`~~ — **no longer a checkout
   footgun (2026-09-30).** The overlay now reads test/live from the checkout
   URL the server returned (review P0-3: a mismatch used to leave a buyer who
   had PAID stuck on the overlay). `NEXT_PUBLIC_DODO_ENV` only guards the
   dev-skip buttons now; still set it to `live` at go-live.
8. ~~PostHog key~~ — **DONE 2026-09-19.** Set in both Vercel (browser) and
   Supabase (server-side webhook events), using the SAME project token as the
   iOS app so one person's ad-click → purchase → first-lesson journey is a
   single funnel.
   **Verified live 2026-09-19** — a real run produced
   `web_funnel_landing_viewed` → `quiz_started` → `quiz_step` ×N →
   `quiz_disqualified (android)`, plus autocapture clicks.
   *Two false alarms when verifying, both cost time:*
   (a) the key is inlined into `/_next/static/chunks/app/layout-*.js`, NOT the
   page HTML — grepping the HTML for `phc_` returns nothing and looks broken;
   (b) **an ad blocker silently drops PostHog requests**, so a desktop browser
   with one shows ZERO web events while the app's events keep flowing. Test
   from a phone or a clean profile before concluding anything is wrong.

9b. **Fixes from the 2026-09-30 external review (`reviews/PROD_REVIEW.md`) —
   MANUAL_STEPS §8.7.** Code done in `40eaa96`, `66f32c8`, `f556fc8`; status
   marked under every finding in the review doc. New migration
   `…0930_webhook_hardening` (apply BEFORE deploying the functions), a new
   sixth function `resume`, and the functions now **refuse every funnel
   request unless `FUNNEL_PROXY_SECRET` is set** — set it in Supabase AND
   Vercel before deploying, or the live site's email capture and checkout
   stop working.
9. **Hardening from the 2026-09-28 code review — MANUAL_STEPS §8.6.** Code is
   done; the owner steps (proxy secret, mailing address, migration + new
   function deploy, Vercel rate limit, Dodo toggles, Meta test run) are not.
   Two things the review found that were BROKEN, now fixed in code:
   (a) **refunds and disputes never revoked access** — Dodo's refund/dispute
   payloads carry no subscription_id or checkout metadata, so every one was
   parked in `unlinked_purchases`; the webhook now resolves payment_id →
   subscription via the Dodo API, revokes, and cancels the subscription so
   the customer isn't re-billed. `dispute.won` / `refund.failed` no longer
   revoke. **Re-test the refund path in live mode (§7) — it has never run.**
   (b) **/welcome fired the Meta Purchase for anyone who opened checkout**,
   paid or not; it now requires Dodo's `status=active|succeeded`.
9c. **Test-coverage work and the remaining review fixes (2026-10-05) — PR #1,
   MANUAL_STEPS §8.6–§8.8.** Merged to `main` and live on the site
   2026-10-07; the functions are NOT deployed. Before deploying them: set
   `FUNNEL_PROXY_SECRET` **and** `UNSUBSCRIBE_SECRET` (both now required),
   apply all five migrations (incl. `…1005_event_ordering` and SPEC-21's
   `…1006_handoff_keys`), then `scripts/deploy-functions.sh` from `main`.
   Also: turn on branch protection, capture real Dodo payloads for the test
   fixtures.
9d. **SPEC-21 sign-in links (2026-10-06) — MANUAL_STEPS §8.9.** Buyers open
   the app already signed in; without it, every ad-driven buyer has to pick
   the right sign-in button by hand. Merged to `main` 2026-10-07, dormant.
   Needs the Vercel domain `open.kinderwell.app`, the `…1006_handoff_keys`
   migration and four functions deployed, with `mint-handoff`'s deploy timed
   with or after app v1.3.0 (that deploy is what switches it on).
10. **Testimonials must be real.** The quotes on /start, /email and /offer
   (Sarah, Megan, Daniel, Aisha) — if they aren't from real customers, the
   FTC's 2024 fake-review rule makes each one a per-violation civil-penalty
   exposure, and Meta rejects ads landing on them. Replace or remove.

### Known gotcha when testing emails

The handoff email fires **only on first activation** (`subscription.active`
where the row was not already `active`). A repeat purchase by a user who
already has an entitlement row will NOT re-send it. **To test emails, run the
funnel with a fresh email address** so a new user and entitlement are created.

## 2. Where every value lives

Nothing secret is stored in this repo. This is the map of WHERE to look.

| Value | Lives in | Notes |
|---|---|---|
| `NEXT_PUBLIC_*` (site URL, prices, Supabase URL/anon key) | Vercel → Settings → Environment Variables | Public by design (compiled into the browser bundle). Type = **Config**, not Secret. |
| `NEXT_PUBLIC_DEV_SKIP` | Vercel env | **Preview skips. DELETE before ad spend** (MANUAL_STEPS §8.5) |
| Dodo API key, product IDs, webhook secret | Supabase → Edge Functions → Secrets (`supabase secrets list`) | Test mode today. `DODO_API_KEY` + `DODO_ENV` are ALSO read by the app's `delete-account` function (v1.3.0) to cancel a web subscription before deleting the user — rotating the key or switching to live affects it too. |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected into edge functions | NEVER in the Next.js runtime |
| `SWEEP_SECRET` | Supabase secrets | Guards `winback-sweep`; needed in the pg_cron URL |
| `RESEND_API_KEY`, `EMAIL_FROM`, `SUPPORT_EMAIL` | Supabase secrets | ✅ set 2026-09-19. `SUPPORT_EMAIL` feeds the `reply_to` header on every email. |
| `POSTHOG_KEY`, `POSTHOG_HOST` | Supabase secrets | ✅ set 2026-09-19 — same project as the iOS app (`phc_…`), so web + app events share one user journey |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | Vercel env | ✅ set + verified live in the layout chunk |
| Meta CAPI token / pixel id | Supabase secrets (`META_PIXEL_ID`, `META_CAPI_TOKEN`) + Vercel (`NEXT_PUBLIC_META_PIXEL_ID`) | ⬜ not yet. Used by THREE functions since 2026-10-05: capture-email (Lead), create-checkout (InitiateCheckout), dodo-webhook (Purchase). Unset → server events silently skipped. |
| `FUNNEL_PROXY_SECRET` | Supabase secrets **AND** Vercel (server env, NOT `NEXT_PUBLIC_`) — same value in both | ⬜ not set. **From the 2026-09-30 functions on, every funnel call is refused without it, test mode included** (fail-closed, review P2-15). Local `functions serve` only: `ALLOW_UNAUTHENTICATED_FUNNEL=1`. |
| `MAILING_ADDRESS` | Supabase secrets | ⬜ not set. Postal address for CAN-SPAM; win-back emails refuse to send without it **in live mode**. |
| `UNSUBSCRIBE_SECRET` | Supabase secrets | ⬜ not set. **Required since 2026-10-05** (no SWEEP_SECRET fallback, review P3-1) — signs unsubscribe links AND resume links (`/r/<token>`). Unset → no win-back emails (cancel retries still run), resume/unsubscribe answer 503. Rotating it breaks every link already emailed. |
| `ALERT_EMAIL` | Supabase secrets | Optional — owner alerts (unlinked purchase, dispute won, partial refund, cancel failure) go to `SUPPORT_EMAIL` if unset. |
| `META_TEST_EVENT_CODE` | Supabase secrets | **Temporary** — set only while verifying in Events Manager → Test events, then DELETE (while set, real purchases are sent as test events). |
| `NEXT_PUBLIC_DODO_BUSINESS_ID` | Vercel env | ⬜ not set. Makes `/manage` open Dodo's business-specific login (test/live host from `NEXT_PUBLIC_DODO_ENV`). Unset → Dodo's Unified Customer Portal, which also works. |
| `NEXT_PUBLIC_DODO_PORTAL_URL` | Vercel env | Optional full override for `/manage`. |
| `NEXT_PUBLIC_DODO_ENV` | Vercel env | `test` now, `live` at go-live. Since 2026-09-30 it only hard-disables the dev-skip buttons in live; checkout takes its mode from the checkout URL. |
| `NEXT_PUBLIC_PRICE_ANNUAL` / `_MONTHLY` | Vercel env | What the offer page shows. `create-checkout` now compares them to the Dodo product price and **refuses checkout + emails you** on a mismatch. |
| `PRICE_ANNUAL` / `PRICE_MONTHLY` | Supabase secrets | Fallback only — the welcome email and Meta Purchase value now come from Dodo's subscription payload. |
| Rate limits | Code (`capture-email`, `create-checkout`, `resume`) + Postgres `rate_limit_hits` | 10 captures/min/IP, 40/hour/IP, 5/hour per address; 20 checkouts/min/IP, 10 per session per 10 min; 20 resume calls/min/IP. Change in the function source. |
| Dodo dashboard login | Owner (Mandeep) | |
| Public review mirror | GitHub `mandeepv/webreview` (**PUBLIC**) | Redacted snapshots for outside reviewers — NOT a clone of this repo. Each commit is the whole tree of a real commit with these replaced: both Supabase project refs → `<DEV_PROJECT_REF>` / `<PROD_PROJECT_REF>`, the Dodo webhook endpoint id → `<WEBHOOK_ENDPOINT_ID>`, test product/subscription ids → `<TEST_…_ID>`, PostHog keys → `phc_…`; `supabase/.temp` left out. **Never `git push` a real branch there** — it would publish all of those. To update: `git archive` the commit, apply the replacements, check the same script reproduces the previous snapshot from its source commit, scan for refs/keys/ids/emails, then commit on top of its `main` as `27843773+mandeepv@users.noreply.github.com`. Last synced 2026-10-05: `a5b237f` → `7bf4097` (first snapshot: `fa25d99` → `3252895`). |

### ~~Open item — reply-to address~~ — RESOLVED 2026-09-19

`EMAIL_FROM` is now `Kinderwell <hello@kinderwell.app>` (root domain verified)
and every email sets `reply_to` = `SUPPORT_EMAIL`. Details in §1b.4.

### Known IDs

| What | Value |
|---|---|
| Dodo product — Annual $59.99/yr (**TEST**) | `<TEST_ANNUAL_PRODUCT_ID>` |
| Dodo product — Monthly $12.99/mo (**TEST**) | `<TEST_MONTHLY_PRODUCT_ID>` |
| Supabase dev ref | `<DEV_PROJECT_REF>` |
| Supabase prod ref | `<PROD_PROJECT_REF>` |
| Webhook endpoint (dev) | `https://<DEV_PROJECT_REF>.supabase.co/functions/v1/dodo-webhook` |

> ⚠️ **Dodo test product IDs do NOT work in live mode.** Live mode needs the
> products recreated and new IDs set. This is the #1 go-live footgun.

---

## 3. Change log — what was actually done

### 2026-09-19 — initial build-out (dev)

1. **Domain**: bought `kinderwell.app` (Namecheap, ₹1,071.91/yr incl. ICANN fee).
   Declined every upsell (SSL — Vercel provides free; PremiumDNS; hosting;
   business email). Removed the auto-created domain redirect and turned the
   parking page OFF — both would have fought the A record.
2. **DNS**: added A `@` → `216.198.79.1`. Propagated in <10 min. Vercel issued
   SSL automatically. (`.app` is HSTS-preloaded: while the cert is pending the
   site *hangs* rather than erroring — that is normal, not a fault.)
3. **Vercel**: imported the GitHub repo. First deploy landed as **Staged** —
   production domains were not auto-assigned. Fixed by promoting; enable
   "Auto-assign Custom Production Domains" to avoid a repeat.
4. **Migration history repair (important)**: dev had migration
   `20260711000000_add_onboarding_variant_columns` applied, but the file lives
   only on the `feature/variant-b-onboarding-redesign` branch, so `db push`
   refused to run. **Verified against prod first** (SQL query on
   `information_schema.columns`): prod does NOT have `onboarding_variant` /
   `variant_b_answers`. So dev was ahead of prod, and we ran
   `supabase migration repair --status reverted 20260711000000` to align them.
   **The columns still physically exist on dev** — only the history was
   changed. When variant B eventually merges, expect to reconcile this.
5. **Applied** `20260918000000_web2app.sql` to dev (additive only: 5 tables,
   2 functions, RLS on everything).
6. **Secrets**: 8 set on dev (Dodo key/env/2 product IDs, SITE_URL, both
   prices, SWEEP_SECRET).
7. **Functions**: all 4 deployed with `--no-verify-jwt`. This is required
   because the project uses the new `sb_publishable_*` API keys, which are not
   JWTs — with JWT verification on, every call from the site 401s.
8. **Smoke test passed** (see §1).

### 2026-09-28 — brand homepage + production-readiness review (CODE ONLY)

**Committed + pushed 2026-09-30 (`6cef1d7`)** — the website is live via Vercel.
**Still NOT done:** migration `…0928_email_opt_outs` not applied (copied
into `~/mamalearn/supabase/migrations/` 2026-10-04, on the app's
`feat/web-purchase-unlock` branch); the 5 edge functions not
redeployed. Apply the migration BEFORE deploying the functions. Until then the
new site runs against the Sep 19 functions: refund/dispute revocation is not
active and unsubscribe links don't work. Owner steps: MANUAL_STEPS §8.6.

- **Routes:** `/` is now the brand homepage; the ad landing moved to `/start`
  (ad params hitting `/` redirect there). New: `/manage` (→ Dodo customer
  portal), `/unsubscribe` + `/api/unsubscribe`.
- **Webhook — refunds/disputes were silently broken** (never revoked; see
  §1b.9). Now: payment_id → subscription via Dodo API, revoke, and PATCH the
  Dodo subscription to `cancelled`. Revoking events: `refund.succeeded`
  (full only), `dispute.opened|accepted|lost`. `dispute.won` and partial
  refunds email the owner instead.
- **Owner alerts** by email (`_shared/email.ts` → `alertOwner`): unlinked
  purchase, dispute won, partial refund, failed auto-cancel.
- **Meta:** PageView on every route change; `autoConfig` off; advanced
  matching (email + hashed user id as `external_id`) on pixel AND CAPI; CAPI
  event_id prefers the PAID checkout's id; last-click fbclid; /welcome fires
  Purchase only on Dodo `status=active|succeeded`.
- **Security:** edge functions require `FUNNEL_PROXY_SECRET` via the `/api`
  proxy (hard-required in live mode); body size + UUID validation on
  capture-email; HTML-escaped emails; security headers in `next.config.mjs`;
  dev-skip buttons can never render when `NEXT_PUBLIC_DODO_ENV=live`.
- **Email compliance:** win-back emails carry an unsubscribe link, RFC 8058
  one-click headers, and `MAILING_ADDRESS`; opt-outs in `email_opt_outs`.
- **Copy:** offer page/FAQ/handoff email point to `kinderwell.app/manage`
  instead of a nonexistent "account page"; privacy policy corrected (first
  name is collected); 409 "already subscribed" message on the offer page.
- **Verified locally:** `tsc`, `deno check` on all 5 functions, `next build`,
  route/redirect/header smoke test, screenshots at desktop + 390px.
  **NOT verified:** anything against Dodo, Supabase, Meta or Resend — the
  refund path in particular has never run end to end.

### 2026-10-07 — everything merged to `main` and live on the site (functions NOT deployed)

PR #3 (SPEC-21, website half) merged into `test/coverage`, then PR #1 into
`main`, both CI-green; Vercel deployed `main` to production. kinderwell.app
now runs: the 2026-09-30 review fixes, the 2026-10-05 fixes (CSP report-only,
link-preview image, privacy policy with retention, quiz Back, pixel timing),
the hashed Lead event id, and the SPEC-21 pages (`/k/<key>` and the AASA
file on both hosts; `/welcome`'s handoff UI). Everything that needs NEW
functions is dormant because Supabase still runs the Sep 19 functions:
- `/welcome` shows today's steps: `/api/mint-handoff` gets no link (the
  function doesn't exist yet), so the page never says "tap Paste".
- No server-side Lead/InitiateCheckout, no app profile, no event ordering,
  no retention — those live in the functions and the sweep.
- The browser's Lead pixel already uses `lead-<sha256(sessionId)>`; the old
  capture-email sends no server Lead, so nothing mismatches. Deploy the new
  capture-email and its server Lead uses the same id.

What remains is all owner-side: secrets, migrations, `scripts/deploy-functions.sh`
from `main` (MANUAL_STEPS §8.6–§8.9), with `mint-handoff` timed with or after
app v1.3.0; branch protection; the public review mirror re-sync.

### 2026-10-06 — SPEC-21 sign-in links, website half (CODE ONLY, PR #3, not merged or deployed)

Spec: `~/mamalearn/docs/specs/SPEC-21-purchase-handoff.md` (the app half
lives there too). Local runs: 55 Deno unit, 120 site, 19 browser tests, all
green; build OK. The new pgTAP file and the integration tests (M0–M9, C10,
W25) need Docker, so they run only in CI. **CI, 2026-10-07: all green** — pgTAP
incl. `handoff_test.sql`, 89 integration tests, 19 browser tests;
`mint-handoff/handler.ts` 91.8% lines (coverage gate ≥ 80%). One fix on the
way: browser test B3 assumed WebKit never loads apps.apple.com (true on
macOS, not on Linux CI); its recorder now cancels that tap after noting the
page let it through.

- **Migration `20261006000000_handoff_keys.sql`** — authored in the APP repo
  this time, copied here unchanged (+ its pgTAP test `handoff_test.sql`).
  `handoff_keys` (sha256 of each key, service role only, single use, ≤ 7
  days) and `funnel_sessions.handoff_nonce_hash`.
- **`create-checkout`** stores the sha256 of a browser-only nonce (made on
  `/offer`, kept in localStorage `kw_handoff`). Written after the duplicate
  guard, so nobody can swap it once the purchase has landed; its own write,
  so a missing column never costs the CAPI keys.
- **New `mint-handoff`** (via `/api/mint-handoff`): sessionId + nonce →
  `{ link }` when the purchase landed < 24 h ago and the entitlement is
  active. 404 for a wrong nonce or unknown session alike; 409 while the
  webhook hasn't landed (the page retries for about a minute); 5 keys per
  session a day; attempts limited per IP and session. In the CI coverage
  gate (≥ 80%) with the webhook and checkout.
- **`dodo-webhook`** mints a key at first activation and adds an **Open
  Kinderwell** button to the welcome email, above the email-code steps
  (kept as the fallback). Not when the checkout email differs from the
  account (a credential goes to the account's own inbox only), and not if
  the mint fails (no migration yet): the email then goes out as before.
- **`/welcome`**: with a link, the iPhone button reads **Get Kinderwell**
  (copies the link inside the tap, then follows the App Store link), plus
  "Already have the app? **Open Kinderwell**"; desktop's QR code holds the
  link. Without one (another browser, refused, timed out) the page is
  exactly as before. New PostHog events, outcomes only:
  `web_funnel_handoff_link {result}`, `web_funnel_get_app_tapped {link,
  copied}`, `web_funnel_open_app_tapped`.
- **`open.kinderwell.app`**: `/k/<key>` is a bare route handler (no layout,
  so no pixel/PostHog; nothing loaded from anywhere; `no-referrer`,
  `no-store`, noindex, an enforced hash-pinned CSP). It never looks the key
  up. Its "Open Kinderwell" is the same key on `kinderwell.app` (another
  host, so iOS opens the app without Safari's "Open in Kinderwell?"
  question, which a `kinderwell://` link would raise).
  `/.well-known/apple-app-site-association` (served on both hosts) claims
  `/k/*` for team `8B52Q4QNLH`, `com.kinderwell.app` and `.dev`; the app
  must list both `applinks:open.kinderwell.app` and `applinks:kinderwell.app`.
  Every other path on `open.kinderwell.app` redirects to kinderwell.app
  (`next.config.mjs`).
- **The Lead event id is now `lead-<sha256(sessionId)>`** (browser and
  `capture-email` alike, one pinned test vector in each), so the session id
  (half of what mints a link) no longer reaches Meta. It still reaches
  processors: Dodo's checkout metadata (`funnel_session_id`) and the resume
  links in win-back emails. Deploy `capture-email` from this branch in the
  same window as the site merge, or Leads stop deduplicating until both are out.
  *(2026-10-07: not an issue in practice — the capture-email deployed today
  is the Sep 19 one, which sends no server Lead, so there is nothing to
  deduplicate until the new one is deployed, and that one uses the new id.)*
- **CSP reports can't carry a key:** `/k/*` is left out of the site-wide
  report-only policy (it enforces its own strict one, with no reporting),
  and `/api/csp-report` blanks `/k/<…>` in anything it logs. `/k/*` sends
  `X-Robots-Tag: noindex, nofollow, noarchive`.
- **Known limit:** Vercel's request log records `/k/<key>` paths. The key
  is single use and ≤ 7 days, and only the owner can read the log.

### 2026-10-05 (later) — remaining review fixes + the buyer's app profile (CODE ONLY, on `test/coverage`, not deployed)

All on PR #1; every CI job green (44 Deno unit, 92 site, 46 pgTAP, 74
integration, 14 browser tests).

- **App profile at first purchase (03-app-changes §5, `a5ebcbc`):** the
  webhook inserts the buyer's `user_profiles` row from their quiz answers
  (`user_type`, `name`, `children_count`, `children`, `experience_level`)
  so the app skips its questionnaire. Insert only — an existing profile is
  never touched. No row without a valid role. `goals`/`mood` unmapped in
  v1. Best-effort; sends `web_profile_created` to PostHog. This removes the
  "answers the app questions, then signs in twice" rough edge once deployed.
- **Server-side Meta Lead + InitiateCheckout (P2-2, `075cdad`):** sent by
  capture-email / create-checkout with the browser pixel's event ids
  (`lead-<sessionId>`, `ic-<eventId>`), after the response. One sender for
  all CAPI events in `_shared/meta.ts`.
- **Event ordering (P2-17, `273e4d2`):** new column
  `entitlements.last_event_at` (migration `…1005_event_ordering`); older
  events for the same subscription are ignored.
- **`UNSUBSCRIBE_SECRET` required (P3-1):** no SWEEP_SECRET fallback.
- **Retention (P3-18):** sweep clears ad-matching data after 30 days and
  deletes unlinked sessions after 90; privacy policy updated and dated
  2026-10-05.
- **Report-only CSP (P3-6)** with `/api/csp-report` → Vercel logs
  `[csp-report]`; **link-preview image (P2-5)**; quiz Back uses history
  (P3-25); pixel user data without the 1.5 s timer (P3-5); `/welcome` no
  longer flashes the App Store button on desktop (P3-26).
- **Accepted, not changed (owner to confirm):** P2-16 and P2-13 — reasons in
  reviews/PROD_REVIEW.md.
- **Owner steps added:** MANUAL_STEPS §8.6 (UNSUBSCRIBE_SECRET), §8.7 (4th
  migration), §8.8 "Added 2026-10-05".

### 2026-10-05 — test coverage + two bug fixes (CODE ONLY, pushed to `test/coverage`, not deployed)

Implemented the "Kinderwell Web — Test Coverage Spec" (Claude Docs). Draft
PR #1 on GitHub; all four CI jobs green. Nothing deployed.

- **Structure (no behaviour change):** each edge function's logic moved from
  `index.ts` into `handler.ts`; `index.ts` now only does
  `Deno.serve(handler)`. Deploy commands are unchanged. One shared
  `hasAccess()` rule in `_shared/entitlement.ts` replaces three copies.
  `create-checkout`'s price cache moved into a per-handler `PriceGuard`.
- **Tests:** see README → Tests. Integration tests run every function against
  a real local Supabase in CI with Dodo/Resend/Meta/PostHog faked and
  recorded; pgTAP covers RLS and the SQL functions; Playwright covers the
  funnel and /welcome. A deliberate-breakage run (closed PR #2) confirmed CI
  catches a broken refund guard, duplicate-purchase guard and entitlements
  RLS policy.
- **Bug fixed — win-back starvation (`b9b38fd`):** the lead ladder and the
  "paid but never signed in" nudge fetched rows that weren't due, oldest
  first, in fixed batches (50 / 200). Leads that already had email 1, and
  customers who had signed in, held the batch, so new leads could wait up
  to a day for the 1-hour email and, past ~200 web subscribers, new buyers
  would stop being nudged. Now only due rows are fetched; signed-in
  customers' nudge ladder is closed (`nudge_stage = 2`).
- **Bug fixed — concurrent first purchase (`a4a1ca8`):** two simultaneous
  first-purchase deliveries could collide on the unique
  `dodo_subscription_id` and return 500. No customer impact (the winner had
  granted access; Dodo's retry succeeds) but it meant failed deliveries in
  Dodo and possible failure alerts. Now re-reads and decides again once.
- **New files:** `scripts/deploy-functions.sh` (deploys only a committed,
  pushed, CI-green commit; asks before deploying), `supabase/config.toml`
  (local Supabase for tests only), `.github/workflows/weekly-preview.yml`.
- **Owner steps it adds:** MANUAL_STEPS §8.8.
- **Observation, no action:** Next's `redirect()` on `/welcome` keeps the
  original query (incl. `email`) in the 307 response body's router data.
  Browsers never render a 307 body, and the landed URL is clean, so nothing
  reaches the pixel or PostHog.

### 2026-10-04 — iOS app Phase 0 built (APP REPO, CODE ONLY, not pushed/deployed)

In `~/mamalearn`, branch `feat/web-purchase-unlock` (stacked on
`design/onboarding-lesson-revamp`; ships in app v1.3.0). Nothing external was
changed: no dashboard, no deploy, no migration applied.

- **Migrations:** all three web2app migrations (`…0918`, `…0928`, `…0930`)
  copied verbatim into the app repo's `supabase/migrations/` — the canonical
  home, as their headers say. App types regenerated from dev, so they include
  `entitlements` (dev has only `…0918`).
- **Sign-in:** AuthScreen gains **"Continue with Email"** (6-digit code via
  `signInWithOtp` / `verifyOtp`, never a magic link). Welcome's **Sign in** is
  now an outline button under **Get started**. All quoted labels unchanged.
- **Launch gate:** after the cached/demo short-circuits and before Superwall,
  the app reads the user's own `entitlements` row (4s cap) and enters on
  status `active|past_due|cancelled` AND `current_period_end > now` — the
  app checks the date itself. Error/timeout fall through to Superwall.
  Event: `web_entitlement_checked { result }`.
- **Superwall would have wiped every web unlock:** web buyers are INACTIVE to
  Superwall, and the app cleared its cached flag on every INACTIVE. The flag
  now records its source (`web` | `superwall`); INACTIVE clears only a
  Superwall one.
- **Refunds:** a launch on a cached web flag re-checks in the background; a
  revoked/expired row clears it, so the launch after that gates.
- **Wrong account (Hide My Email):** the paywall's "Use a different account"
  (`switch_account`) signs out and opens sign-in. Event
  `gate_switch_account_tapped`.
- **Settings:** web subscribers see "Your subscription is managed at
  kinderwell.app/manage" — the app's only link to the site, shown only to
  them (App Store 3.1.3).
- **Account deletion:** the app's `delete-account` function cancels a renewing
  Dodo subscription (`PATCH /subscriptions/{id}` → `cancelled`, copied from
  `_shared/dodo.ts`) BEFORE deleting anything, and returns 409
  `subscription_cancel_failed` — deleting nothing — if the cancel fails.
- **Verified locally:** `tsc`, 300 Jest tests (each commit on its own),
  lint at baseline, `deno check` on `delete-account`.
  **NOT verified:** anything on a device or against real Supabase Auth email,
  Dodo or Superwall.
- **For the webhook's planned `user_profiles` creation (checked 2026-10-05):**
  the app counts a profile as onboarded ONLY when **`user_type`** is non-null
  (`'father' | 'mother' | 'other'`). A web-created row without it still sends
  the buyer through the app's questions. Nothing else in the app assumes the
  app wrote the row; its later save is an upsert on `id` that overwrites only
  the fields it sends. App-side tracking: `~/mamalearn/docs/BACKLOG.md` #27.
- **Known rough edge (accepted in the spec) — FIXED in code 2026-10-05
  (`a5ebcbc`), live once the functions are deployed:** until the webhook creates
  `user_profiles` at payment, a web buyer who taps Sign in is sent through the
  app's questions and then back to the sign-in screen, where they must sign in
  a second time (with email, a second code). They still unlock at the gate.

### 2026-09-30 — external production review + fixes (CODE ONLY, not pushed/deployed)

A friend reviewed a public snapshot (`mandeepv/webreview`, secrets and IDs
redacted). Report: `reviews/PROD_REVIEW.md` — 4 Critical, 17 High, 23 Medium,
27 Low. Status is marked under every finding in that file.

- **Commits:** `40eaa96` (money path), `66f32c8` (UX/privacy/hygiene + CI),
  `f556fc8` (remaining Highs), plus docs. **Local only — not pushed.** *(Pushed
  2026-10-05 on branch `test/coverage`, PR #1.)*
- **Critical, all fixed in code:** refunded buyers who re-buy now get access;
  welcome email + CAPI Purchase fire once per subscription in any webhook
  order (`activated_subscription_id`); overlay mode comes from the checkout
  URL, not an env var.
- **New:** migration `…0930_webhook_hardening` (columns + backfill + rate
  limit table + longer expiry grace), function `resume`, route `/r/<token>`,
  `/api/resume`.
- **Behaviour changes to know about:**
  - Functions fail closed without `FUNNEL_PROXY_SECRET` — set it first.
  - Checkout email is locked on Dodo's page; the welcome email goes to the
    account email.
  - A second live subscription for the same person is auto-cancelled and
    you get a "refund the newer subscription" alert.
  - Price mismatch between site and Dodo blocks checkout and alerts you.
  - The hourly sweep reconciles overdue `active` rows with Dodo before
    expiring, retries failed cancels, and alerts if renewals look broken.
  - Win-back emails link to `/r/<token>` and restore the quiz in any browser.
  - PostHog autocapture and session replay are OFF for the web funnel.
- **Verified locally:** `tsc`, ESLint, `next build`, `deno check` on all 6
  functions, 33 deno tests + 16 Vitest tests, route smoke tests (/start SSR,
  /welcome email strip, noindex headers, robots.txt, 404, /r/ success and
  failure paths against a mock function).
  **NOT verified:** anything against real Dodo / Supabase / Meta / Resend.

### 2026-09-19 — FULL PAYMENT LOOP VERIFIED (test mode)

A real test-mode purchase ($59.99 annual, card `4242…`) completed the entire
chain. Evidence:

- Dodo → Webhooks → Message attempts: **4 deliveries, all 200** —
  `subscription.active`, `subscription.renewed`, `payment.succeeded`,
  `subscription.updated`. No 401s (signature verification works against the
  real secret) and no 500s (handler clean).
- `webhook_events`: 4 rows — idempotency keys recorded.
- `entitlements`: 1 row — `status=active`,
  `product_id=<TEST_ANNUAL_PRODUCT_ID>`,
  `current_period_end=2027-09-19` (a year out, confirming the YEARLY cycle is
  configured right), `dodo_subscription_id=<TEST_SUBSCRIPTION_ID>`.
- `unlinked_purchases`: **empty** — the buyer was resolved from
  `supabase_user_id` in checkout metadata. Account linking works.

**Still untested** (MANUAL_STEPS §7 remainder): refund → `revoked` (blocked
in test mode, see below); the renewal-failure path with card
`4000 0000 0000 0069` → `past_due` keeps access until period end; and the
409 duplicate-purchase guard.

**Apple Pay: still UNVERIFIED.** The test checkout showed only card entry,
but the tester's iPhone had no card in Wallet — Safari hides the Apple Pay
button entirely in that case, so this proves nothing either way. Resolve
before ad spend: add a card to Wallet and retry, or ask Dodo support whether
Apple Pay is enabled for this account (it can require domain verification on
their side).

### 2026-09-19 — cancellation + replay verified

- **Cancel now** on the test subscription → webhook fired →
  `entitlements.status = cancelled` with `current_period_end` UNCHANGED
  (2027-09-19). Correct: a cancelled customer keeps access through the period
  they paid for; the daily sweep expires them at the end.
- **Replayed** the original `subscription.active` message from Dodo's
  "Replay this message" → status stayed `cancelled` and `updated_at` did not
  move. The idempotency guard (unique `webhook_events.id`) rejected it
  outright. A replayed activation cannot restore access.

**Refund → `revoked` is still UNTESTED**: Dodo test mode refuses refunds with
"insufficient funds in wallet" (a test-mode simulation limit, not our bug).
Verify it during the live-mode test purchase in §5 of this runbook — it is the
guard that stops refund fraud, so do not skip it.

### 2026-09-19 — full happy path verified, end to end

Fresh-email run (`…+test1@gmail.com`, Gmail plus-addressing creates a genuinely
new user since lookups are literal-string): quiz → email capture → checkout →
payment → webhook → entitlement → **handoff email received in the inbox**,
branded sender, correct two steps, correct email echoed back.

Also verified the Android exit path: quiz disqualifies at the phone question,
routes to /waitlist, and the email is stored in `waitlist` with
`reason = android`. It never reaches checkout — this is the chargeback guard.

**Fixed while reviewing the email:** the footer said "Manage or cancel your
subscription anytime" but linked to the REFUND POLICY — a customer clicking it
expecting a cancel button would be annoyed, and annoyed customers file
chargebacks. Now it says to reply to the email, which is honest about what
exists today.

~~**Open:** there is still no self-serve cancel link.~~ **Fixed 2026-09-28:**
`kinderwell.app/manage` redirects to Dodo's customer portal (email sign-in);
the offer page, handoff email and every footer now point there.

---

## 4. Runbook — when something breaks

### "Payments succeed but nobody gets access"
The single most likely cause: **webhook not firing or failing signature check.**
1. Dodo dashboard → Webhooks → check delivery log for non-2xx responses.
2. `supabase functions logs dodo-webhook` — a line reading
   `webhook signature verification FAILED` means `DODO_WEBHOOK_SECRET` is wrong.
   Re-copy it from the Dodo dashboard and `supabase secrets set` it again.
3. Check the `unlinked_purchases` table. **Any row here is a paying customer
   without access** — the webhook could not resolve `supabase_user_id` from
   checkout metadata. Resolve manually: find the user by the email on the Dodo
   payment, then insert/update their `entitlements` row by hand.

### "Checkout button does nothing / errors"
1. `supabase functions logs create-checkout`.
2. `checkout_failed` → Dodo API rejected us. Usually a wrong/expired
   `DODO_API_KEY`, or product IDs from the wrong mode (test IDs in live).
3. `already_subscribed` (409) → the dup-guard working as intended.
4. `session_not_found` → the visitor reached /offer without email capture.

### "A refunded customer still has access"
Check `entitlements.status`. Refund/dispute webhooks set `revoked` immediately.
If it still says `active`, the webhook never arrived (see above). Note the app
(v1.3.0+) caches entitlement locally and never interrupts a session: the next
launch re-checks the row in the background and clears the cache, and the
launch AFTER that shows the paywall. Offline launches keep the cache.

### "A web buyer says the app shows them the paywall"
In order of likelihood:
1. **They signed in with a different account** — usually Sign in with Apple
   with Hide My Email, which creates a separate Supabase user with no
   purchase. Tell them to tap **"Use a different account"** on the paywall,
   then **Continue with Email** with the address they paid with. (Google with
   the same Gmail also works.)
2. **The code never arrived** — custom SMTP not configured, or the hourly
   email rate limit hit (Supabase → Authentication → SMTP / Rate Limits).
   Sentry shows `email_address_not_authorized` for the SMTP case.
3. **No entitlement row for their user** — check `unlinked_purchases` (see
   "Payments succeed but nobody gets access").
4. **Their app is older than v1.3.0** — older builds know nothing about web
   purchases. They need to update.

### "A buyer says Paste didn't sign them in" / "the email button opened Safari"
SPEC-21 sign-in links. Every failure falls back to the email code, so the
buyer can always get in with **Sign in → Continue with Email**. To find out why:
1. **No Paste screen at all:** they tapped Get Kinderwell before the link
   was ready and it timed out, copied something else since, or opened the
   app signed in already. PostHog `web_funnel_handoff_link` shows whether
   their page got a link (`result`), `web_funnel_get_app_tapped` whether it
   was copied.
2. **"This link has expired":** used already or older than 7 days. Table
   Editor → `handoff_keys` for their user id: `used_at` set = used.
3. **The email button opened Safari, not the app:** the link page still
   works (Get Kinderwell → install → Paste). If it happens to everyone:
   check https://open.kinderwell.app/.well-known/apple-app-site-association
   loads (JSON, no redirect), that the app build has
   `applinks:open.kinderwell.app` and `applinks:kinderwell.app`, and that
   Resend click tracking is OFF.
4. **No Open Kinderwell button in the email:** the checkout email differed
   from the account (by design), or the mint failed: dodo-webhook logs
   `handoff key insert failed` (is the migration applied?).

### "Checkout says 'Our pricing is being updated'"
`create-checkout` found the page's price ≠ the Dodo product's price and is
refusing checkouts for that plan (you also got a `Checkout blocked` alert).
Fix `NEXT_PUBLIC_PRICE_*` in Vercel and redeploy, or fix the Dodo product.
Workers re-check Dodo's price every 10 minutes.

### "Too many attempts. Please wait a minute"
The in-code rate limit (§2). A real person should never hit it; if many do
(e.g. an office behind one IP), raise the limit in the function source.
`rate_limit_hits` shows the counters; the sweep deletes day-old rows.

### "The win-back email button goes to /start"
The resume token was expired (30 days), tampered with, or signed with a
rotated `UNSUBSCRIBE_SECRET`. Expected behaviour — they restart the quiz.
If EVERY resume link fails, `UNSUBSCRIBE_SECRET` is probably unset (the
`resume` function then answers 503; its logs say so).

### "A web buyer says the app asked all its questions again"
Since 2026-10-05 (once deployed) the webhook creates their `user_profiles`
row at first purchase. Check Table Editor → `user_profiles` for their user id:
- **No row:** their quiz answers had no valid `role` (no profile is made
  without it), or the insert failed — search the dodo-webhook logs for
  `app profile insert failed`.
- **Row exists but `user_type` is empty:** they had started the APP's
  onboarding before buying, so a row already existed and the webhook (insert
  only, by design) left it alone. They answer the app's questions once; they
  still unlock at the gate.

### "Meta shows a Lead / InitiateCheckout / Purchase twice"
Each browser event must carry the same id as its server twin: Lead
`lead-<sha256 of the funnel session id>` (since 2026-10-06, SPEC-21; before
that the plain id, so a site and a `capture-email` from either side of that
change don't dedup), InitiateCheckout `ic-<checkout eventId>`, Purchase the
checkout's `eventId`. Events Manager → Test events shows both sources and
whether they were deduplicated. A Browser-only Purchase with no Server twin
means the webhook's CAPI call failed (dodo-webhook logs: `CAPI Purchase failed`).

### "Webhook logs say an event was ignored as older than the last event applied"
Expected (review P2-17): Dodo retried an old delivery after a newer event for
the same subscription had already been applied. Nothing to do.

### "[csp-report] lines in the Vercel logs"
The Content-Security-Policy is report-only: nothing is blocked. Each line names
the directive and the blocked origin. A legitimate origin (a new Dodo or Meta
domain) → add it to `CSP` in `next.config.mjs` before ever enforcing.

### "A customer got two welcome emails" / "got none"
One is claimed per subscription via `entitlements.activated_subscription_id`.
None: check the row exists and `activated_subscription_id` equals
`dodo_subscription_id`; if it does, the claim ran and the email failed (see
below). Two: they have two subscriptions — look for a "Duplicate purchase"
alert.

### "A refunded customer is still being billed"
`entitlements.cancel_pending = true` means the Dodo cancel hasn't succeeded;
the sweep retries hourly. Cancel it in the Dodo dashboard, then set
`cancel_pending = false`.

### "Emails aren't sending"
Expected until Resend is configured — the code no-ops when `RESEND_API_KEY` is
unset (deliberate: a failed email must never break a purchase). After setup,
check `supabase functions logs dodo-webhook` for `handoff email failed`.

### Useful commands
```bash
supabase secrets list --project-ref <DEV_PROJECT_REF>   # names only (values are hashed)
supabase migration list                                     # local vs remote history
scripts/deploy-functions.sh [names…]                        # the only way to deploy functions (checks CI first)
npm test                                                    # site + Deno unit tests, no Docker needed
```

**When CI is red:** open the PR's Checks tab. `backend` failures name the
scenario (e.g. `W7`, `C2`, `S9`) — each maps to a row in the test spec and to
a test in `supabase/functions/_integration/`. A red test after swapping in
real Dodo fixtures is a real mismatch with Dodo: fix the code, not the
fixture. Never deploy functions from a red commit (the script refuses).

**Function logs:** the installed CLI (v2.106) has NO `functions logs`
subcommand. Read logs in the **Supabase dashboard → Edge Functions → pick the
function → Logs**, or use **Dodo → Developer → Webhooks → your endpoint →
Message attempts**, which shows the HTTP status of every delivery
(200 = handled, 401 = signature mismatch, 500 = handler error).

**Reading tables:** the anon key returns `[]` for `entitlements` /
`unlinked_purchases` even when rows exist — RLS restricts `entitlements` to
its owner and the others have no policies at all. Use the dashboard's **Table
Editor** or **SQL Editor** to inspect them.

---

## 5. Going to prod — the diff from dev

Do NOT copy dev values. Everything below is separately provisioned:

1. ~~**Dodo KYC must be APPROVED**~~ — **DONE (owner-reported 2026-09-28).** Live API keys can now be generated.
2. **Recreate both products in Dodo live mode** → new `pdt_…` IDs.
3. New **live API key** and a **new webhook endpoint + secret** pointing at the
   **prod** Supabase ref (`<PROD_PROJECT_REF>`). Pointing a live webhook at
   dev is the classic silent failure.
4. Migration to prod: **owner-run only**, via `~/mamalearn/scripts/db-push-prod.sh`
   (takes a backup first). Never `supabase link` to the prod ref.
5. Enable **Email OTP** auth on the prod project (dev has it pending too —
   MANUAL_STEPS §2.2).
6. Apply ALL FIVE migrations (`…0918_web2app`, `…0928_email_opt_outs`,
   `…0930_webhook_hardening`, `…1005_event_ordering`, `…1006_handoff_keys`), THEN deploy
   all 7 functions against prod (`scripts/deploy-functions.sh`) + set prod secrets
   (`DODO_ENV=live`, and `FUNNEL_PROXY_SECRET`, `UNSUBSCRIBE_SECRET` and
   `MAILING_ADDRESS` — funnel requests, signed links and marketing email
   are refused without them).
7. Vercel Production env → prod Supabase URL + anon key.
8. **Delete `NEXT_PUBLIC_DEV_SKIP`** and redeploy.
9. Do one real-card purchase, then refund it, verifying the full §7 checklist.
10. Record every new external-state row in `~/mamalearn/docs/OPS_STATE.md`.

> **Gate:** none of this matters until the iOS app's Phase 0 ships
> (`03-app-changes.md`). Until then a web buyer pays and cannot unlock.
> **Do not spend on ads before Phase 0 is live in the App Store.**

---

## 6. Meta account structure — individual now, company later

**Situation (2026-09-19):** the owner is advertising as an individual (personal
PAN) while a company registration is in progress, expected in ~1–2 months.

### What the research actually says (verified 2026-09-19)

An earlier assumption in this project — "just update the business details in
place later, nothing is lost" — is **wrong** and should not be relied on:

- **Tax information generally cannot be changed once submitted.** A change of
  legal entity or tax type typically requires transferring the ad account to a
  different Business Manager, or a new account.
- **Pixel data survives.** A pixel can be shared/reassigned across Business
  Managers, so conversion history and the audiences built on it are
  recoverable. This is the crown jewel and the thing to protect.
- **Campaign history does not fully travel** in a transfer.
- **A transfer moves the asset, not the connections.** Pixels, custom
  audiences, Instagram accounts and catalogs must be manually reassigned.
- **Learning phase restarts per campaign anyway**, so it is not the real loss.

Sources: Meta Business Help Center (Update Company Name and Tax ID; Share
Access to Legal Entity), plus practitioner writeups on pixel/ad-account
transfer. ⚠️ Meta changes these rules — **re-verify before acting**, and ask
Meta support directly once the account has history, which gives them more to
work with.

### Decision: start now as an individual

Waiting 1–2 months to protect optimization history that does not exist yet is
backwards. The test budget (~$1,000–1,500) exists to learn whether the
creative and funnel convert at all; that finding is worth far more than the
thin learning that would be lost in a later transfer.

### Set up to minimise the eventual pain

- [ ] Create a **Business Manager named "Kinderwell"** — not the owner's
      personal name, so it still reads correctly after incorporation.
- [ ] **Create the pixel inside that Business Manager**, never under a
      personal profile — BM-owned pixels are cleaner to reassign later.
- [ ] Use an **email that will be kept permanently** as the admin account.
- [ ] **Add a second admin.** Ad accounts get falsely flagged; a single-admin
      lockout has no recovery path. This is the single cheapest insurance here.
- [ ] Keep a written note of the pixel ID and ad account ID (add them to §2 of
      this runbook) so reassignment later is mechanical.

### When the company registration arrives

1. Do **not** impulsively create a new Business Manager — that is the path that
   loses the most.
2. Ask Meta support what is possible for the existing account, given its
   history.
3. If a transfer is required: move the **pixel** first and verify its event
   history is intact before touching anything else.
4. Expect to re-create campaigns; budget for a fresh learning phase.
5. Update this section with what actually happened.

### Separate question — which entity should bear the ad spend

Dodo is Merchant of Record, so **Dodo is the seller of record for tax
purposes**; that is independent of which entity pays Meta. Whether the ad spend
should sit with the individual or the company (deductibility, GST treatment on
ad spend billed from India) is a **question for whoever is handling the
incorporation** — it likely matters more in rupees than the Meta mechanics do.
