# kinderwell-web

The Kinderwell web2app funnel: Meta ad → quiz → plan → Dodo Payments checkout
→ App Store handoff. Specs live one level up in `~/kinderwell-web2app/`.

**Two docs, different jobs — read both:**
- **`MANUAL_STEPS.md`** — the PLAN. Every key, dashboard step, and the
  end-to-end test checklist, in order. Start here when setting something up.
- **`OPS_RUNBOOK.md`** — the STATE. What is actually deployed right now, where
  every value lives, what was changed and why, and how to debug it at 2am.
  Start here when something breaks or before touching prod.
  **Keep it updated whenever external state changes.**

## Stack

Next.js (App Router) + TypeScript + Tailwind on Vercel. Supabase edge
functions (in `supabase/functions/`) own every secret-bearing call — the
Next.js runtime holds only public keys. The SQL migration's canonical home is
the app repo's `supabase/migrations/` (copy it there; apply with the app's
dev/prod discipline).

## Run locally

```bash
nvm use 20
cp .env.example .env.local   # fill in dev Supabase values at minimum
npm install
npm run dev                  # http://localhost:3000
```

`npm run typecheck` and `npm run build` must pass before deploying.

## Tests

| Command | What | Needs |
|---|---|---|
| `npm test` | Vitest (site: proxy, API routes, resume links, quiz data, plan copy, /offer) + Deno unit tests (state machine, signatures, tokens) | nothing |
| `npm run test:e2e` | Playwright on a production build, iPhone WebKit: HTTP checks, the funnel, the purchase page | `npm run build`, `npx playwright install webkit` once |
| `npm run test:db` | pgTAP: RLS on every table, function grants, cascades, expiry grace, rate limits | local Supabase (`supabase start`, Docker) |
| `npm run test:integration` | Every edge function end to end against a real database, Dodo/Resend/Meta/PostHog faked and recorded | local Supabase, plus `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` from `supabase status -o env` |

CI runs all four on every push to `main` and every pull request (jobs
`site`, `functions`, `backend`, `e2e`); the webhook and checkout handlers
must keep ≥ 80% line coverage. Without Docker locally, the database and
integration tests simply run in CI. A weekly workflow runs the funnel against
a Vercel preview with the real test-mode backend once configured
(`.github/workflows/weekly-preview.yml`).

Test harness: `supabase/functions/_testing/` (it refuses anything but a local
Supabase and replaces every secret with a fake). Dodo payloads:
`supabase/functions/_fixtures/dodo/` — **built from Dodo's schema, not yet
captured; see its README to swap in real ones.**

**Deploy edge functions with `scripts/deploy-functions.sh`**, which refuses
uncommitted code, an unpushed commit, or a commit whose CI isn't fully green.

## Map

| Path | What |
|---|---|
| `app/page.tsx` + `landing-client.tsx` | Landing, message-match variants via `?a=` |
| `app/quiz/[step]/` | Quiz engine; content lives in `lib/quiz/questions.ts` (copy edits are data edits) |
| `app/email` → `building` → `plan` → `offer` → `welcome` | The funnel spine |
| `app/k/[key]` + `app/.well-known/apple-app-site-association` | SPEC-21 sign-in links on `open.kinderwell.app`: the page a link opens without the app (no analytics, by design), and Apple's file that lets the app claim `/k/*`. Browser side: `lib/handoff.ts` |
| `app/waitlist` | Soft exit for Android / out-of-range ages |
| `app/api/*` | Thin proxies to edge functions (attach IP/UA for Meta CAPI) |
| `lib/session.ts` | localStorage session + first-touch attribution |
| `lib/analytics.ts` / `lib/meta.ts` | Typed PostHog registry / Meta Pixel wrapper |
| `supabase/functions/` | capture-email, create-checkout, dodo-webhook (single writer of entitlements), winback-sweep, resume, unsubscribe, mint-handoff (the welcome page's one-time app sign-in link, SPEC-21). Each `index.ts` only serves its `handler.ts`, which the integration tests call directly |
| `supabase/functions/_integration/`, `_testing/`, `_fixtures/` | Integration tests, their harness, Dodo payload fixtures (never deployed: `_` folders aren't functions) |
| `supabase/tests/database/` | pgTAP database tests |
| `e2e/` | Playwright browser tests |
| `app/legal/*` | Privacy / terms / refunds — TEMPLATES, fill brackets before launch |

## House rules inherited from the app repo (`~/mamalearn/docs/INVARIANTS.md`)

- No PII to PostHog — identify by Supabase user ID only; email never leaves
  our systems except hashed to Meta CAPI (disclosed in the privacy policy).
- Dev Supabase + Dodo test mode everywhere except the Vercel Production env.
- `entitlements` is written ONLY by the dodo-webhook function; an error from
  any entitlement check is never treated as entitled.
- A handoff key (SPEC-21) is a login credential: stored only as its sha256,
  never logged, never in an analytics event, and never in the URL of a page
  that loads analytics (the link page is a bare route handler for that
  reason). App INVARIANTS #29.
