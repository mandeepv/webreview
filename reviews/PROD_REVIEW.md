# Production-readiness review — kinderwell-web (web2app funnel)

**Reviewed:** commit `3252895` ("Kinderwell web funnel — snapshot for review"), 2026-09-30. **Scope:** every file in the repo (Next.js app, `lib/`, five Supabase edge functions, two migrations, config, docs), plus `next build`, `tsc`, `npm audit`, the `dodopayments-checkout` SDK bundle that ships to the browser, and the Dodo Payments / Meta docs where the code's assumptions needed checking. **Launch scope assumed:** US + iPhone only (per the docs). Global concerns are in §9 for later versions. **Format:** report only; no code was changed. Each finding has a severity, the file and line, the concrete scenario, and a recommended fix.

Severity meaning:

| Level | Meaning |
|---|---|
| P0 Critical | A paying customer loses access, money is taken without service, or the funnel is broken. Do not spend on ads until fixed. |
| P1 High | Likely to leak users, revenue, or attribution at real traffic volumes. Fix before the first ad dollar. |
| P2 Medium | Will bite within the first weeks or under specific but realistic conditions. |
| P3 Low | Polish, hygiene, or defence in depth. |

Verification status: **build passes** (`next build` with the required `NEXT_PUBLIC_*` vars set; it correctly fails without them), **`tsc --noEmit` passes**, `deno check` could not be run here (Deno not installed on this machine; the runbook says it passed on 2026-09-28). `npm audit` reports only a transitive build-time `postcss` advisory inside `next` (see P3-8).

---

> ## Fix status — as of 2026-09-30
>
> **Code:** all 4 Critical and all 17 High findings are fixed in code (commits
> `40eaa96`, `66f32c8`, `f556fc8`), plus most Medium and Low ones. The status
> of every finding is marked right under it below. **Nothing is deployed yet**,
> and the commits are local (not pushed).
>
> **Pending before the first ad dollar — owner steps** (MANUAL_STEPS §8.6, §8.7):
> 1. Set `FUNNEL_PROXY_SECRET` in Supabase **and** Vercel (the new functions refuse all funnel traffic without it).
> 2. Apply migrations `…0928_email_opt_outs` and `…0930_webhook_hardening`, then deploy all six functions (`resume` is new) — P0-4.
> 3. Set `NEXT_PUBLIC_DODO_BUSINESS_ID` in Vercel (P1-1); add the Vercel WAF rule (P1-7); enable Dodo's renewal reminder (P2-9); purge old PostHog `$autocapture` events (P1-9).
> 4. Run the dashboard checks V1–V8 (§5) and the extra §7 checks in MANUAL_STEPS §8.7, including the Instagram in-app browser test (P1-5).
> 5. Unchanged from §8: Meta setup, `MAILING_ADDRESS`, delete `NEXT_PUBLIC_DEV_SKIP`, live Dodo products, proof stats and testimonials, iOS Phase 0.
>
> **Pending code (Medium/Low):** ~~server-side CAPI Lead/InitiateCheckout (P2-2), OG image (P2-5), same-subscription stale events (P2-17), P3 5, 6, 18, 25, 26, and P3-1's required `UNSUBSCRIBE_SECRET`~~ — **done 2026-10-05** on `test/coverage`. App-side account deletion (P2-3) is done in `mamalearn` (`feat/web-purchase-unlock`). **Accepted, not changed:** P2-13, P2-16 (reasons under each). **Still open:** P3-4 (measure /building drop-off first), P3-21 (needs Dodo's secret format).
> **Decisions for the owner:** age gating (P3-23), Apple-subscriber notice (P3-7), 409 wording (P3-16).

## 0. Executive summary

The codebase is unusually well-reasoned for a v1 funnel: webhook signature verification, idempotency, a proxy secret, a single writer for entitlements, HTML-escaped emails, no PII to PostHog by design, and honest documentation. The bones are right.

But the money path has **four Critical issues** that will each turn a real purchase into a customer with no access or a customer who gets chased by marketing email after paying, and they are all reachable with normal usage, not edge cases:

1. **A refunded customer who buys again is charged and never activated** (P0-1).
2. **Dodo delivers the first-purchase webhooks concurrently and unordered; the code assumes `subscription.active` lands first.** When it does not, the handoff email and the Meta Purchase never fire, and the "abandoned cart" ladder emails the paying customer (P0-2).
3. **A test/live mismatch between two env vars makes the buyer pay and then sit on a frozen checkout overlay with no redirect** — worse than the docs describe (P0-3).
4. **Production is currently running a mix of new site code and old edge functions** (P0-4).

There are also High findings that the code cannot see but the docs assume: the `/manage` cancel URL printed in every email, the offer page, and the footers is **not Dodo's documented portal URL** (P1-1); **the buyer can change their email on the Dodo checkout page**, after which the handoff tells them to sign in with the wrong address (P1-2); **Apple Pay is not available inside the Instagram/Facebook in-app browser**, which is where most iOS ad clicks open (P1-5); **the buyer's plaintext email is in the `/welcome` URL and goes to Meta and PostHog** (P1-9b); and **the ad landing page prerenders as an empty document** (P1-13).

Counts: 4 Critical · 17 High · 23 Medium · 27 Low, plus 8 dashboard checks (§5) and 12 global-launch items (§9).

Recommended order of work: P0-1 → P0-2 → P0-3 → P1-1 → P1-2 → P1-3/3b/3c → P1-4, then the rest of P1, then deploy (P0-4), then test the whole §7 checklist in live mode with a real card. §7 has the full ordered list with effort estimates.

---

## 1. P0 — Critical (do not run ads until fixed)

### P0-1. A refunded (revoked) customer who re-purchases is charged and never gets access

> **Status (2026-09-30):** ✅ **Done** (`40eaa96`) — the revoked guard only applies to the same subscription; a new subscription re-activates. Revoked customers ARE allowed to buy again (owner decision). Tested in `_shared/entitlement_test.ts`.

- **Where:** `supabase/functions/dodo-webhook/index.ts:193–201` (resurrect guard) and `supabase/functions/create-checkout/index.ts:71–78` (duplicate guard).
- **Scenario:** Customer buys → asks for the 14-day refund → you refund in Dodo → webhook sets `entitlements.status = 'revoked'` (correct). Two months later they see another ad, run the quiz with the same email, and pay again. `create-checkout` lets them through (the dup guard only blocks `active | past_due | cancelled`). Dodo charges them. The new `subscription.active` webhook arrives, the handler reads the existing row, sees `revoked`, and returns **before writing anything**. No entitlement, no handoff email, no `unlinked_purchases` row, no owner alert, no PostHog event. The customer has paid and is invisible to every safety net in the system. The same applies to a `dispute.won` customer and to anyone you revoked by hand.
- **Fix:** Make the guard subscription-aware. Only ignore an event when `data.subscription_id === current.dodo_subscription_id` **and** the row is `revoked` (a replay for the same revoked subscription). A different `subscription_id` is a new purchase and must activate. Separately decide whether revoked customers may buy again at all; if not, add `revoked` to the checkout dup guard with a friendly message instead of silently taking money.

### P0-2. First-activation side effects depend on webhook delivery order, which Dodo does not guarantee

> **Status (2026-09-30):** ✅ **Done** (`40eaa96`) — new `activated_subscription_id` column; side effects fire only for the delivery that wins a conditional UPDATE, so exactly once per subscription in any order (existing rows backfilled). Needs migration `…0930_webhook_hardening`.

- **Where:** `supabase/functions/dodo-webhook/index.ts:195–233`.
- **Evidence:** `OPS_RUNBOOK.md` §3 records that a single test purchase produced **four deliveries** (`subscription.active`, `subscription.renewed`, `payment.succeeded`, `subscription.updated`). Dodo's docs give no ordering guarantee for subscription events. The handler decides `isFirstActivation` by reading the current row and checking `type === 'subscription.active' && current?.status !== 'active'`.
- **Scenario A (race):** `subscription.renewed` is processed first (or concurrently) → it upserts `status = 'active'`. Then `subscription.active` runs → `current.status === 'active'` → `isFirstActivation = false`. Result: **no handoff email, no Meta CAPI Purchase, `funnel_sessions.purchased_at` stays null.** Because `purchased_at` is null, `winback-sweep` (lines 44–95) treats the buyer as an abandoned lead and sends "Your Kinderwell plan is ready" after 1 hour and "Still thinking it over?" after 24 hours — to someone who just paid. The two functions run in parallel Deno isolates, so this is a true race, not a theoretical one.
- **Scenario B (repeat activation):** a `past_due` / `on_hold` subscription recovers, or a cancelled one is reactivated in the portal, and Dodo sends `subscription.active` again → `current.status !== 'active'` → `isFirstActivation = true` again → **a second CAPI Purchase with the same `event_id`** (Meta only dedups within 48 hours, so this is counted as a new sale and inflates ROAS), a second handoff email, and `purchased_at` overwritten.
- **Fix:** Add an `activated_at timestamptz` column to `entitlements`. Perform the upsert, then run a single conditional update `set activated_at = now() where user_id = ? and source = 'dodo' and activated_at is null returning 1`. Fire the side effects only when that update returns a row. This is atomic, order-independent, and idempotent. Also treat `subscription.renewed` as an activation trigger when no row existed (it is part of the first-purchase burst).

### P0-3. `NEXT_PUBLIC_DODO_ENV` ≠ `DODO_ENV` leaves a buyer who has already paid stuck on the overlay

> **Status (2026-09-30):** ✅ **Done** (`40eaa96`) — overlay mode derived from the checkout URL's host; `NEXT_PUBLIC_DODO_ENV` now only guards dev-skip. `checkout.redirect` also handled as a fallback.

