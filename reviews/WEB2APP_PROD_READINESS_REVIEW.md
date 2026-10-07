# Kinderwell web2app — production-readiness review (2026-10-07)

**Scope.** The full web2app funnel before Meta ads run: `mandeepv/webreview` (Next.js site + 7 Supabase edge functions + 5 migrations, branch `main`, snapshot of the real repo's `a2be939`) and the app half in `mandeepv/appreview` on `origin/release/1.3.0` (the v1.3.0 train that carries the web-purchase unlock and the SPEC-21 handoff; `main` = live v1.2.0). Both clones live in `~/Desktop/KIN/`.

**Method.** Every file relevant to the flow was read in both repos. Five parallel deep reviews (money path, ingress functions, browser side, iOS app side, cross-repo parity + ops) plus my own pass on the webhook, checkout, handoff mint/redeem and the launch gate. Every finding below was checked against the code before it was kept; the full per-area reports with line references are in `review-appendix/`. The prior external review (`reviews/PROD_REVIEW.md`, 2026-09-30) was used as a baseline: its fixes were re-verified, not repeated. All local test suites were run (§2).

**What I could not verify.** Anything that lives in a dashboard (Supabase Auth settings, Dodo products/webhook, Meta, Vercel env, Resend, Superwall); the real repos' CI history and branch protection (the mirrors are public redacted snapshots and the GitHub account on this machine cannot see the private originals); real Dodo payloads (the fixtures are schema-built, as the repo says); anything that needs a device (Apple Pay, Instagram in-app browser, universal links, clipboard paste).

Severity: **P0** = do not spend on ads / do not deploy until fixed · **P1** = fix before the first ad dollar · **P2** = fix in the first weeks · **P3** = hygiene.

---

> ## Fix status — as of 2026-10-07 (evening)
>
> **Code:** every P0/P1 code finding and every P2/P3 code finding is fixed,
> except the items marked open below. Website: branch
> `fix/prod-readiness-review` (`git log main..fix/prod-readiness-review`;
> not merged, not pushed). App: `release/1.3.0` in `~/mamalearn`
> (`git log 2ab91ee..release/1.3.0`; not pushed). **Nothing is deployed.** Checked locally on the website: `tsc`, ESLint (3 warnings,
> unchanged), Vitest 154 passed (+1 todo), Deno unit 87, Deno check on
> functions and integration tests, a `next build`, Playwright 24 passed
> (iPhone WebKit). On the app: `tsc`, Jest 924 passed, Deno 83, no new ESLint
> warnings. The 110 integration tests (89 before) and pgTAP need Docker and
> run in CI only. They were type-checked but not run here.
>
> **Owner decisions taken 2026-10-07**
> - B-1: existing app users may buy on the web. A purchase that lands on an
>   account older than its funnel session gets no one-tap sign-in link (the
>   inbox is the proof), and the owner gets an alert. No OTP-on-/email step.
> - B-12: the owner confirms the testimonials and the stats ("83%", "two
>   weeks") are real. Keep the evidence (consent, original messages, the
>   survey behind 83%). The lesson-count/week claims were product
>   descriptions that didn't match the app, and are fixed (below).
> - B-13: price left as it is for now; the owner will settle pricing later.
>
> **What's left for the owner** is the consolidated checklist, kept current in
> `MANUAL_STEPS.md` §8.10 (the review's §7, adjusted to the fixes).
>
> | Finding | Status |
> |---|---|
> | **B-1** existing-account key | ✅ `44f5c1d`: `accountPredatesSession` (`_shared/accounts.ts`, the sweep's rule) → `decideMint` not_found, no email link, owner alert. Tests M10, W25c. |
> | **B-2** nothing deployed | 🟡 owner. Correction: dev **does** have all five web migrations (`supabase migration list`, 2026-10-07); its web functions are the 2026-09-19 versions; `unsubscribe`, `resume`, `mint-handoff` aren't deployed. Prod untouched. |
> | **B-3** nonce last-writer-wins, session re-point, cleartext session id | ✅ `8cb955c`: nonce hash in the checkout's Dodo metadata, copied by the webhook from the PAID checkout; reuse only for the same browser; capture-email 409 `session_taken`; opaque AES-GCM resume tokens; resume mint needs the email. C10 rewritten; E9, W26, R2b. |
> | **B-4** duplicate subscriptions | ✅ `542b96d`: any activating event; conditional (optimistic) entitlement write; 0-row claim re-read. W14b, W14c. |
> | **B-5** email to Sentry | ✅ app `55b504c`: report code/status only; Sentry `beforeSend` email scrubber; test with GoTrue's real message. |
> | **B-6** Safari link copy | ✅ `ce9ffd7`: minted up front, copied inside the tap; press-and-hold + Share fallback. Device test still owed (FE-10 pass). |
> | **B-7** `?a=__proto__` | ✅ `f0b7919`: own-key lookup; unit + http e2e. |
> | **B-8** deploy script | ✅ `d7020e7`: names required, mint-handoff confirmation, reads `linked-project.json`, refuses unknown refs. App docs citing `project-ref` fixed. |
> | **B-9** AASA before first install | 🟡 owner: now a hard prerequisite (MANUAL_STEPS §8.9 step 1, ≥ 24 h before any v1.3.0 install). |
> | **B-10** test portal | ✅ `1078d57`: live portal unless `NEXT_PUBLIC_DODO_ENV=test`; curl check in the go-live list. |
> | **B-11** Confirm signup template | 🟡 owner dashboard (both projects); added to MANUAL_STEPS §2.2, OPS_RUNBOOK §1b.1, the app's OPS_STATE and release runbook. |
> | **B-12** claims | ✅ owner: testimonials/stats real. `2f14689`: "12 lessons, starting with 'Calm in the Meltdown'" → "13 lessons, starting with the foundations" (the app's LESSON_ORDER; none of the eight named lessons exists in 1.3.0); "10-week path"/"Week 10" removed; "stays on your side" → "stays private". |
> | **B-13** $69.99 vs $59.99 | ⬜ owner, deferred: verify in App Store Connect. |
> | MP-3 | ✅ `1c352cc` · MP-4, MP-5 ✅ `2a8be52` · MP-6 ✅ `6ec1b51` · MP-13 🟡 owner: capture the five payloads during the test purchase. |
> | IN-2/IN-3 | ✅ `8cb955c` · IN-5, IN-7, IN-9 ✅ `e1b99dd` · IN-6 ✅ `e684f77` (email + "Not you?" on /offer; no separate interstitial). |
> | FE-3, FE-6, FE-11 | ✅ `3b3545e` · FE-5, FE-8, FE-9 ✅ `6c510e0` (/start first load 207 → 111 kB) · FE-7 ✅ `e684f77` (a recovery card; no "email me my link") · FE-10 🟡 device check. |
> | AP-3/XR-3 | ✅ web `d86f2ce` + app `8c82d65`: `hasAccess` = the app's rule (6-day active grace); the webhook's duplicate rule stays strict on purpose; one case table in both repos, compared by the app's parity script. |
> | AP-4 | ✅ app `0549267` · AP-5 ✅ app `466673c` (20 s background timeout, hourly foreground re-check; still clear-only). |
> | XR-7 | ✅ `6c510e0`: `environment`/`app_env`/`surface` on web and server events. |
> | XR-13/14/16 | ✅ docs (dev migration state corrected; "five" migrations everywhere; MANUAL_STEPS §2.4 lists every secret the code reads). |
> | XR-18 | 🟡 owner: deploy the new `delete-account` (dev has the 2026-07-11 version). |
> | XR-25/28 | 🟡 owner: branch protection. Drift: by owner decision no automated detector; instead `63cfabb` makes the deploy script record every deploy in `DEPLOY_LOG.md`, checked by hand against `supabase functions list` before the prod flip and ads. |
> | P3 | ✅ `874c99a` (unlinked payload, 7-min reclaim, pruning, cancel alert, failed-payment leads), `9390151`+`62b1314` (/u unsubscribe, cookie size, UUID fallback, versioned session, `?a=` attribution, quiz 404, Threads, labels, AASA `.dev`, lucide-react), app `fb76e00` (redeem-handoff IP), app `03b67e2` (coverage/). ⬜ open: build's Google Fonts dependency (accepted), the gate's device clock, the mirrors' redaction policy (owner), `npm audit fix`. |
>
> **Later 2026-10-07:** §8 legal ✅ `2820b9f` (privacy policy and terms; one
> support address). Owner decided to skip: the gate's device clock, a separate
> "Continue as…?" screen, "email me my plan link", the Google Fonts build
> dependency. W3 (an email code before checkout for existing accounts) is
> parked for later. Test gap #5 ✅ `719ebf0`.
>
> **§6 test gaps:** 1–12 are covered by the tests named above. #5: e2e B1
> now runs the funnel with PostHog really capturing (Playwright's
> `navigator.webdriver` made posthog-js drop every event, so no CI run had
> ever sent one) and fails if any quiz answer label, the name or the email
> is in what PostHog or the Meta pixel receives; checked by turning
> autocapture on, which it caught. Still open: `winback-sweep` is not in the
> enforced 80% coverage gate. The app's `ci-deno.yml` is now in the v1.3.0
> release-gate list.
>
> The per-area appendix (`~/Desktop/KIN/review-appendix/`) was not on this
> machine. The fixes follow this summary and the code.

---

## 0. Verdict

**Not production-ready today, but close.** The code is unusually well-reasoned for a v1 funnel and every P0/P1 from the September review genuinely holds in the current code. What stands between you and the first ad dollar is:

1. **One new P0 code hole in the SPEC-21 handoff** (anyone can pay with a victim's email and receive a sign-in key for the victim's existing account). It is small to fix, but `mint-handoff` must not be deployed until it is.
2. **Nothing new is deployed.** Prod Supabase is untouched, the live site still runs the 2026-09-19 functions against the dev project, and app v1.3.0 is not in the App Store. The repo already knows this; it is still the gate.
3. **About two days of P1 code fixes** (§1) and the owner/dashboard checklist (§7), several items of which your own docs mark as required before ad spend.
4. **Two owner decisions** that affect the verdict regardless of code: are the testimonials and proof stats real, and may existing app users buy on the web (§8, §10).

Realistic path: fix §1 → deploy everything to dev and run the §7 checklist end to end (one real purchase, refund, re-buy, Paste handoff on a device, Instagram in-app run) → ship 1.3.0 → prod flip in one sitting → one live-card purchase + refund → ads.

---

## 1. Blockers and fix-before-first-ad-dollar

### P0

**B-1 · Paying with someone else's email mints a sign-in key for their account** (ingress IN-1)

`capture-email/handler.ts:125-146` attaches a funnel session to whatever `auth.users` row has that email, with no ownership proof. `create-checkout` stores the caller's nonce on that session (`:114-116`) and puts the existing user's id in Dodo metadata. The webhook writes the entitlement and `purchased_at` for that user. `mint-handoff` (`_shared/handoff.ts:83-98`) then checks only: session has a user, nonce matches, paid < 24 h, entitlement active. All true for the attacker's browser → `https://open.kinderwell.app/k/<key>`, a login credential for the victim's account (child's name and age, the parent's quiz answers, lesson history).

Cost to the attacker: one month, refundable within 14 days. Until `mint-handoff` is deployed the same flow "only" lands a paid entitlement and a welcome email in the victim's inbox. The win-back sweep already has the right heuristic (`winback-sweep/handler.ts:104-109`: account created > 10 min before the session → not ours) but the money/credential path ignores it; integration test E2 asserts the attach as desired.

**Fix (cheapest first):** record `account_preexisting` on the session at capture (same rule as the sweep); `decideMint` → `not_found` when true, and the webhook skips the email's "Open Kinderwell" link for those (the inbox is then the only proof). Alert the owner on any purchase landing on a pre-existing account. **Proper fix:** require an OTP on `/email` when the address already has an account, or refuse checkout with "you already have an account — sign in in the app to subscribe". This is the same product decision as the September review's P3-7.

**B-2 · Nothing is deployed; prod is untouched; app 1.3.0 is not shipped** (money path MP-1, prior P0-4)

Live kinderwell.app runs the Sep-19 functions against the **dev** project in Dodo test mode: refunds do not revoke, the proxy secret is not enforced, win-back mail has no unsubscribe/postal address, and the current webhook selects columns that do not exist until migrations `…0930`, `…1005`, `…1006` are applied. Deploying functions before migrations makes every `subscription.*` delivery a 500. Your docs already say all of this; §7 consolidates the order.

### P1

**B-3 · The handoff nonce is last-writer-wins, and the session id it protects is not secret** (ingress IN-4, my own finding)

`create-checkout/handler.ts:110-116` overwrites `handoff_nonce_hash` on every call before purchase, including calls that only get the reused checkout back (`:122-130`); test C10 pins this as intended. The funnel `sessionId` sits in cleartext in every resume token (`_shared/email.ts:91-94`: `<sessionId>.<exp>.<sig>`), so in every win-back email link, in the "copy a link for Safari" link, in Vercel's request log for `/r/<token>`, and in Dodo's metadata. Anyone who sees one before the buyer pays can post their own nonce, wait, and mint a sign-in link for the buyer's account.

Also `capture-email`'s upsert (`:148-161`) re-points `user_id` of an existing session to whoever posts that id with a different email, so the victim's purchase can land on the attacker's account. The nonce exists precisely because SPEC-21 said the session id is not secret enough; the overwrite rule undoes that.

**Fix:** bind the nonce to the checkout, not the session (put the hash in Dodo `metadata` at creation; `fireFirstActivation` copies the paid checkout's hash onto the session); only write a nonce when a new checkout is created; refuse `capture-email` on a session whose `user_id` is set to someone else (409). Make the resume token opaque (random id looked up server-side, or encrypted) so the session id stops travelling in links. Rewrite C10 around "the nonce that mints is the one from the checkout that was paid".

**B-4 · A second live subscription can go silently un-cancelled and un-alerted** (money path MP-2)

`dodo-webhook/handler.ts:193-207`: the duplicate branch acts only on `subscription.active`; any other event (`renewed`, `plan_changed`) for a different subscription while the row is entitled returns silently. Realistic path: renewal on A fails → `past_due` → sweep expires at ~day 4 → customer re-buys B → Dodo's retry on A succeeds → `renewed` A is dropped. Customer billed twice, no alert.

Also two concurrent first purchases with different ids: A inserts, B upserts over it, A's activation claim returns 0 rows and is treated as "a sibling delivery won". W2b only tests one subscription id.

**Fix:** in the duplicate branch, for any event about a different subscription while the row is entitled, alert once and attempt the cancel; after a 0-row activation claim re-read the row and treat a different `dodo_subscription_id` as the duplicate case.

**B-5 · The customer's email reaches Sentry on the exact failure the runbook tells you to watch for** (app AP-1)

`src/services/authService.ts:240-243, 263-265` forward the raw GoTrue `AuthError` to `reportError` → `Sentry.captureException`. GoTrue's `email_address_not_authorized` message embeds the address (`Email address "buyer@gmail.com" cannot be used…`). That is the prod-SMTP-not-configured case `OPS_STATE` describes. INVARIANTS #8 breach; the Jest fixture uses a message without an address, so the PII guard never fires.

**Fix:** report a synthetic error carrying only `code` / `status`; add a test with GoTrue's real message and `FIXTURE_EMAIL`; consider a Sentry `beforeSend` email redactor.

**B-6 · "Copy a link for Safari" cannot copy on the platform it exists for, then shows a contradictory message** (browser FE-2)

`app/offer/in-app-note.tsx:31-52`: `clipboard.writeText` runs after an `await fetch`, so WebKit (every iOS in-app browser) rejects it; the catch reads a stale `link` closure and shows "Couldn't make the link" above the freshly minted link. This is the Apple Pay escape hatch for the majority of ad traffic (Instagram/Facebook in-app browser).

**Fix:** mint first, then copy inside the tap with the promise-`ClipboardItem` pattern already in `lib/handoff.ts:126-142`; fall back to "long-press to copy" with the correct message; consider `navigator.share`. Add a unit test that rejects `writeText`.

**B-7 · `/start?a=__proto__` crashes the ad landing page** (browser FE-4)

`app/start/page.tsx:12` uses `VARIANTS[a]` truthiness; `Object.prototype` is truthy, `v.headline` is undefined, `RichHeadline` throws during server render → 500 on the one page every ad lands on. Same for `constructor`, `toString`, `valueOf`.

**Fix:** `Object.hasOwn(VARIANTS, a)` (also in `landing-client.tsx:15`); add an http e2e case.

**B-8 · The deploy script defaults to all seven functions, including `mint-handoff`, and its dev/prod check is dead** (cross-repo XR-11, XR-12)

`scripts/deploy-functions.sh:14` lists `mint-handoff` in `ALL`; OPS_RUNBOOK §1 says "deploy from main with `scripts/deploy-functions.sh`" with no names, while §8.9 says `mint-handoff`'s deploy *is* the go-live and must wait for app 1.3.0. The target label reads `supabase/.temp/project-ref` (`:48`), a file the app's own scripts (`backup-prod.sh:60-63`) document as no longer written by this CLI, so the prompt always says "unknown" and still accepts `deploy`.

**Fix:** require explicit names (or exclude `mint-handoff` without a flag); read `linked-project.json`; refuse an unknown ref. Fix the four docs that cite `project-ref`.

**B-9 · `open.kinderwell.app` must be live and serving the AASA ≥ 24 h before the first v1.3.0 install** (cross-repo XR-6)

MANUAL_STEPS §8.9 calls adding the domain "safe any time". iOS fetches the association file (via Apple's CDN) when the app is installed; a missing/erroring file is cached as "no association" until iOS's periodic refresh, so the email button and the welcome link open Safari for every early installer and for App Review. Make "`curl https://open.kinderwell.app/.well-known/apple-app-site-association` returns JSON on both hosts" a hard prerequisite before any TestFlight/ad-hoc install.

**B-10 · `/manage` can send live customers to Dodo's *test* portal** (browser FE-1)

`lib/config.ts:19-25`: once `NEXT_PUBLIC_DODO_BUSINESS_ID` is set (MANUAL_STEPS §8.7 tells you to), the host is `test.customer…` unless `NEXT_PUBLIC_DODO_ENV === 'live'`; `.env.example` now describes that variable as a dev-skip guard only. "Cancel anytime at kinderwell.app/manage" is printed on the offer page, in the Terms (California cancellation), both footers and the welcome email. CI builds with `test`, so nothing catches it.

**Fix:** make the portal URL an explicit required production variable, or at least add "`curl -I kinderwell.app/manage` → Location is customer.dodopayments.com" to the go-live checklist.

**B-11 · First-time organic email sign-up may receive a link instead of a code** (app AP-2, cross-repo XR-10 — verify on dev)

`authService.ts:234-236` calls `signInWithOtp` with `shouldCreateUser` defaulting to true. GoTrue sends the **Confirm signup** template to a user it just created; only the Magic Link template is on your checklists. Web buyers are pre-created and confirmed so they are fine; a brand-new organic parent on "Continue with Email" may get a Safari link and never get in. E2E cannot see it (codes are read via `generateLink`).

**Fix:** add "Confirm signup template shows `{{ .Token }}`" to runbook §C/§F and OPS_STATE for dev and prod; test once on dev with a never-seen address.

**B-12 · Claims and testimonials** (prior §1b.5/§1b.10, still open in code)

Four named testimonials with star glyphs (`landing-client.tsx:49-53`, `email/page.tsx:159-163`, `offer/page.tsx:341-347`; "Megan, mom of a 3-year-old" is quoted twice with different words), "83% of parents", "two weeks", "12 lessons" vs "10-week path", "Week 10". FTC's 2024 fake-review rule and Meta ad policy both bite here. Full inventory in §8.

**B-13 · App Store annual price is documented as $69.99 while the web charges $59.99** (cross-repo XR-17)

`appreview/docs/RELEASE_CHECKLIST.md:427`, `STOREKIT_SETUP_GUIDE.md:97` vs `webreview/lib/config.ts:38`. Your own rule is "three prices must always agree". Verify in App Store Connect; one of the two is wrong.

---

## 2. Local verification run (this machine, 2026-10-07)

| Repo | Check | Result |
|---|---|---|
| web | `tsc --noEmit` | clean |
| web | `eslint .` | 0 errors, 3 warnings (`<img>` on home, two anonymous default exports) |
| web | Vitest | 120 passed, 1 todo (age gating, P3-23); line coverage 43% (reported, not enforced) |
| web | Deno `check` on all functions + harness | clean |
| web | Deno unit tests | 55 passed |
| web | `next build` with CI placeholder env | OK; `/start` server-rendered, `/` static |
| web | Playwright (iPhone WebKit, prod build, stubbed backend) | 19 passed |
| web | pgTAP + 89 integration tests | **not run here** (no Docker); CI-only. Could not confirm the private repo's CI state. |
| web | `npm audit` | 5 advisories: `next` 15.5.25 bundles a vulnerable `postcss` (build-time); `sharp` <0.35.5 high (librsvg CVE); `source-map-js` high (DoS, build-time). None reachable from user input at runtime on Vercel; `npm audit fix` when convenient. No `middleware.ts`, so the Next middleware-bypass class does not apply. |
| app | `tsc --noEmit` | clean |
| app | Jest | 884 passed, 4 skipped, 50 suites |
| app | Deno tests (`redeem-handoff`, `delete-account`) | 66 passed |
| app | pgTAP (65), Maestro E2E flows | **not run here** (need Docker / a simulator build); CI-only |

Deno was installed into the session scratchpad only; nothing was installed system-wide. Playwright's WebKit went to its normal cache directory.

---

## 3. P2 — fix in the first weeks (deduplicated; details and line refs in the appendix)

### Money path

- **MP-3** · The sweep expires overdue `active` rows when Dodo *cannot be reached* (null = "not active"), reconciles only 50 rows, never reconciles `past_due`. A Dodo outage during a webhook outage locks paying customers out.
- **MP-4** · Two partial refunds that add up to the full amount never revoke (`is_partial` is the only signal); a missing `is_partial` revokes a goodwill refund.
- **MP-5** · Welcome email + CAPI Purchase are at-most-once: a Resend 5xx after the activation claim means no email, no link, no alert, no retry.
- **MP-6** · An activating event overwrites `current_period_end` even backwards (`entitlement.ts:124-127`); no real renewal payload has ever been observed. Capture one in test mode before launch.
- **MP-13** · Field assumptions that fail *soft* against real Dodo payloads: `is_partial`, top-level `subscription_id` on `GET /payments`, envelope `timestamp`, `metadata` still present on `renewed` a year later, cents amounts. Capture the five payloads the fixtures README lists.

### Ingress / security

- **IN-2/IN-3** · `resume mint` turns a bare session id into the lead's email + quiz answers (30-day reusable token, in Vercel logs and mail-scanner logs). Folds into B-3's fix.
- **IN-5** · Honeypot runs *after* the per-email rate limit: five bot posts lock any address out of the funnel for an hour, repeatable, silently. The 429 copy says "a minute".
- **IN-6** · `/r/<token>` is a session-fixation link: a shared "discount link" makes the victim pay into the attacker's account (`/offer` never shows whose plan it is). Add a "Continue as s***@gmail.com?" interstitial and print the account email on `/offer`.
- **IN-7** · IPv6 is keyed per address (every mobile carrier hands out a /64), plan alternation bypasses checkout reuse, CAPI `value` comes from the client body, `displayedPrice` omitted skips the price guard.
- **IN-9** · `ALLOW_UNAUTHENTICATED_FUNNEL=1` has no prod guard.

### Browser

- **FE-3** · No watchdog on the Dodo overlay: a blocked/unloaded iframe leaves a transparent full-screen frame over the page with no way out but reload.
- **FE-5** · PostHog is never `reset()` after purchase; the next funnel run on the same phone is attributed to the buyer until `/email`.
- **FE-6** · The report-only CSP lacks `*.dodopayments.com` in `script-src`; the wallet SDK (Apple Pay) is injected into the parent page, so every checkout logs a violation and enforcing as planned would break Apple Pay.
- **FE-7** · Instagram's own "Open in Safari" opens `/offer` with empty storage → bounce to `/start` → restart the quiz. Needs a no-session recovery card.
- **FE-8** · Any unrecognised Dodo `status` on `/welcome` is announced as "You haven't been charged".
- **FE-9** · posthog-js (~100 KB gz) is statically imported into the layout chunk that ships to `/start`.
- **FE-10** · "Tapped before the link arrived" opens the App Store by `location.assign` seconds after the tap; inside Instagram's WKWebView this may render apps.apple.com in-app. Device-check it.
- **FE-11** · `lib/checkout.ts` (the browser half of the money path, incl. the P0-3 fix) has zero unit tests; e2e accepts "an iframe or a redirect".

### App / cross-repo

- **AP-3 / XR-3** · Three access-rule copies disagree on grace: web `hasAccess` 0 days, sweep 5, app + redeem 6. During a late renewal the web dup guard opens and the webhook treats a second purchase as a replacement, not a duplicate.
- **AP-4** · `switch_account` can land on Welcome instead of Auth (two navigators race on sign-out).
- **AP-5** · Refund enforcement for cached web subscribers lags two cold launches and never clears on a slow network; no foreground re-check.
- **XR-7** · Web PostHog registers no `environment` super-property; any dashboard filtered on `environment = prod` excludes all web events, and events from the live site (which writes to the dev project today) are indistinguishable from real ones.
- **XR-13/14/16** · Doc drift: dev migration state (web says 1 applied, app says all 5); "three" vs "five" migrations for prod; MANUAL_STEPS §2.4 omits six secrets the code reads, including `FUNNEL_PROXY_SECRET`.
- **XR-18** · The new `delete-account` is deployed nowhere; E2E flow 6 passed against the old function.
- **XR-25/28** · Vercel deploys every `main` commit with no gate (branch protection off); nothing detects deployment drift between the repo and Supabase.

---

## 4. P3 — hygiene (headlines only; full list in the appendix)

Resume cookie carries full answers (can exceed 4 KB → Safari drops it); `/unsubscribe?u=&t=` runs the pixel layout so the opt-out token reaches Meta; `crypto.randomUUID` has no fallback for old WebKit; stored session is unversioned; `captureAttribution` wipes `utm_*` on an `?a=`-only visit and the README still says "first-touch"; `/quiz/0|99|abc` return 200 empty; Threads UA not detected; `lucide-react` unused; build depends on Google Fonts; no labels on inputs; `rate_limit_hits` / `handoff_keys` / `webhook_events` never pruned until the sweep runs; `unlinked_purchases.payload` keeps full customer PII; idempotency reclaim (2 min) is shorter than the edge wall-clock; cancel failures retry hourly forever without an alert; `subscription.failed` leads are excluded from win-back; redeem-handoff rate limit keys on the client-controlled first XFF hop; gate uses the device clock; the AASA lists a dead `.dev` bundle; the public app mirror leaks the Google OAuth client id and three Apple key ids while redacting the team id (and the web mirror publishes the team id) — pick one redaction policy; `coverage/` is not in the app's `.gitignore`.

---

## 5. Prior review (2026-09-30) — re-verification

All 4 Critical and 17 High findings hold in the current code, with these caveats:

| Finding | Status |
|---|---|
| P0-2 exactly-once side effects | Exactly-once for *claiming*, at-most-once for *sending* (MP-5); 0-row claim conflates "sibling won" with "another subscription took the row" (B-4) |
| P0-4 deploy drift | **Does not hold** — still the live state (B-2) |
| P1-3b double purchase | Reuse + duplicate branch exist; holes in B-4 |
| P1-5 in-app Apple Pay note | Copy correct; the copy-link affordance is broken on WKWebView (B-6); device test still pending |
| P1-7 rate limits | In place; honeypot ordering (IN-5), IPv6 keying (IN-7), Vercel WAF rule unchecked |
| P1-8 sweep grace + reconcile | Holds; unknown≠not-active, 50-row cap, `past_due` not reconciled (MP-3) |
| P2-13 / P2-16 accepted risks | Still acceptable on their own; the real exposure behind P2-16 is B-1, not the id itself |
| P3-1 `UNSUBSCRIBE_SECRET` required | Holds; sweep still accepts `?key=` |
| P3-18 retention | Holds for `capi` /sessions; `handoff_keys`, `webhook_events`, `unlinked_purchases` not covered |
| Everything else marked ✅ | Holds, with line refs in the appendix |

---

## 6. Test sufficiency

**Verdict:** good for a solo project, and genuinely better than most funded teams, but the coverage is strongest where the September review pointed and thinnest in the three places the new findings live.

**Strong:** the webhook state machine (24 delivery orders + a concurrent burst against a real Postgres), RLS and SQL functions in pgTAP, the app's gate (44 cases), handoff key format pinned on both sides, PII guard in the app's Jest setup, deliberate-breakage runs recorded.

**Thin or missing (the top 12; the appendix has ~60):**

1. Existing-account purchase → mint must fail, email link omitted (B-1). Today E2 asserts the attach and nothing asserts the consequence.
2. Nonce race and session re-point (B-3). C10 asserts the *opposite* of the safe behaviour.
3. Two different subscriptions concurrently; `renewed` for a different subscription while entitled (B-4).
4. `lib/checkout.ts` has no unit tests at all; e2e cannot tell overlay from fallback (FE-11).
5. PostHog is never initialised in CI; "answers never reach PostHog" has no automated check beyond a pure URL-scrub test.
6. GoTrue's real `email_address_not_authorized` message with an address in it (B-5).
7. Sweep: Dodo 5xx/timeout on an overdue row must *not* expire it; 51+ rows; `past_due` healing (MP-3).
8. Two partial refunds summing to full; `is_partial` absent (MP-4).
9. `renewed` with an earlier `next_billing_date` (MP-6).
10. `?a=__proto__` → 200 default copy (B-7); `/quiz/0|99|abc` → 404.
11. Clipboard rejection path in the in-app note (B-6) and the unknown-status path on `/welcome` (FE-8).
12. The three access-rule copies pinned together (the contract test's web cross-check is `describe.skip` in CI).

Also: web Vitest coverage is "reported, not enforced"; the enforced 80% gate covers three handlers, not `winback-sweep` (which can revoke access via expiry); the app's `ci-deno.yml` (the only workflow that tests `redeem-handoff` and `delete-account`) is not in the v1.3.0 runbook's release-gate list.

---

## 7. Consolidated go-live checklist (everything your docs record as NOT done)

Order matters. (A) before any ad spend · (B) dev prerequisites for the device pass · (C) the prod flip, one sitting.

### (A) Before any ad spend

- [ ] Fix B-1, B-3, B-4, B-5, B-6, B-7, B-8 in code; re-run CI; capture real Dodo payloads into the fixtures during the test purchase.
- [ ] Decide B-12 (testimonials/stats) and the existing-user-buys-on-web policy (B-1). Resolve B-13 (price).
- [ ] Vercel: add `open.kinderwell.app` + Namecheap CNAME; AASA returns JSON on **both** hosts, no redirect — **≥ 24 h before any v1.3.0 install** (B-9).
- [ ] Meta: Business Manager "Kinderwell" + second admin, domain verified, BM-owned pixel → `NEXT_PUBLIC_META_PIXEL_ID`, CAPI token → `META_CAPI_TOKEN`; record ids in OPS_RUNBOOK §2. Test run with `META_TEST_EVENT_CODE` (Lead/IC/Purchase each deduplicated browser+server), then **delete** the secret.
- [ ] Vercel: delete `NEXT_PUBLIC_DEV_SKIP`; Firewall rate-limit rule on both `/api` routes; `NEXT_PUBLIC_DODO_BUSINESS_ID` + `NEXT_PUBLIC_DODO_ENV=live` (B-10) or an explicit portal URL; `FUNNEL_PROXY_SECRET`.
- [ ] Dodo: live products (new `pdt_` ids), live key, new webhook endpoint + secret → **prod** ref; statement descriptor `KINDERWELL`; renewal-reminder + lifecycle emails ON; webhook failure alerts ON; portal shows Cancel.
- [ ] Resend: click/open tracking OFF on the prod sending domain too.
- [ ] Superwall `subscription_gate`: "Use a different account" → custom action `switch_account`, published.
- [ ] PostHog alerts (`paywall_skipped_by_superwall` > 1%, purchases −50% day-over-day) — OPS_STATE marks these "required BEFORE AD SPEND". Add `environment` / `surface` super-properties on the web first (XR-7).
- [ ] Sentry sourcemaps for 1.3.0 build 12.
- [ ] App v1.3.0 live: `release/1.3.0` → `main`, build from `main`, first EAS build's entitlements show both `applinks:` domains, TestFlight upgrade test, App Review note about the setup link, sandbox tester under the post-transfer account, phased release on.
- [ ] Device pass on a real iPhone, in Safari **and** from an Instagram ad preview with a card in Wallet: quiz → pay → Get Kinderwell → install → Paste → Learn; email "Open Kinderwell" opens the app; link page's button opens the app; `/manage` opens Safari; card entry painless in-app; FE-10's "tapped early" path.
- [ ] Legal: privacy policy gaps in §8 addressed; app legal docs mirrored.
- [ ] Update OPS_STATE / OPS_RUNBOOK rows; fix the stale ones (dev migration state, "three" vs "five" migrations, §2.4 secrets list).

### (B) Dev prerequisites (before the device pass)

- [ ] Dev Auth: Magic Link **and** Confirm signup templates show `{{ .Token }}` (B-11); OTP 6; SMTP via Resend; 100/h; 60 s interval — confirm each.
- [ ] Dev secrets: `FUNNEL_PROXY_SECRET` (Supabase **and** Vercel, redeploy), `UNSUBSCRIBE_SECRET`, `MAILING_ADDRESS`; then `scripts/deploy-functions.sh capture-email create-checkout dodo-webhook winback-sweep unsubscribe resume` from a green `main` — **not** `mint-handoff` yet (B-8).
- [ ] Deploy the new `delete-account` to dev (needs `DODO_API_KEY`, `DODO_ENV`) and re-run E2E flow 6 against it (XR-18).
- [ ] Schedule the hourly sweep (pg_cron, secret in a header) — it is what prunes `rate_limit_hits`, retries cancels and expires rows.
- [ ] `mint-handoff` to dev only for the one end-to-end handoff test while no ads run (it switches the live site's links on).
- [ ] Preview EAS build, ad-hoc install, acceptance tests §E incl. refund, cancel, delete-as-web-subscriber, existing-user-buys-on-web; check the `user_profiles` row and "no questionnaire".
- [ ] Decide P3-23 (ages 0–1 / 13–17), P3-21 (`whsec_` prefix).

### (C) Prod flip, one sitting, in this order

1. [ ] `scripts/check-migration-parity.sh` → `scripts/db-push-prod.sh` applies **all five** web migrations (prod is at `20260710010000`).
2. [ ] Prod secrets: the full OPS_RUNBOOK §2 list (`DODO_ENV=live`, live ids/key/secret, `FUNNEL_PROXY_SECRET`, `UNSUBSCRIBE_SECRET`, `MAILING_ADDRESS`, `SITE_URL`, Resend, Meta, PostHog, `SWEEP_SECRET`, `APP_STORE_URL`, `PRICE_*`).
3. [ ] `delete-account` → prod (after the migrations, never before); `redeem-handoff --no-verify-jwt` → prod; `functions list` shows the right JWT settings.
4. [ ] Prod Auth: OTP 6, both templates, SMTP with a separate prod key, 100/h, 60 s.
5. [ ] Web functions → prod with explicit names; `mint-handoff` last and only once 1.3.0 is live.
6. [ ] Dodo live webhook endpoint → prod ref, confirmed by one delivery.
7. [ ] Vercel Production env → prod URL/key, `NEXT_PUBLIC_SITE_URL`, live portal, delete `DEV_SKIP`, redeploy — do not pause between 5 and 7.
8. [ ] Hourly sweep scheduled on prod.
9. [ ] One real-card purchase → refund → `revoked` + Dodo cancelled → replay → no resurrection → re-buy with the same email → `active` with the new subscription id; Apple Pay visible with a card in Wallet; one deduplicated Purchase in Events Manager.
10. [ ] OPS_STATE rows + OPS_RUNBOOK §1 updated.

---

## 8. Claims, testimonials and privacy disclosures

**Claims to back or soften** (file:line in the appendix): "83% of parents just told us the exact same thing" (acknowledged placeholder); "give it two weeks and most parents say the house feels calmer"; "First results in: About two weeks"; "12 lessons" (plan) vs "Your personalized 10-week path" / "Week 10" (offer) vs "Every Kinderwell lesson"; "five minutes" (quiz) vs "5–10 minute lessons" vs "10 minutes a day"; "Science-based" / "Grounded in child-development research"; "No spam, ever" (two marketing emails follow); "Everything you share stays on your side" (answers are stored server-side, drive win-back emails, hashed email goes to Meta); "We send a reminder before annual renewals" (depends on a Dodo toggle). The eight named first lessons in `lib/quiz/scoring.ts:38-47` must exist in the app.

**Testimonials:** Sarah (landing), Megan (email page and offer page, two different quotes), Daniel and Aisha (offer), two with ★★★★★. Replace with real, attributed quotes or remove.

**Privacy policy vs code:** Resend, Supabase and Vercel are not named as processors; Meta also receives a hashed account id and purchase value, not only a hashed email; PostHog receives the IP on every event (not only email/checkout as stated); no cookie/local-storage section (`_fbp` / `_fbc`, the `.kinderwell.app`-wide PostHog cookie, `kw_*` storage with the email in plaintext, the 5-minute `kw_resume` cookie with email + answers); the win-back ladder is described only as "reminder emails"; the account email is passed to Dodo; retention does not mention entitlement records, handoff keys or Resend logs; no children's-data statement although the data is about children; no legal entity or postal address; the support address is `kinderwellteam@gmail.com` in the legal pages but `hello@kinderwell.app` on the homepage, unsubscribe page and `EMAIL_FROM`. The Terms lack an age requirement and a limitation-of-liability clause; auto-renewal, the cancel route and governing law are present and consistent across the offer, FAQ, welcome email and win-back email.

---

## 9. What is good (keep it)

Standard Webhooks verification with timestamp window and constant-time compare; idempotency as `processing → done` with a stale reclaim; user resolution by metadata only; single writer for `entitlements`; the pure state machine with 24-order tests against real Postgres; `activated_subscription_id` claim; refund → revoke → cancel with `cancel_pending` retry; proxy secret failing closed with `server-only`; `hit_rate_limit` as a single atomic upsert; RLS on every table and `handoff_keys` fully revoked; handoff keys as 256-bit single-use hashed credentials with an atomic claim, entitlement check before the session is minted, and the key kept out of logs, params, analytics and any page that loads analytics; the app's gate that never grants on error, with a user- and source-bound cache; `/welcome` stripping PII server-side with an allowlist; Lead id hashed on both sides; the documentation discipline (OPS_RUNBOOK + MANUAL_STEPS + OPS_STATE) that made this review possible.

---

## 10. Open questions for the owner (answers change the verdict)

1. **Are the four testimonials from real customers, and can "83%", "two weeks", "12 lessons" be backed?** If not, B-12 is a launch blocker on Meta policy alone.
2. **May an existing Kinderwell app user buy on the web into their existing account?** If yes, B-1's fix is "OTP before attaching to an existing account" (and the welcome email keeps its link). If no, it is "refuse checkout for pre-existing accounts", which is simpler and also answers P3-7.
3. **Which Supabase project will kinderwell.app point at on the first ad day?** Your docs say prod after the §9 flip. If ads must start before the flip, the live site keeps writing real customers into the dev project, which is also the app's E2E playground.
4. **US + iPhone only at launch, as the docs assume?** Everything above assumes that scope; §9 of the prior review covers the rest.
5. **Has Apple Pay ever been seen on the Dodo checkout from an iPhone with a card in Wallet, in Safari and inside Instagram?** The runbook says unverified. The in-app browser is most of your traffic and B-6 is its escape hatch.
6. **App Store annual price: $59.99 or $69.99?**
7. **Is the private web repo's CI green on `a2be939`, and is anything stopping a red `main` from deploying to Vercel?** I could not see either.
8. **Is the public mirror meant to expose the Apple team id (web) and the Google OAuth client id + Apple key ids (app)?** None is a secret, but the two mirrors contradict each other's redaction policy.

---

*Appendix (full per-area reports with every finding, line reference, verified-fix table and test gap): `~/Desktop/KIN/review-appendix/`.*
