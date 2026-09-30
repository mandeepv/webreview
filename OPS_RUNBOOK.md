# Web2App — Ops Runbook

**What this is:** the living record of what is ACTUALLY deployed, where every
value lives, and how to operate/repair it. `MANUAL_STEPS.md` (same folder) is
the *plan* (what to do); this file is the *state* (what was done).

**Update this file whenever you change external state.** If it's stale, it's
worse than nothing.

Companion: `~/mamalearn/docs/OPS_STATE.md` (the app's own register — add rows
there too when prod goes live).

---

## 1. Current state (as of 2026-09-19)

| Layer | Status | Detail |
|---|---|---|
| Domain | ✅ live | `kinderwell.app`, Namecheap, auto-renew ON, WhoisGuard ON |
| DNS | ✅ live | Single A record `@` → `216.198.79.1` (Vercel). Namecheap BasicDNS. Parking page OFF, domain redirect REMOVED. |
| Hosting | ✅ live | Vercel project `kinderwell-web`, GitHub `mandeepv/kinderwell-web` (private), auto-deploys from `main` |
| Supabase (dev) | ⚠️ behind code | `<DEV_PROJECT_REF>` (kinderwell-dev) — migration `…0918_web2app` applied, 4 functions deployed (Sep 19 versions). **As of 2026-09-28 the code is ahead:** all 4 functions changed, a 5th (`unsubscribe`) and migration `…0928_email_opt_outs` are new — NOT deployed/applied (website code IS pushed as of 2026-09-30). See §3 2026-09-28. |
| Supabase (prod) | ⬜ untouched | `<PROD_PROJECT_REF>` (kinderwell) — NOTHING done yet, by design |
| Dodo | ✅ test mode working | 2 products, test API key, webhook `<WEBHOOK_ENDPOINT_ID>` (all event types). **Full purchase→entitlement loop verified.** **KYC APPROVED (owner-reported 2026-09-28)** → live mode is now *available*, but nothing is provisioned in it yet (see §5 steps 2–3). |
| Site routes | ✅ in code | `/` = brand homepage (App Store badge + quiz CTA). `/start` = the paid-ad landing (`?a=` variants). Ad params (`a`, `fbclid`, `utm_*`) hitting `/` are server-redirected to `/start` with the query intact. **Ad URLs should point at `/start`.** |
| Resend (email) | ✅ verified + sending | `kinderwell.app` (root, branded sender) + `mail.kinderwell.app` (fallback), region **us-east-1**, click/open tracking OFF (hurts transactional deliverability). DKIM+2 CNAMEs+DMARC live in Namecheap and verified by `dig`. `RESEND_API_KEY` + `EMAIL_FROM` set in Supabase. **Verified 2026-09-19** — a live API send returned a message id. NOTE: the API key is scoped to sending only, so it cannot read domain status; test by sending, not by querying. |
| Meta pixel/CAPI | ⬜ not started | Funnel runs; no ad attribution until configured |
| iOS app (Phase 0) | ⬜ not started | **Web buyers cannot unlock the app until this ships** |

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
   `03-app-changes.md`. **Decision (2026-09-19): Phase 0 is NOT started yet —
   it waits until `design/onboarding-lesson-revamp` is tested and merged to
   main, then gets built on main.** Sequencing chosen deliberately to avoid
   two large concurrent changes in the onboarding/paywall path.
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
7b. **`NEXT_PUBLIC_DODO_ENV` must match `DODO_ENV`** in the Supabase secrets
   (`test` now, `live` at launch). The checkout overlay resolves the session
   against this environment — a mismatch means the modal cannot find a session
   that genuinely exists, and checkout fails with no obvious cause. **This is
   a two-place change at go-live: Supabase secret AND Vercel env var.**
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
| Dodo API key, product IDs, webhook secret | Supabase → Edge Functions → Secrets (`supabase secrets list`) | Test mode today |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected into edge functions | NEVER in the Next.js runtime |
| `SWEEP_SECRET` | Supabase secrets | Guards `winback-sweep`; needed in the pg_cron URL |
| `RESEND_API_KEY`, `EMAIL_FROM`, `SUPPORT_EMAIL` | Supabase secrets | ✅ set 2026-09-19. `SUPPORT_EMAIL` feeds the `reply_to` header on every email. |
| `POSTHOG_KEY`, `POSTHOG_HOST` | Supabase secrets | ✅ set 2026-09-19 — same project as the iOS app (`phc_…`), so web + app events share one user journey |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | Vercel env | ✅ set + verified live in the layout chunk |
| Meta CAPI token / pixel id | Supabase secrets + Vercel | ⬜ not yet |
| `FUNNEL_PROXY_SECRET` | Supabase secrets **AND** Vercel (server env, NOT `NEXT_PUBLIC_`) — same value in both | ⬜ not set. Edge functions reject funnel calls without it **in live mode** (test mode tolerates it missing). |
| `MAILING_ADDRESS` | Supabase secrets | ⬜ not set. Postal address for CAN-SPAM; win-back emails refuse to send without it **in live mode**. |
| `UNSUBSCRIBE_SECRET` | Supabase secrets | Optional — unsubscribe links are signed with `SWEEP_SECRET` if unset. Set it before launch if SWEEP_SECRET might ever rotate (rotation breaks every old unsubscribe link). |
| `ALERT_EMAIL` | Supabase secrets | Optional — owner alerts (unlinked purchase, dispute won, partial refund, cancel failure) go to `SUPPORT_EMAIL` if unset. |
| `META_TEST_EVENT_CODE` | Supabase secrets | **Temporary** — set only while verifying in Events Manager → Test events, then DELETE (while set, real purchases are sent as test events). |
| `NEXT_PUBLIC_DODO_PORTAL_URL` | Vercel env | Optional — `/manage` redirects to `https://customer.dodopayments.com` if unset. |
| Dodo dashboard login | Owner (Mandeep) | |

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
**Still NOT done:** migration `…0928_email_opt_outs` not applied (and not yet
copied into `~/mamalearn/supabase/migrations/`); the 5 edge functions not
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
caches entitlement locally, so access ends at the NEXT launch, not instantly.

### "Emails aren't sending"
Expected until Resend is configured — the code no-ops when `RESEND_API_KEY` is
unset (deliberate: a failed email must never break a purchase). After setup,
check `supabase functions logs dodo-webhook` for `handoff email failed`.

### Useful commands
```bash
supabase secrets list --project-ref <DEV_PROJECT_REF>   # names only (values are hashed)
supabase migration list                                     # local vs remote history
```

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
6. Apply BOTH migrations (`…0918_web2app`, `…0928_email_opt_outs`). Deploy
   all 5 functions against prod (`--no-verify-jwt`) + set prod secrets
   (`DODO_ENV=live`, and `FUNNEL_PROXY_SECRET` + `MAILING_ADDRESS` — live
   mode refuses funnel requests / marketing email without them).
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