- **Where:** `lib/checkout.ts:40` (mode from `NEXT_PUBLIC_DODO_ENV`, default `'test'`), `OPS_RUNBOOK.md` §1b.7b.
- **What the SDK actually does** (verified in `node_modules/dodopayments-checkout/dist/index.js`): `Initialize({mode})` sets `allowedOrigin` to the test or live checkout origin. The overlay iframe reports success by posting a `checkout.redirect` message with `redirect_to = return_url?...status=active`; the parent then does `window.location.href = redirect_to`. **Messages from any other origin are dropped** ("Ignored message from disallowed origin"). So if the site is built with `test` but the session is live, the iframe loads and the buyer can pay (the URL host is the live one), but the parent never receives `checkout.redirect`. The buyer is charged, sees the overlay's success state or nothing, is never sent to `/welcome`, gets no browser Purchase event, and the "Opening secure checkout…" button stays busy. The runbook describes the failure as "cannot find a session" — the real failure is worse.
- **Fix:** Stop having two sources of truth. Derive the mode in `openOverlayCheckout` from the URL the server returned: `new URL(checkoutUrl).hostname.startsWith('test.') ? 'test' : 'live'`. Delete `NEXT_PUBLIC_DODO_ENV` and its go-live step. Also handle `checkout.redirect` yourself as a belt-and-braces: if the event arrives with `data.message.redirect_to`, navigate to it.

### P0-4. Production is running new site code against old edge functions and an un-applied migration

> **Status (2026-09-30):** 👤 **Pending — owner step** — apply migrations `…0928` + `…0930`, set `FUNNEL_PROXY_SECRET`, deploy all six functions (MANUAL_STEPS §8.6 → §8.7), then the §7 checklist.

- **Where:** `OPS_RUNBOOK.md` §1 and §3 (2026-09-28 entry).
- **State as documented:** site code from 2026-09-28 is live on Vercel; the five edge functions are the 2026-09-19 versions; `unsubscribe` does not exist; migration `20260928000000_email_opt_outs` is not applied.
- **Consequences today:** the `/unsubscribe` page always shows "That link didn't work"; the deployed `winback-sweep` sends marketing email with **no unsubscribe link and no postal address** (a CAN-SPAM violation from the first send) and ignores opt-outs; refunds and disputes **do not revoke access**; the proxy secret is not enforced. If the hourly cron from `MANUAL_STEPS.md` §2.5 is scheduled on dev, the old ladder is already running against dev test users.
- **Fix:** Apply the migration, then deploy all five functions (order matters, as the docs say), then re-run the §7 checklist. Add a "deployed function version" line to the runbook and a CI job (see P1-12) so drift is visible.

---

## 2. P1 — High (fix before the first ad dollar)

### P1-1. `/manage` redirects to a URL that is not Dodo's customer portal login

> **Status (2026-09-30):** ✅ **Done** (`f556fc8`) — partly overstated: Dodo documents the bare `customer.dodopayments.com` as its Unified Customer Portal, so `/manage` did work. `/manage` now builds the business-specific `/login/<business_id>` (test/live host) from `NEXT_PUBLIC_DODO_BUSINESS_ID`. 👤 Set that env var in Vercel and check Cancel works in test mode (V2).

- **Where:** `lib/config.ts:39` (`https://customer.dodopayments.com`), `app/manage/route.ts:8–10`.
- **Verified against Dodo docs:** the static portal login is `https://customer.dodopayments.com/login/{business_id}` (test: `https://test.customer.dodopayments.com/login/{business_id}`). The bare host is not documented as a login page.
- **Why it matters:** "Cancel anytime at kinderwell.app/manage" is printed on the offer page (`app/offer/page.tsx:31,252`), in the handoff email (`dodo-webhook/index.ts:382`), in both footers, and it is the mechanism the Terms rely on for California's online-cancellation requirement. If it dead-ends, a customer who cannot find how to cancel files a chargeback. The runbook defers checking this until after the first live purchase; check it now in test mode.
- **Fix:** Set `NEXT_PUBLIC_DODO_PORTAL_URL` to the documented `/login/{business_id}` URL for the correct mode, and make the default in `config.ts` fail loudly (or drop the default) so a missing value cannot silently produce a broken cancel link.

### P1-2. The buyer can change their email on the Dodo checkout page; the code assumes they cannot

> **Status (2026-09-30):** ✅ **Done** (`40eaa96`) — `feature_flags.allow_customer_editing_email: false`; welcome email goes to the account email (and to the checkout email too if they ever differ, with an owner alert); `/welcome` shows the account email.

- **Where:** `supabase/functions/create-checkout/index.ts:96–109` (no `feature_flags`), `dodo-webhook/index.ts:230–231` (handoff email to `data.customer.email`), `app/welcome/page.tsx:55` (shows Dodo's `email` query param in preference to the session email).
- **Verified against Dodo docs:** "By default, customers can edit their email during checkout. To lock it, set `feature_flags.allow_customer_editing_email` to `false`."
- **Scenario:** Parent enters `sarah@gmail.com` on `/email` (Supabase user created). On the checkout page they type `sarah.work@company.com` (autofill, or they want the receipt at work). Payment succeeds. The entitlement is written to the `sarah@gmail.com` user (correct, via metadata). But the handoff email goes to `sarah.work@…` and tells her to "sign in with this email", and `/welcome` shows `sarah.work@…` as "the email you used at checkout". She signs in to the app with the work address → no account → hard paywall → "I paid and it doesn't work" → refund or chargeback.
- **Fix:** (1) Pass `feature_flags: { allow_customer_editing_email: false }` when creating the session. (2) In the webhook, send the handoff email to the Supabase user's email (`admin.auth.admin.getUserById(userId)`), not the Dodo customer email; if they differ, send to both and alert the owner. (3) On `/welcome`, prefer the stored session email and use Dodo's echo only as a fallback.

### P1-3. A late webhook for an OLD subscription overwrites the customer's NEW one

> **Status (2026-09-30):** ✅ **Done** (`40eaa96`) — degrading events for a subscription other than the one on file are ignored. Tested.

- **Where:** `supabase/functions/dodo-webhook/index.ts:205–217` (upsert keyed on `user_id, source`, unconditionally overwriting `status`, `dodo_subscription_id`, `current_period_end`).
- **Scenario:** Customer cancels (row `cancelled`, access to period end). Period ends; the sweep flips the row to `expired`. They come back through the funnel and buy again → new subscription `sub_B` → row becomes `active`, `dodo_subscription_id = sub_B`. Dodo then emits `subscription.expired` for `sub_A` (Dodo fires terminal events when the old period actually closes, which can be after the re-purchase, and retries can arrive days late). The handler resolves the user from metadata, the row is not `revoked`, so it upserts `status = 'expired'`, `dodo_subscription_id = sub_A`. **The new paying subscription is now locked out**, and the next `subscription.renewed` for `sub_B` will fix it only a year (or a month) later. `subscription.cancelled` for `sub_A` arriving late has the same effect.
- **Fix:** In `handleSubscription`, if the existing row has a different `dodo_subscription_id` than the event and the existing row's status is `active` / `past_due` / `cancelled` with a future `current_period_end`, ignore the event and log it (or write it to `unlinked_purchases` with a "stale subscription" reason). Alternatively key entitlement rows by `dodo_subscription_id` and let the app pick the best row.

### P1-3b. Double purchase inside the webhook-latency window is not blocked, and the second subscription becomes invisible

> **Status (2026-09-30):** ✅ **Done** (`40eaa96`) — `create-checkout` hands back the same unpaid checkout for 30 min per session+plan (a Dodo session can't be paid twice); if a second live subscription still appears, the webhook cancels it and alerts the owner to refund its first charge.

- **Where:** `create-checkout/index.ts:63–78` (dup guard reads `entitlements`, which is only written by the webhook), `dodo-webhook/index.ts:205–217`.
- **Scenario:** Buyer pays in the overlay; the redirect to `/welcome` fails or they press back; they tap "Get my plan" again 20 seconds later. No entitlement row exists yet, so a second checkout is created and they pay again. Two `subscription.active` events arrive; the row keeps whichever wrote last, and the other subscription bills forever with no row pointing at it. A later refund or dispute on the invisible one resolves to no row → `parkUnlinked` → the runbook tells you it is "a paying customer without access", which is the wrong diagnosis.
- **Fix:** In `create-checkout`, store the created `session_id`/timestamp on `funnel_sessions.capi` and refuse a new checkout if one was created in the last ~10 minutes and no entitlement exists yet (return a "your payment is being confirmed" message). In the webhook, when a `subscription.active` arrives for a different `subscription_id` while the row is `active` with a future `current_period_end`, alert the owner and auto-cancel the newer duplicate via `cancelDodoSubscription` so it can be refunded by hand.

### P1-3c. A network error in the Dodo cancel call after a refund is never retried: the refunded customer keeps being billed

> **Status (2026-09-30):** ✅ **Done** (`40eaa96`) — the cancel call never throws; new `cancel_pending` column; the hourly sweep retries until Dodo confirms.

- **Where:** `dodo-webhook/index.ts:286–300` (`if (row.status === 'revoked') continue;` before the cancel), `dodo-webhook/index.ts:314–333` (`fetch` not wrapped in `try/catch`; only a non-2xx response alerts), `dodo-webhook/index.ts:173–179` (catch-all deletes the idempotency row and returns 500).
- **Scenario:** `refund.succeeded` arrives. The row is set to `revoked` (committed). `cancelDodoSubscription` throws on a connection reset / DNS / timeout to `live.dodopayments.com`. The throw propagates: idempotency row deleted, 500, Dodo retries. On the retry the row is already `revoked`, so line 288 `continue`s past the cancel. Result: no cancel, no alert (the alert only fires on a non-OK HTTP status, which never happened), and the customer is billed again at renewal with no access — exactly the chargeback the comment at line 296-298 warns about. The runbook notes this path has never run end to end.
- **Fix:** Wrap the fetch in `try/catch` and route any error to `alertOwner`; never throw after the revoke write. Better: add a `cancel_pending` boolean (or `cancelled_at`) column, set it before calling Dodo, clear it on success, and have the sweep retry any row with `cancel_pending = true`.

### P1-4. A missing `next_billing_date` produces an entitlement the app treats as not entitled

> **Status (2026-09-30):** ✅ **Done** (`40eaa96`) — an activating event never writes null: keeps a future period end on file or adds the plan length, and alerts the owner. Tested.

- **Where:** `dodo-webhook/index.ts:213` (`current_period_end: data.next_billing_date ?? null`), `create-checkout/index.ts:74` (dup guard requires `current_period_end`), migration comment lines 9-10 (app treats `current_period_end > now()` as entitled).
- **Scenario:** Any activation event where Dodo omits `next_billing_date` (payload change, a trial, a plan change, a `subscription.updated` delivered as the last event with partial data) writes `current_period_end = null`. The app's rule then denies access to a paying customer, and the dup guard disappears so they can be charged again.
- **Fix:** Never write `null` on an activating event. Fall back to the previous `current_period_end` if present, else compute from `metadata.plan` (now + 1 month/year) and send an owner alert that the fallback was used.

### P1-5. Apple Pay is not available inside the Instagram/Facebook in-app browser, where most iOS ad clicks land

> **Status (2026-09-30):** ✅ **Done** in code (`f556fc8`) — inside Instagram/Facebook, `/offer` says card works here and Apple Pay needs Safari, with a copyable `/r/<token>?to=offer` link that reopens the same checkout in Safari. 👤 Still needs the real-device test from an Instagram ad preview (V3).

- **Where:** `create-checkout/index.ts:108` (requests `apple_pay`), `MANUAL_STEPS.md` §3 ("Apple Pay is make-or-break for iOS conversion"), `OPS_RUNBOOK.md` §3 ("Apple Pay: still UNVERIFIED").
- **Fact:** Apple Pay on the web (`ApplePaySession`) works in Safari and `SFSafariViewController`, not in `WKWebView`-based in-app browsers. The Facebook and Instagram iOS apps open ad links in their own `WKWebView` browser by default. Inside it, the Dodo overlay will show card entry only. The runbook's test happened in Safari with no card in Wallet, so nothing has been proven either way.
- **Why it matters:** the entire pricing/UX strategy assumes an express-pay path on iPhone. Without it, conversion on the majority of your traffic is card-typing on a phone.
- **Fix:** (1) Test the full funnel from a real Instagram ad preview on an iPhone with a Wallet card. (2) Design for card-first in the in-app browser: make the card form fast (Dodo's `single_page` flag, no phone/tax fields), and keep Apple Pay as a bonus in Safari. (3) Consider a small "Open in Safari for Apple Pay" affordance on `/offer` when `navigator.userAgent` contains `FBAN` / `FBAV` / `Instagram` — but note P1-6: switching browsers loses the `localStorage` session, so this only works after P1-6's resume token exists. (4) Meta's "Open links in external browser" ad-level setting exists on some placements; evaluate it.

### P1-6. Win-back email links open in a different browser and drop the user at the start of the quiz

> **Status (2026-09-30):** ✅ **Done** (`f556fc8`) — new `resume` function + `/r/<token>` route. Win-back links carry an HMAC-signed 30-day token; the server resolves it and hands the session over in a 5-minute cookie, so the token never appears in a page URL Meta/PostHog could see. Same `sessionId` is kept. Tested (tokens + cookie hand-off).

- **Where:** `supabase/functions/winback-sweep/index.ts:82–88` (links to `${site}/plan`), `lib/session.ts` (localStorage only), `app/offer/page.tsx:122–125` (redirect to `/start` when `emailCaptured` is false), `app/plan/page.tsx:17–18` (renders generic rows with no answers).
- **Scenario:** Quiz done in the Instagram in-app browser. One hour later the "Your Kinderwell plan is ready" email is opened in the Gmail app, which opens `/plan` in its own in-app browser or Safari — a different storage context. `/plan` shows "Your hardest moments / Calmer days / 12 lessons" (no personalisation), "This is me" → `/quiz/14` → three screens → `/offer` → `emailCaptured` is false → **redirect to `/start`**. The customer who was promised "pick up where you left off" restarts the quiz and re-enters their email, which creates a second `funnel_sessions` row for the same user. Expect this to be the *majority* case for email traffic, not the exception.
- **Fix:** Sign the win-back link like the unsubscribe link (`/plan?u=<userId>&t=<hmac>`), add `GET /api/resume` (proxy to a small edge function) that returns `{ answers, landingVariant, utm, email, userId, sessionId }` for a valid token, and have `/plan` rebuild the localStorage session from it before rendering. Keep the same `sessionId` so the purchase attaches to the original funnel row.

### P1-7. Nothing in code limits account creation or outbound marketing email; the only rate limit is a manual Vercel Firewall rule that is not set

> **Status (2026-09-30):** ✅ **Done** in code (`66f32c8`, `f556fc8`) — Postgres-backed limits (`hit_rate_limit()`, no new vendor): capture-email 10/min/IP, 40/hour/IP, 5/hour per address; create-checkout 20/min/IP and 10 per session per 10 min; session ids UUID-validated; honeypot field; win-back ladder is per person with a two-send cap, skips payers and accounts that predate the session. 👤 Vercel WAF rule still recommended on top.

- **Where:** `app/api/capture-email/route.ts`, `supabase/functions/capture-email/index.ts:78–90` (creates a confirmed auth user per new email), `winback-sweep/index.ts:44–95` (two marketing emails per such user), `MANUAL_STEPS.md` §8.6 (rate limit listed as an owner task, unchecked).
- **Scenario:** A script posts 50,000 random or harvested addresses to `/api/capture-email` with a valid session UUID. Each creates a Supabase auth user and a `funnel_sessions` row; within 24 hours each receives two marketing emails from `hello@kinderwell.app`. Spam complaints get the domain blocklisted, which also kills the transactional handoff email for real buyers. Supabase auth also has per-project limits you would hit.
- **Also:** the ladder is keyed per **session row**, not per user, so N forged sessions for one victim = 2N emails; `get_user_id_by_email` resolves existing iOS-app users too, so a harvested customer list can subscribe your whole existing user base to "Your Kinderwell plan is ready". `create-checkout` (`index.ts:46`) does not even UUID-validate `sessionId` and creates a Dodo session per call, so the same attacker can hammer Dodo's API under your key.
- **Fix (layered):** (1) Set the Vercel WAF rate-limit rule now (10/min/IP on both API routes) — this is the one-line mitigation. (2) Add an in-code limiter in the proxy (Vercel KV / Upstash Ratelimit, keyed by IP and by email) so protection does not depend on dashboard state. (3) Make the win-back ladder per **user** with a lifetime cap of two sends, coalesce repeat `capture-email` calls for the same user into the existing unpurchased session, skip users whose `created_at` predates the funnel session (existing app users), and only start the ladder for sessions that actually reached `/offer`. (4) UUID-validate `sessionId` in `create-checkout` and refuse a new Dodo session if one was created for that funnel session in the last minute. (5) Add a hidden honeypot field to the email form; consider Cloudflare Turnstile only if abuse appears.

### P1-8. The expiry sweep locks out paying customers if a renewal webhook is late by more than a day

> **Status (2026-09-30):** ✅ **Done** (`40eaa96`) — `active` rows get 5 days' grace (1 day for past_due/cancelled); the sweep asks Dodo about overdue active rows first, heals them if Dodo says active, and alerts the owner.

- **Where:** migration `20260918000000_web2app.sql:102–117` (`expire_stale_entitlements` flips `active` rows 1 day after `current_period_end`), `winback-sweep/index.ts:138`.
- **Scenario:** Dodo retries a failed webhook with backoff over days; or the webhook secret was rotated and every delivery is 401 for a weekend; or the prod endpoint is briefly misconfigured. Renewal charges succeed, but `subscription.renewed` does not land within 24 hours of `current_period_end`. The sweep sets every affected `active` row to `expired`. Customers who were just billed lose access at next app launch. Nothing alerts you.
- **Fix:** Use a longer grace for `active` rows (e.g. 5 days), keep 1 day for `cancelled`. Before expiring an `active` row, reconcile against `GET /subscriptions/{id}` from the Dodo API and only expire if Dodo agrees. Alert the owner whenever an `active` row is expired by the sweep, with the count.

### P1-9. PostHog autocapture sends quiz answers (parental mental state, child behaviour) as button text

> **Status (2026-09-30):** ✅ **Done** (`40eaa96`) — PostHog `autocapture: false`, `disable_session_recording: true`, `capture_pageleave: false`. 👤 Purge historical `$autocapture` events for the web host in PostHog.

- **Where:** `lib/analytics.ts:15–19` (no `autocapture: false`), `components/ui.tsx:101–130` (option rows are `<button>`s whose text is the answer), `OPS_RUNBOOK.md` §1b.8 ("plus autocapture clicks" observed live).
- **Why it matters:** the README's house rule is "no answers to PostHog", and `app/layout.tsx:35–42` disables Meta autoConfig for exactly this reason — but PostHog autocapture records `$el_text` for every click, so "I raise my voice, then feel awful" and "Underwater most days" are already in PostHog against an identified user id. This contradicts the privacy policy's framing and is the category of data that regulators treat as sensitive. If the shared PostHog project has session replay enabled, the web funnel is being recorded too.
- **Fix:** `posthog.init(key, { autocapture: false, disable_session_recording: true, mask_all_text: true, capture_pageview: false, … })`. You already have a typed event registry; you do not need autocapture. Then purge the historical `$autocapture` events for the web host.

### P1-9b. The buyer's plaintext email is in the `/welcome` URL and is sent to Meta and PostHog

> **Status (2026-09-30):** ✅ **Done** (`40eaa96`) — `/welcome` is a server component that 307s to a URL with only `status`/`subscription_id`/`payment_id` before any HTML; PostHog `before_send` also scrubs email params from URL properties. Verified locally.

- **Where:** `create-checkout/index.ts:99` (`return_url: …/welcome`), `app/welcome/page.tsx:15–16,55` (reads `?email=`), `app/layout.tsx:52` (`fbq('track','PageView')` on the initial load of that URL), `app/welcome/page.tsx:56` (`track(...)`).
- **Verified:** Dodo's docs list `email` among the parameters appended to `return_url`. The Meta pixel sends `document.location.href` (query string included) with every event; posthog-js attaches `$current_url` (full href) to every event. So the first PageView on `/welcome?…&email=sarah@gmail.com` hands Meta the **unhashed** email, and PostHog stores it against the identified user — contradicting `app/legal/privacy/page.tsx:31–34` ("a hashed (irreversibly encoded) version of your email") and the README's house rule. The URL is also in browser history and Vercel logs.
- **Fix:** Make `/welcome` a server component that reads `searchParams`, keeps only `status` and `subscription_id`, and `redirect()`s to a clean URL before any HTML (and therefore before the pixel snippet) is sent; take the email from the local session (already the fallback at line 55). As a backstop set PostHog `sanitize_properties` to strip `email` from `$current_url` / `$referrer`, and add `ph-no-capture` to the "Copy" button that renders the email as button text (autocapture would otherwise send it as `$el_text`, see P1-9).

### P1-10. The checkout overlay's `onClose` callback goes stale after the offer page remounts, leaving the CTA stuck on "Opening secure checkout…"

> **Status (2026-09-30):** ✅ **Done** (`40eaa96`) — `Initialize` re-runs on every open with the current `onClose`; `checkout.link_expired` and `checkout.error` close the overlay and reset the button.

- **Where:** `lib/checkout.ts:21,36–62` (module-level `initialized`; `onEvent` closure captures the first call's `onClose`), `app/offer/page.tsx:170` (`onClose = () => setBusy(false)` of the current component instance).
- **Scenario:** `/offer` → "Get my plan" → overlay opens → close it → tap "Refund policy" in the footer → back to `/offer` (new component instance) → "Get my plan" → overlay opens → close it. The SDK calls the *first* instance's `onClose`; React drops the state update on the unmounted component. The new instance's `busy` stays `true` forever: the button reads "Opening secure checkout…" and is disabled. The only recovery is a page reload. Also affects a user who uses browser back from `/legal/*`, and (in dev) React Strict Mode double-mounting.
- **Fix:** Keep a module-level `let currentOnClose: (() => void) | null` that `openOverlayCheckout` overwrites on every call, and have the `onEvent` handler call `currentOnClose?.()`. Additionally handle `checkout.link_expired` (call `onClose` and show a retry message) since sessions expire after 24 hours.

### P1-10b. `/offer` restored from the back-forward cache comes back with the button disabled and a stale overlay

> **Status (2026-09-30):** ✅ **Done** (`40eaa96`) — `pageshow` with `persisted` closes any overlay and resets `busy`; `busy` also resets after the hosted-page redirect.

- **Where:** `app/offer/page.tsx:170–171` (`busy` stays true after `window.location.href = checkoutUrl`; on the overlay path the SDK navigates to `/welcome` without closing its iframe first).
- **Scenario:** iOS Safari restores `/offer` from bfcache when the user presses back from Dodo's hosted page or from `/welcome?status=failed`. React state is preserved: both CTAs read "Opening secure checkout…" and are disabled. On the overlay path the fixed full-screen `z-index:1000` iframe is still in the DOM covering the page.
- **Fix:** Listen for `pageshow` with `event.persisted` and reset `busy` and call `DodoPayments.Checkout.close(false)`; also reset `busy` immediately after assigning `location.href`.

### P1-13. The ad landing page `/start` prerenders as an empty document

> **Status (2026-09-30):** ✅ **Done** (`40eaa96`) — `/start` reads `searchParams` on the server; variant copy is in the first HTML (verified with curl).

- **Where:** `app/start/page.tsx:8–10` (client component under `<Suspense>`), `app/start/landing-client.tsx:32` (`useSearchParams()` forces client-side rendering at that boundary).
- **Verified:** `.next/server/app/start.html` contains no `<main>` and none of the landing copy; `/offer` and `/email` HTML do contain theirs.
- **Scenario:** First paint after an ad tap on a slow connection in the in-app browser is a blank cream page until the JS bundle downloads and runs. Meta's link crawler and share previews see no body. This is the page every ad dollar lands on.
- **Fix:** Read `searchParams` in the server `page.tsx` (exactly as `app/page.tsx:11–16` already does), choose the variant there, pass it as a prop, and call `captureAttribution(new URLSearchParams(window.location.search))` in the effect. Drop `useSearchParams` and the Suspense. This also enables a per-variant `<title>` / OG title (P2-5).

### P1-11. Prices are duplicated in four places, and the Meta Purchase value is the display price, not the charged amount

> **Status (2026-09-30):** ✅ **Done** (`40eaa96`, `f556fc8`) — CAPI value/currency and the welcome-email price come from the Dodo payload; `create-checkout` compares the displayed price with the Dodo product price and refuses checkout + alerts the owner on a mismatch. The display price still lives in Vercel env, but drift can no longer charge a price the page didn't show.

- **Where:** `lib/config.ts:30–31` (defaults), `.env.example` (`NEXT_PUBLIC_PRICE_*`), `MANUAL_STEPS.md` §2.4 (`PRICE_*` secrets), `dodo-webhook/index.ts:405–408` (CAPI value from secrets), Dodo products (charged).
- **Scenario:** You change the annual price in Dodo to $49.99 for a test and forget one of the other three. The offer page says $59.99 (FTC problem), or Meta learns on a wrong value (ROAS wrong), or the FAQ contradicts the plan row.
- **Fix:** Take the CAPI `value` from the webhook payload (the subscription's recurring amount, or the `payment.succeeded` `total_amount`) and `currency` from the same payload. Fetch display prices once at build time from the Dodo product API if you want to go further, or at least make the three env values one value.

### P1-12. No tests, no CI; the "lint" step is a no-op

> **Status (2026-09-30):** ✅ **Done** (`66f32c8`, `f556fc8`) — CI on push/PR (typecheck, ESLint `next/core-web-vitals`, Vitest, build, `deno check`, `deno test`). 33 deno tests (state machine incl. revoked→re-purchase, stale subscription, missing `next_billing_date`, on_hold; signature; refund/dispute classification; pricing; tokens) + 16 Vitest tests (payment state, in-app detection, URL scrubbing, journey progress, attribution, Meta cookies, resume hand-off). Not covered: DB-level paths (activation claim, idempotency reclaim, FK violation) — those need a live Supabase test run.
>
> **Update (2026-10-05, branch `test/coverage`):** those gaps are now covered. Integration tests run every edge function against a real local Supabase in CI (activation claim incl. all 24 delivery orders and a concurrent burst, idempotency reclaim, FK violation, refunds/disputes, checkout guards, the win-back ladder); pgTAP covers RLS, function grants and the SQL functions; Playwright covers the funnel and the purchase page. The work found and fixed one more bug: the win-back and nudge queries could starve new leads/buyers behind rows that weren't due (`b9b38fd`). Dodo fixtures are still schema-built, not captured.

- **Where:** `package.json` scripts; no `.github/workflows`; no ESLint config (so `next lint` prompts interactively and `next build`'s "Linting" line does nothing); the `react-hooks/exhaustive-deps` disable comments are decorative.
- **Why it matters:** the webhook handler is the code that decides who has paid. It has zero automated tests, and the findings above (P0-1, P0-2, P1-3) are precisely the kind of state-machine bugs a table-driven test catches in minutes. A single GitHub Actions job running `npm ci && npm run typecheck && npm run build` + `deno check` + `deno test` on `supabase/functions` would also have flagged the deployment drift in P0-4.
- **Fix:** Add `deno test` cases for `verifySignature`, the event → status table, the first-activation logic (all six orderings of the first-purchase burst), refund/dispute resolution, the stale-subscription case, refund-then-re-purchase (expect access), `on_hold` → sweep → re-purchase → late `renewed` for the old subscription, a network error in the cancel call followed by a retry, a deleted auth user receiving `subscription.renewed`, and `subscription.active` with `next_billing_date` omitted. Add to the live §7 checklist: refund yourself, then buy again with the same email and confirm the row is `active`. Add a Vitest test for `paymentStateFrom`, `readMetaCookies`, and `captureAttribution`. Add ESLint (`eslint.config.mjs` with `eslint-config-next`) and a CI workflow.

---

## 3. P2 — Medium

### P2-1. API routes have no timeout budget; a slow Dodo call becomes a 504 and "Couldn't open checkout"

> **Status (2026-09-30):** ✅ **Done** (`66f32c8`) — 20 s upstream timeout → 504, `maxDuration = 30` on routes, 25 s client timeout on /offer.

- **Where:** `lib/proxy.ts:21–30` (plain `fetch`, no `AbortSignal`), `app/api/*/route.ts` (no `maxDuration`).
- **Fix:** `export const maxDuration = 30;` in each route and `signal: AbortSignal.timeout(20_000)` on the fetch, with a specific error message on timeout. Also add a client-side timeout on the `/offer` fetch so the button never stays busy on a hung request.

### P2-2. Lead and InitiateCheckout are browser-only; ad blockers and ITP erase them, and fbp/fbc are only captured at checkout

> **Status (2026-09-30):** 🟡 **Partly done** — InitiateCheckout now fires only after a successful create-checkout. ⬜ **Pending**: server-side CAPI Lead / InitiateCheckout.
>
> **Update (2026-10-05, branch `test/coverage`):** ✅ **Done** (`075cdad`) — capture-email sends a CAPI Lead (`lead-<sessionId>`) and create-checkout a CAPI InitiateCheckout per new checkout (`ic-<eventId>`); the browser pixel uses the same ids, so Meta dedups each pair. fbp/fbc now captured at /email. Tests E8, E8b, C9.
>
> **Update (2026-10-06, branch `feat/spec-21-handoff`):** Since 2026-10-06 the Lead id is `lead-<sha256(sessionId)>`, so the session id never reaches Meta (SPEC-21).

- **Where:** `app/email/page.tsx:63–64`, `app/offer/page.tsx:140–143`, `create-checkout/index.ts:119–128`.
- **Why:** Meta's own guidance is to send every funnel event through CAPI with `event_id` dedup, not only Purchase. Lead is the event you will optimise on in the first weeks while Purchase volume is thin, and it is currently the least reliable one.
- **Also:** `pixel('InitiateCheckout')` at `app/offer/page.tsx:140` fires *before* the create-checkout request, so it is counted even on a 409 or 5xx. Move it after a successful response and give it the returned `eventId`.
- **Fix:** Have `/api/capture-email` send `fbp` / `fbc` (from `readMetaCookies()`) and an `event_id`; store them on `funnel_sessions.capi` at email time; fire a CAPI `Lead` from the edge function with the same `event_id` the browser used. Same pattern for `InitiateCheckout` from `create-checkout` (it already generates `eventId` at line 88).

### P2-2b. The browser Purchase fires with no advanced matching, so the deduped event Meta keeps is the weaker twin

> **Status (2026-09-30):** ✅ **Done** (`40eaa96`) — advanced matching is awaited before the Purchase pixel on /welcome. (The 1.5 s timer in analytics-boot is still there — P3-5; removed 2026-10-05.)

- **Where:** `app/welcome/page.tsx:65–78` (Purchase fired synchronously in the mount effect), `app/analytics-boot.tsx:19–23` (`setPixelUserData` re-applied only after a 1500 ms timer).
- **Scenario:** `/welcome` is always a fresh document (the SDK navigates with `window.location.href`). The Purchase pixel fires before user data is attached, so the browser event carries only `_fbp` / `_fbc`, while the CAPI event carries `em`, `external_id`, `fbp`, `fbc`, IP and UA. Meta keeps whichever twin arrives first per `event_id`, normally the browser one → lower match quality on the event you optimise on.
- **Fix:** On `/welcome`, `await setPixelUserData(email, s.userId)` before `pixel('Purchase')` (both values are available before `resetSession()` at line 79). Remove the 1500 ms timer in `analytics-boot.tsx`: the inline snippet defines the `fbq` queue stub synchronously, and `next/script`'s `afterInteractive` inline script is injected in the `<Script>` component's own effect, which runs before page effects.

### P2-3. Deleting the account in the app cascades the entitlement but the Dodo subscription keeps billing, and every later webhook for that user fails silently

> **Status (2026-09-30):** 🟡 **Partly done** — webhook: an FK violation now cancels the Dodo subscription and alerts instead of retrying forever. ⬜ **Pending** (app repo `mamalearn`): account deletion must cancel an active Dodo subscription first. **Update 2026-10-05:** done in `mamalearn`'s `delete-account` on `feat/web-purchase-unlock` (not deployed) — see OPS_RUNBOOK §1b.

- **Where:** migration `20260918000000_web2app.sql:13` (`on delete cascade`), `dodo-webhook/index.ts:205–218` (upsert throws on FK violation `23503`), `dodo-webhook/index.ts:173–179`.
- **Scenario:** Web buyer deletes their account in the app (the privacy policy promises this; the App Store requires it). The `entitlements` row disappears; nothing cancels the Dodo subscription. At the next renewal Dodo charges the card and sends `subscription.renewed` with the deleted uuid in metadata. The upsert fails with `23503` → throw → idempotency row deleted → 500 → Dodo retries until its schedule is exhausted. There is no `alertOwner` on this path and no `unlinked_purchases` row. The customer is billed with no account until they chargeback. If they later sign up again with the same email, `capture-email` creates a new uuid, so the still-billing subscription never links to them.
- **Fix:** In the webhook, treat `23503` on the upsert as "user gone": `cancelDodoSubscription(data.subscription_id)` + `alertOwner`, then return 200. Cross-repo: the app's delete-account flow (or a trigger/edge function on `auth.users` delete) must cancel any active `dodo_subscription_id` first, or block deletion while a web subscription is active and point the user to `/manage`. Treat this as High for the app team.

### P2-3b. A transient error on the entitlement pre-read is treated as "no row", bypassing the revoked guard and re-firing first-activation side effects

> **Status (2026-09-30):** ✅ **Done** (`40eaa96`) — read errors throw so Dodo retries.

- **Where:** `dodo-webhook/index.ts:194–203` (`const { data: current } = …` discards `error`).
- **Scenario:** A PostgREST/network blip makes `current` undefined. For a replayed or late `subscription.renewed` on a **revoked** customer, the guard at line 201 does not trigger and the upsert restores `active` with a fresh period end — a refunded customer regains access. For a legitimate retry of `subscription.active`, `isFirstActivation` is true again → second handoff email and a second CAPI Purchase.
- **Fix:** Throw when the select returns an error, exactly as the upsert does at line 218, so Dodo retries.

### P2-3c. `on_hold` / `past_due` shorten access to "now" instead of preserving it, and the dup guard opens while Dodo is still retrying the card

> **Status (2026-09-30):** ✅ **Done** (`40eaa96`) — past_due/cancelled never move the period end earlier; past_due gets a 3-day floor. 👤 Confirm V5.

- **Where:** `dodo-webhook/index.ts:119–121` (comment promises access until period end), `dodo-webhook/index.ts:213` (`current_period_end` unconditionally overwritten), migration `:102–117` (sweep), `create-checkout/index.ts:71–78`.
- **Scenario:** A renewal fails. Dodo emits `subscription.on_hold` whose `next_billing_date` is the date it just tried to bill (now or slightly past) — it has no reason to advance it. The code writes that as `current_period_end`, so the app's `current_period_end > now()` rule denies access immediately, contradicting the comment on line 120 and `MANUAL_STEPS.md` §7. A day later the sweep sets `expired`; the dup guard is now open. If the customer re-runs the funnel during Dodo's multi-day smart-retry window and buys `sub_B`, and `sub_A`'s retry then succeeds, they hold two live subscriptions and P1-3's overwrite fight begins. Confirm the actual `next_billing_date` on an `on_hold` payload (see V5); the fix is correct either way.
- **Fix:** For degrading events (`past_due`, `on_hold`, `cancelled`) never move `current_period_end` earlier: write `greatest(existing, incoming)`, and for `on_hold` add a fixed grace (for example 3 days). In the dup guard, also refuse when the row is `past_due` / `on_hold`-derived or `expired` within the last few days and Dodo still reports the stored subscription as retrying (`GET /subscriptions/{id}`).

### P2-4. The win-back query can starve and can email people whose purchase is in flight

> **Status (2026-09-30):** ✅ **Done** (`40eaa96`) — oldest-first with a server-side age filter, batch of 50, batched opt-out/payer lookups, payers excluded, nudge aged from purchase.
>
> **Follow-up (2026-10-05, `b9b38fd`):** the fix was incomplete — rows already at stage 1 (and signed-in customers in the nudge ladder) still held the oldest-first batch while not due, so a backlog could still starve new leads. Caught by integration test S9; both queries now fetch only due rows and signed-in customers are closed off.

- **Where:** `winback-sweep/index.ts:44–52` (no `order`, `limit(200)`, no server-side age filter), lines 54–57 (age computed client-side).
- **Scenario:** Backlog of >200 eligible rows → Postgres returns an arbitrary 200 each hour → the same rows may be returned repeatedly and others never. Each row does 2–3 sequential round trips (opt-out check, `getUserById`, Resend) → a 200-row sweep may exceed the function's wall-clock limit and stop partway. Also: `purchased_at` is set only at first activation (see P0-2), so a buyer whose webhook is delayed a few minutes past the 1-hour mark receives "Your plan is ready".
- **Also (ladder 2):** `winback-sweep/index.ts:114` ages the "paid but never signed in" nudge from `user.created_at`, not from purchase. A lead who captured email four days ago and then buys gets `dueStage = 2` ("Don't leave your plan unused") on the very next hourly sweep — within an hour of the handoff email, before they could plausibly install the app. And ladder 1 is per-session: a user who converted on a second session (see P1-6) still has the first session's `purchased_at = null`, so they get "Still thinking it over? 14-day money-back guarantee" the day after paying.
- **Fix:** `.lt('created_at', new Date(Date.now() - HOUR).toISOString()).order('created_at').limit(50)`; exclude any session whose `user_id` has an `entitlements` row (not just `purchased_at`); batch the opt-out lookup with `.in('user_id', ids)`. For ladder 2, age from `activated_at` (P0-2) and start at stage 1.

### P2-5. Mid-funnel pages are indexable, and there is no Open Graph metadata for ad/link previews

> **Status (2026-09-30):** ✅ **Done** (`66f32c8`) — `X-Robots-Tag: noindex` on mid-funnel routes, `robots.txt`, `metadataBase` + OG/Twitter metadata. ⬜ **Pending**: a 1200×630 OG image. **Update (2026-10-05, branch `test/coverage`):** ✅ generated `app/opengraph-image.tsx` / `twitter-image.tsx`; card is `summary_large_image`.

- **Where:** `app/layout.tsx:20–25` (`robots: { index: true, follow: true }` globally), no `robots.txt`, no `sitemap`, no `openGraph` / `metadataBase`.
- **Scenario:** Google indexes `/offer`, `/welcome`, `/unsubscribe`, `/quiz/7`; an organic visitor lands on `/welcome` and sees "Get set up in two steps". Links shared in Messages/WhatsApp render with no image or title.
- **Fix:** `robots: { index: false }` in a `metadata` export on every route except `/`, `/start`, `/legal/*`; add `app/robots.ts`; add `metadataBase`, `openGraph` and `twitter` with a 1200×630 image.

### P2-6. No branded error or not-found pages

> **Status (2026-09-30):** ✅ **Done** (`66f32c8`) — branded `not-found`, `error`, `global-error`.

- **Where:** no `app/error.tsx`, `app/global-error.tsx`, or `app/not-found.tsx`.
- **Scenario:** Any client render error on `/offer` (for example, corrupt localStorage the `try/catch` does not cover, or a third-party script throwing) shows Next's default "Application error" screen with no way back. A mistyped ad URL shows the default 404.
- **Fix:** Add both, styled with `Shell`, each with a single "Start over" button to `/start` and a `track('web_funnel_error')` call.

### P2-7. Progress bar goes backwards after the plan reveal

> **Status (2026-09-30):** ✅ **Done** (`66f32c8`) — progress follows the real journey order. Tested.

- **Where:** `lib/quiz/questions.ts:283` (`JOURNEY_LENGTH = TOTAL_STEPS + 4`), `app/email/page.tsx:76` (`(TOTAL_STEPS + 1) / JOURNEY_LENGTH` ≈ 86%), `app/quiz/[step]/quiz-client.tsx:105` (step 14 → 14/21 ≈ 67%).
- **Fix:** Compute the fraction from position in the actual journey order (steps 1–13, email, building, plan, steps 14–17, offer).

### P2-7b. `/building` traps the back button and replays the 9 s build on every visit

> **Status (2026-09-30):** ✅ **Done** (`66f32c8`) — `router.replace` into and out of /building; skipped on revisit in the same tab.

- **Where:** `app/email/page.tsx:66` (`router.push('/building')`), `app/building/page.tsx:28` (`router.push('/plan')` after 9.5 s).
- **Scenario:** Back from `/plan` lands on `/building`, which restarts the 9 s theatre and pushes `/plan` again; each cycle adds two history entries, so one back press can never reach `/email` or the quiz.
- **Fix:** `router.replace` in both places; on `/building` mount, if the session already has `emailCaptured` and a `sessionStorage` "built" flag, go straight to `/plan`.

### P2-7c. Going back from Act 3 forces the user to re-type their email and re-watch the build

> **Status (2026-09-30):** ✅ **Done** (`66f32c8`) — /email redirects to /plan when already captured; step 13 routes to /plan.

- **Where:** `app/quiz/[step]/quiz-client.tsx:72–73` (back from step 14 → step 13), step 13's CTA → `/email`; `app/email/page.tsx:28,33–36` (email state starts empty; `emailCaptured` never checked).
- **Scenario:** A user who goes back one screen from "No 300-page books" is asked for their email again → second `capture-email` POST (new `funnel_sessions` upsert on the same id, second Lead pixel) → 9 s build again.
- **Fix:** On `/email` mount, if `s.emailCaptured` → `router.replace('/plan')`; on step 13, route `next` to `/plan` when the email is already captured.

### P2-7d. Enter key double-submits on `/email`

> **Status (2026-09-30):** ✅ **Done** (`66f32c8`) — re-entrancy guard + Enter gated on `busy`.

- **Where:** `app/email/page.tsx:95` (`onKeyDown` checks the regex but not `busy`), lines 38–40 (`submit` has no re-entrancy guard).
- **Scenario:** Two concurrent `capture-email` calls both miss the email lookup and both call `createUser`; the second fails → the page shows "Something went wrong" and re-enables the button while the first has already pushed `/building`; Lead fires twice.
- **Fix:** `if (busy) return;` at the top of `submit`, and gate the Enter handler on `!busy`.

### P2-8. `getSession()` mints a new id on every call when localStorage writes fail

> **Status (2026-09-30):** ✅ **Done** (`66f32c8`) — in-memory session fallback. Tested.

- **Where:** `lib/session.ts:37–57`.
- **Scenario:** Storage unavailable or full (some in-app browsers, Safari with site data blocked). `/email` posts `sessionId = A`; `/offer` posts `sessionId = B` → edge function returns `session_not_found` → "Couldn't open checkout" with no obvious cause.
- **Fix:** Keep a module-level in-memory session as the fallback so all reads in one page-load return the same object; surface a soft warning if storage is unavailable.

### P2-9. Legal copy drift and an incomplete auto-renewal acknowledgement

> **Status (2026-09-30):** 🟡 **Partly done** — Terms name `kinderwell.app/manage`; the welcome email restates plan, price and auto-renewal. 👤 Enable Dodo's renewal reminder (V8).

- **Where:** `app/legal/terms/page.tsx:22–25` says "cancel anytime from your account page — the link is in every receipt and renewal email" (the runbook says this was replaced by `/manage`; the Terms were not updated). `app/legal/refunds/page.tsx:24` promises "a reminder before annual renewals" that depends on a Dodo dashboard toggle not yet enabled. The handoff email (`dodo-webhook/index.ts:368–386`) — the post-purchase acknowledgement California's ARL expects — does not restate the price, the renewal interval, or that it auto-renews.
- **Fix:** Update the Terms to name `kinderwell.app/manage`; add one line to the handoff email: "Your plan: Annual, $59.99/year, renews automatically until cancelled at kinderwell.app/manage"; enable the Dodo renewal reminder before launch (or remove the promise).

### P2-10. The idempotency row is written before the work and can outlive a killed run, permanently dropping the event with a 200

> **Status (2026-09-30):** ✅ **Done** (`40eaa96`) — rows go `processing` → `done`; a stale `processing` row can be reclaimed after 2 min; a live one returns 500 so Dodo retries.

- **Where:** `dodo-webhook/index.ts:154–162` (insert first), `dodo-webhook/index.ts:173–179` (delete only in the `catch`).
- **Scenario A:** The isolate is terminated between the insert and the delete (Supabase wall-clock/CPU limit, OOM, eviction — the refund path makes two Dodo API calls plus Resend plus PostHog, and Dodo's own delivery timeout is short). The row stays. Dodo retries the same `webhook-id` → `23505` → `200 duplicate`. The entitlement was never written; the Dodo dashboard shows success; no alert.
- **Scenario B (concurrent):** Dodo times out attempt 1 while it is still running and sends attempt 2. Attempt 2 gets `duplicate` and Dodo marks the message delivered. Attempt 1 then throws, deletes the row, returns 500 — but nobody retries. Event lost.
- **Fix:** Insert the row with `status = 'processing'`, set `'done'` at the end. On `23505`, read the existing row: if it is `done`, return 200; if it is `processing` and older than ~2 minutes, re-run (side effects are already mostly idempotent, and fully so after P0-2), else return 500 so Dodo retries later. This also removes the need to delete the row in the `catch`.

### P2-11. The homepage is a server function on every hit only to check for ad params

> **Status (2026-09-30):** ✅ **Done** (`66f32c8`) — redirect lives in `next.config.mjs`; `/` is static.

- **Where:** `app/page.tsx:11–25` (`searchParams` makes `/` dynamic — the build shows `ƒ /`).
- **Fix:** Move the redirect to `next.config.mjs` `redirects()` with `has: [{ type: 'query', key: 'fbclid' }]` (one rule per param) so `/` is static and served from the edge cache. Low effort, better TTFB for organic and App Store "developer website" traffic.

### P2-12. Meta Limited Data Use is not set for California

> **Status (2026-09-30):** ✅ **Done** (`66f32c8`) — LDU on the pixel (`dataProcessingOptions`) and on CAPI.

- **Where:** `app/layout.tsx:50–52` (pixel init), `dodo-webhook/index.ts:416–446` (CAPI payload).
- **Why:** For a US launch that includes California, Meta's documented CCPA mechanism is `fbq('dataProcessingOptions', ['LDU'], 0, 0)` before `init`, and `data_processing_options: ['LDU'], data_processing_options_country: 0, data_processing_options_state: 0` on each CAPI event (0/0 lets Meta geolocate). Cheap to add now, awkward to explain later.

### P2-13. `/welcome` trusts an unauthenticated `status=active` query parameter

> **Status (2026-09-30):** ⬜ **Pending** — optional hardening, not done.
>
> **Decision (2026-10-05, branch `test/coverage`):** ➖ **Accepted, not changed** (owner to confirm). The browser Purchase only fires when this tab created a checkout (`kw_purchase_event_id`), once, and deduplicates against the server's CAPI Purchase, which is the authoritative copy (fired only for a real Dodo activation). A fake `status=active` therefore needs someone to open checkout and then edit the URL — at worst one stray browser event. Verifying it would mean a seventh edge function calling Dodo on the thank-you page. Revisit if Events Manager ever shows browser-only Purchases.

- **Where:** `app/welcome/page.tsx:49–79`.
- **Scenario:** Anyone can open `/welcome?status=active&email=x` and see "Payment confirmed". Only a browser that also holds a `kw_purchase_event_id` fires a Purchase pixel, so attribution pollution is limited, but the confirmation UI is spoofable and a user whose payment is actually `processing` could be told it is confirmed if they tamper with the URL or a helper does.
- **Fix:** Optional hardening: have `/welcome` call a small `GET /api/purchase-status?sid=<subscription_id>` that checks `entitlements` and only then show "Payment confirmed". Not blocking for launch.

### P2-15. The proxy secret is fail-open whenever `DODO_ENV` is not exactly `live`

> **Status (2026-09-30):** ✅ **Done** (`66f32c8`) — fails closed unless `ALLOW_UNAUTHENTICATED_FUNNEL=1`; `import 'server-only'` in `lib/proxy.ts`.

- **Where:** `supabase/functions/_shared/email.ts:23–31`; `DODO_ENV` defaults to `test` in `create-checkout/index.ts:24` and `dodo-webhook/index.ts:33`.
- **Scenario:** A prod Supabase project where `DODO_ENV` is forgotten, mistyped, or set in Vercel but not in Supabase runs with the functions callable by anyone holding the public anon key (it is in the JS bundle), bypassing the Vercel rate limit entirely. Today's production site points at the dev project where the secret is not set, so this is the live state.
- **Fix:** Fail closed: if `FUNNEL_PROXY_SECRET` is unset, return 403 and log, with an explicit `ALLOW_UNAUTHENTICATED_FUNNEL=1` opt-in for local dev. Add `import 'server-only'` at the top of `lib/proxy.ts` so the secret can never be pulled into a client bundle by a future import.

### P2-16. `capture-email` returns the real Supabase user id to an unauthenticated caller

> **Status (2026-09-30):** ⬜ **Pending** — capture-email still returns the user id.
>
> **Decision (2026-10-05, branch `test/coverage`):** ➖ **Accepted, not changed** (owner to confirm). The suggested fix (an opaque `analytics_id`) breaks the design goal that the web funnel and the iOS app share ONE PostHog person keyed by the Supabase user id; PostHog's `identified_only` profiles also need the browser to identify. The concrete harm named here — forging unsubscribe links for named users if SWEEP_SECRET leaks — is closed by P3-1: `UNSUBSCRIBE_SECRET` is now required, with no SWEEP_SECRET fallback.

- **Where:** `capture-email/index.ts:69–76,106`.
- **Why:** The uuid is the PostHog `distinct_id`, the pre-image of the Meta `external_id`, and the `u` in unsubscribe links. Anyone can map an email (including an existing app user's) to those identifiers. Low exploitability on its own; it becomes useful if `SWEEP_SECRET` ever leaks (P3-1) because unsubscribe tokens can then be forged for named victims.
- **Fix:** The browser only needs the id for `identify()`. Return an opaque server-issued `analytics_id` instead (a column on `funnel_sessions` or `auth.users` metadata) and resolve `user_id` server-side from the session.

### P2-17. Retried older events can resurrect an `expired` / `cancelled` row

> **Status (2026-09-30):** 🟡 **Partly done** — stale events for a *different* subscription are ignored (P1-3). ⬜ **Pending**: a stale event for the *same* subscription after expiry (needs event-timestamp ordering).
>
> **Update (2026-10-05, branch `test/coverage`):** ✅ **Done** (`273e4d2`) — Dodo's envelope timestamp of the newest applied event is stored in `entitlements.last_event_at` (migration `…1005_event_ordering`); older events for the same subscription are ignored. Tests: unit + W24.

- **Where:** `dodo-webhook/index.ts:182–218` (status written purely from event type; only `revoked` is protected).
- **Scenario:** A `subscription.renewed` that first failed with 500 (row deleted at line 177) is retried by Dodo hours later, after a `subscription.expired` or `cancelled` has already landed → the row flips back to `active` with a stale `next_billing_date`. Overlaps with P1-3; the fix there (subscription-id check) plus storing the payload's timestamp and ignoring events older than `updated_at` closes both.

### P2-14. Checkout SDK is fetched on the first tap

> **Status (2026-09-30):** ✅ **Done** (`40eaa96`) — SDK preloaded on /offer mount.

- **Where:** `lib/checkout.ts:32` (`await import('dodopayments-checkout')` inside the click handler).
- **Scenario:** On a slow mobile connection the first "Get my plan" tap waits for a JS chunk plus the create-checkout round trip; users tap again or leave.
- **Fix:** Preload with `void import('dodopayments-checkout')` in the offer page's mount effect and call `DodoPayments.Initialize` early so only the session creation remains on the click path.

---

## 4. P3 — Low / hygiene

1. **`SWEEP_SECRET` travels in a GET query string** (`winback-sweep/index.ts:32`, `MANUAL_STEPS.md` §2.5) and is stored in plaintext in `cron.job.command`, `net.http_request_queue`, and the edge-gateway request logs. It is also the fallback HMAC key for unsubscribe tokens (`_shared/email.ts:46`), so one leak both lets an attacker trigger mass email on demand and forge opt-outs. The compare at line 33 is `!==`, not the repo's `timingSafeEqual`. Use `net.http_post` with a header (read the secret from Supabase Vault inside the cron SQL), make `UNSUBSCRIBE_SECRET` required, and use the constant-time helper. **Status:** 🟡 **Partly done** — header `x-sweep-key` accepted and constant-time compare; `?key=` still works. 👤 Move the cron to the header / Vault. ⬜ **Pending**: make `UNSUBSCRIBE_SECRET` required. **Update 2026-10-05:** ✅ required, no fallback; without it the sweep skips only marketing mail and resume/unsubscribe answer 503 (tests S11, R5/U3).
2. **Node version not pinned.** No `engines` field or `.nvmrc`; the README says `nvm use 20`. Add `"engines": { "node": ">=20 <23" }` and `.nvmrc` so Vercel and contributors agree. **Status:** ✅ **Done** — `engines` + `.nvmrc`.
3. **Quiz single-select steps do not show the previously chosen answer when the user goes back** (`quiz-client.tsx:173–177` passes `selected={undefined}` for single mode). Read `s.answers[step.id]` and highlight it. **Status:** ✅ **Done**.
4. **`/building` is a fixed 9 seconds** (`app/building/page.tsx:13`). Industry funnels use 4–6 s; consider shortening or allowing a tap to skip after the stages complete. Subjective; measure drop-off on this screen in PostHog first. **Status:** ⬜ **Pending** — measure drop-off first.
5. **`setPixelUserData` is delayed by a 1.5 s timer** in `app/analytics-boot.tsx:21`. `window.fbq` exists synchronously after the inline snippet (it is a queue), so the timer is unnecessary; call it directly. **Status:** ✅ **Done 2026-10-05** — `whenPixelReady` runs it as soon as `fbq` exists (the snippet is afterInteractive, so a direct call could miss it). Tested.
6. **No Content-Security-Policy** (acknowledged in `next.config.mjs:7–10`). Add a `Content-Security-Policy-Report-Only` header now so you have the allowlist ready before enforcing it. **Status:** ✅ **Done 2026-10-05** — report-only CSP on every page; reports to `/api/csp-report` → Vercel logs `[csp-report]`. 👤 Enforce after a few weeks with no own-page violations.
7. **Duplicate-purchase guard is Dodo-only by design**, so an active Apple IAP subscriber can also buy on the web. This is an app-side/product decision, but the offer page could at least say "Already subscribed in the app? You don't need this." **Status:** ⬜ **Pending** — product decision.
8. **`npm audit`:** one high/one moderate advisory in `postcss` bundled inside `next` (build-time CSS processing; not reachable from user input in this app). Track Next releases; no action now. **Status:** ➖ **No change needed**.
9. **Multiple-lockfile warning in `next build`** because `/Users/mandeep/package-lock.json` exists on the dev machine. Set `outputFileTracingRoot: __dirname` in `next.config.mjs` or delete the stray lockfile. **Status:** ✅ **Done** — `outputFileTracingRoot`.
10. **`waitlist` upsert stores full quiz answers keyed by email** for people who are not customers (`capture-email/index.ts:55–63`). Consider storing only `reason` and `child-age`, and a retention window. **Status:** ✅ **Done** — waitlist keeps reason + child age only.
11. **Handoff email link to `/manage` uses `siteUrl` from the `SITE_URL` secret with no trailing-slash guard;** a value like `https://kinderwell.app/` produces `//manage`. Normalise with `.replace(/\/$/, '')`. **Status:** ✅ **Done**.
12. **X-Frame-Options: DENY plus the Dodo overlay:** fine (the overlay is Dodo inside your page, not the reverse). The SDK sets `allow="payment keyboard-map *"` on its iframe, so `Permissions-Policy` as written is compatible. No change; noted so nobody "fixes" it. **Status:** ➖ **No change needed**.
13. **`Strict-Transport-Security` lacks `preload`.** `.app` is HSTS-preloaded at the TLD level, so this is cosmetic. **Status:** ➖ **No change needed**.
14. **The pixel `PageView` effect fires twice per navigation in dev** (React Strict Mode). Production is unaffected. **Status:** ➖ **No change needed** (dev only).
15. **`dispute.cancelled` and `dispute.expired` produce no alert** (`dodo-webhook/index.ts:239–251`). `dispute.opened` revoked access and cancelled the subscription (irreversible on Dodo's side); a customer who withdraws the dispute ends up with no access, no subscription, no follow-up, and (until P0-1 is fixed) cannot re-buy. Alert on both, like `dispute.won`. **Status:** ✅ **Done** — alerts on `dispute.cancelled`/`expired`. Tested.
16. **The 409 from `create-checkout` reveals whether an email has an active paid subscription** to anyone who types it on `/email` (`app/offer/page.tsx:149–157`). Low risk for this product; note it and keep the message generic. **Status:** ⬜ **Pending** — kept the helpful message (decision).
17. **`waitlist` rows are overwritable by anyone** (`capture-email/index.ts:55–63` upserts on the `email` primary key with caller-controlled `reason` / `answers`). Use `insert` with `ignoreDuplicates`. **Status:** ✅ **Done** — insert-only (`ignoreDuplicates`).
18. **IP and user agent are retained indefinitely** in `funnel_sessions.capi` (`capture-email/index.ts:98`, `create-checkout/index.ts:120–128`), and `funnel_sessions.user_id` is `on delete set null`, so deleting a user keeps their quiz answers and IP. Add a retention sweep (drop `capi` after 30 days, delete orphaned sessions after 90) and say so in the privacy policy. **Status:** ✅ **Done 2026-10-05** — the sweep clears `capi` after 30 days and deletes unlinked sessions after 90; privacy policy says so. Test S12.
19. **`answers` / `utm` are stored unvalidated** (`capture-email/index.ts:48–51,96`) although the migration comment says "enum answers only". Validate against `lib/quiz/questions.ts` option values and cap `utm` value length. **Status:** ✅ **Done** — shape/length validation (generic, not per-option).
20. **`poweredByHeader` is not disabled** in `next.config.mjs`; add `poweredByHeader: false`. **Status:** ✅ **Done**.
21. **Webhook secret is tried in two encodings** (`dodo-webhook/index.ts:74–81`). Not forgeable (both derive from the same secret), but once you know which format Dodo issues, drop the fallback. **Status:** ⬜ **Pending** — needs Dodo's secret format confirmed.
22. **A later visit carrying only `?a=` or `utm_*` erases the stored `fbclid`** (`lib/session.ts:75–84` replaces the whole `utm` object). If the `_fbc` cookie has since expired (Safari caps JS-set cookies at 7 days), `readMetaCookies()` can no longer rebuild it. Merge: only replace `fbclid` / `fbclidAt` when a new `fbclid` is present. **Status:** ✅ **Done**. Tested.
23. **The `reason=age` waitlist branch is dead.** No option in `lib/quiz/questions.ts:117–129` sets `disqualifies: 'age'`, so `app/waitlist/page.tsx:20–23` is unreachable and no age is gated, although the README and runbook say out-of-range ages are. Either gate `0–1` / `13–17` (if the lessons do not serve them) or remove the claim; selling to a parent of a 16-year-old whom the content does not serve is a refund. **Status:** ⬜ **Pending** — **owner decision: should ages 0–1 / 13–17 be turned away?**
24. **`checkout.error` resets `busy` but leaves the overlay open, and the user's subsequent manual close is counted as an abandonment** (`lib/checkout.ts:47–57`). Call `DodoPayments.Checkout.close(false)` on error and suppress the abandoned event for that close. **Status:** ✅ **Done**.
25. **Quiz back navigation uses `router.push`** (`quiz-client.tsx:72–73`), growing history on every back tap; prefer `router.back()` when there is history. **Status:** ✅ **Done 2026-10-05** — `router.back()` when the previous entry is the previous question (tracked per tab); test B1c.
26. **`/welcome` assumes iPhone during SSR** (`app/welcome/page.tsx:44` `useState(true)`), so desktop shows the App Store button for a frame before the QR. Cosmetic. **Status:** ✅ **Done 2026-10-05** — device is unknown (null) until the browser reports it; a same-height placeholder renders meanwhile.
27. **Refund fallback by `dodo_customer_id`** (`dodo-webhook/index.ts:273`) revokes whichever row carries that customer id when the payment lookup 404s (for example a test/live key mismatch). Combined with P1-2 (email edited at checkout) it can revoke a different account than the one refunded. Prefer parking as unlinked over guessing. **Status:** ✅ **Done** — no fallback by customer id; parks as unlinked instead.

---

## 5. Things the code cannot prove — verify in dashboards before launch

| # | What to verify | Why | Status |
|---|---|---|---|
| V1 | Run one test purchase and watch the four webhook deliveries' order in Dodo → Webhooks → Message attempts, three times. | Confirms P0-2 is reachable in your account and validates the fix. | 👤 Pending |
| V2 | In Dodo test mode, open `https://test.customer.dodopayments.com/login/<business_id>` and confirm Cancel works. | P1-1. | 👤 Pending |
| V3 | Full funnel from an Instagram ad preview on an iPhone with a card in Wallet, in the in-app browser AND in Safari. | P1-5, P1-6; also confirms localStorage/cookies behave in the in-app browser. | 👤 Pending |
| V4 | Events Manager → Test events: after `/email`, confirm the Lead shows matched `em` and `external_id`, and that the browser event's `external_id` equals the CAPI one. | The advanced-matching re-`init` in `lib/meta.ts:53–63` is a documented pattern but Meta's docs do not promise it. `external_id` is sent to the pixel **pre-hashed**; if `fbevents.js` re-hashes it, the two sides diverge and the match is lost — if so, pass the raw user id and let the pixel hash. | 👤 Pending |
| V5 | After a `subscription.on_hold`, inspect the payload's `next_billing_date`. | If Dodo advances it before the retry, `past_due` customers keep access for a full extra period. | 👤 Pending |
| V6 | Refund a live purchase and confirm `revoked` + Dodo subscription `cancelled` (test mode cannot refund). | Runbook already flags this; it has never run. | 👤 Pending |
| V7 | Confirm the Dodo return URL includes `email` for subscriptions in your account. | `/welcome` relies on it after P1-2's fix only as a fallback, but check anyway. | 👤 Pending |
| V8 | Enable Dodo's "Upcoming renewal reminder" email. | The refund policy promises it. | 👤 Pending |

---

## 6. What is good (keep it)

- Standard Webhooks signature verification with timestamp window, timing-safe compare, and tolerant secret decoding.
- Idempotency table with first-insert-wins; verified replay behaviour in the runbook.
- User resolution by metadata, never by email string matching; `unlinked_purchases` as an alarm with owner email.
- Refund/dispute path cancels the Dodo subscription so nobody is re-billed for revoked access.
- Proxy-secret design so the public anon key alone cannot reach the functions; hard-required in live mode.
- HTML escaping in every email; RFC 8058 one-click unsubscribe; RLS on every table; security-definer RPCs with empty `search_path` and revoked public grants.
- Meta: `autoConfig` off, `event_id` dedup threaded through Dodo metadata, `fbc` rebuilt in the documented `fb.1.<ms>.<fbclid>` format, hashed `external_id` consistent on both sides, Purchase only on `status=active|succeeded`.
- The documentation. `OPS_RUNBOOK.md` and `MANUAL_STEPS.md` are better than most funded teams' runbooks; keep them current after the fixes above.

---

## 7. Suggested fix order and effort

| Order | Item | Effort |
|---|---|---|
| 1 | P0-1 subscription-aware revoked guard | 30 min |
| 2 | P0-2 `activated_at` column + conditional update | 1–2 h incl. migration |
| 3 | P0-3 derive overlay mode from URL | 15 min |
| 4 | P1-2 lock checkout email + handoff to auth email + welcome fallback | 45 min |
| 5 | P1-3 / P1-3b / P1-3c stale-subscription guard, double-purchase window, cancel-call try/catch + `cancel_pending` | 2 h |
| 6 | P1-4 `current_period_end` fallback + alert | 30 min |
| 7 | P1-1 portal URL | 10 min + dashboard |
| 8 | P1-9 PostHog autocapture off; P1-9b clean the `/welcome` URL server-side | 45 min |
| 9 | P1-10 / P1-10b overlay `onClose` ref, `link_expired`, `pageshow` reset | 40 min |
| 9b | P1-13 server-render `/start` | 30 min |
| 10 | P1-7 Vercel WAF rule + in-code limiter + ladder gating | 2 h |
| 11 | P1-8 sweep grace + reconcile + alert | 1 h |
| 12 | P1-12 tests + CI | half a day |
| 13 | P0-4 migration + deploy + full §7 checklist in test, then live | 2–3 h |
| 14 | P1-5 / P1-6 in-app browser test + resume token | half a day |
| 15 | P1-11, P2-* | as time allows |

---

## 8. Ops / state drift called out in the docs (not code, but launch-blocking)

From `OPS_RUNBOOK.md` and `MANUAL_STEPS.md`, unchecked as of 2026-09-30:

- Migration `…0928_email_opt_outs` not applied; five functions not redeployed (P0-4).
- `FUNNEL_PROXY_SECRET`, `MAILING_ADDRESS` not set (live mode refuses requests / marketing mail without them — good, but it means a go-live with them missing looks like "checkout broken").
- Meta pixel/CAPI not created; `NEXT_PUBLIC_META_PIXEL_ID` and `META_CAPI_TOKEN` unset.
- `NEXT_PUBLIC_DEV_SKIP` still to be deleted from Vercel before spend.
- Vercel rate-limit rule not created (P1-7).
- Dodo live products, live key, live webhook endpoint not created; "test IDs in live" is the documented #1 footgun.
- iOS app Phase 0 (OTP sign-in + entitlement gate) not shipped — the docs are right that no ad should run before it.
- Proof stats ("83% of parents", "two weeks", "12 lessons") and the four testimonials still need substantiation or softening (FTC + Meta policy).

---

## 9. Global-launch concerns (for later versions; not blocking a US + iPhone launch)

1. **Consent management (EU/UK/CH, and increasingly some US states).** The pixel and PostHog load before any consent. You will need a CMP, Meta consent mode (`fbq('consent', 'revoke')` until opt-in, then `grant`), PostHog `opt_out_capturing_by_default: true` with opt-in, and cookie-less server-side events only until consent. Plan the analytics boot so it can be gated without a rewrite: keep everything behind `initAnalytics()` (already true) and add a consent check there.
2. **Currency and price display.** `USD` and `$` are hard-coded in `lib/config.ts`, `app/offer/page.tsx`, and the CAPI payload. Dodo can localise currency; the offer page, FAQ, renewal disclosure, and CAPI `value` / `currency` must all come from the same source (see P1-11). EU price display must include VAT ("incl. VAT"); Dodo as merchant of record handles remittance but you own what the page says.
3. **Withdrawal / cooling-off rights.** EU (Consumer Rights Directive) and UK give a 14-day right to cancel digital services; you can ask the customer to waive it for immediate access at checkout, which needs explicit wording at the point of purchase. Your 14-day money-back promise already exceeds this in practice.
4. **UK DMCC Act 2024 subscription rules (in force through 2026).** Pre-contract information, renewal reminder notices, and an easy cancellation route are statutory; the Dodo reminder toggle and `/manage` cover the mechanics if they are enabled and working.
5. **App Store URL locale.** `https://apps.apple.com/us/app/kinderwell/id6758403231` is US-specific. If the app is not released in a country, the store shows "not available in your country". Use `https://apps.apple.com/app/id6758403231` (no storefront) or detect locale; and confirm the app's availability list.
6. **Apple Pay availability** varies by country and issuing bank; the card path (P1-5) matters even more.
7. **Android.** The waitlist exists; `google_pay` in `allowed_payment_method_types` is currently moot. When Android ships, the phone qualifier and the handoff copy ("Sign in / Get started" button names) need a second branch.
8. **Data residency and transfers.** Supabase region, PostHog US host, Resend `us-east-1`, Meta — all US processing. EU users need a DPA/SCCs from each vendor and a privacy-policy transfer section; consider PostHog EU host and Resend EU region for an EU launch.
9. **Marketing email lawful basis.** The win-back ladder is fine under CAN-SPAM; under GDPR/PECR it relies on "soft opt-in" (the address was collected in the course of a sale negotiation), which requires an opt-out offered at the point of collection. The "No spam, ever. Unsubscribe in one tap" microline is close but should be an explicit checkbox or statement for EU traffic.
10. **CCPA/CPRA at scale.** Today you are almost certainly below the thresholds. Once you cross them (or sell/share data of 100k+ consumers), sharing hashed email with Meta for ads is a "share" and needs a "Do Not Sell or Share My Personal Information" link and an opt-out, plus the LDU flag (P2-12).
11. **Localisation readiness.** Quiz copy lives in data (`lib/quiz/questions.ts`) — good. Emails, legal pages, and the offer/welcome copy are inline JSX; extract them before adding a second language.
12. **Meta account structure.** The individual → company transfer plan in `OPS_RUNBOOK.md` §6 is sound; adding EU ad accounts later means separate legal entities on the Business Manager and EU-specific data-use restrictions in Events Manager.
