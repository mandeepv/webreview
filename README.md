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

## Map

| Path | What |
|---|---|
| `app/page.tsx` + `landing-client.tsx` | Landing, message-match variants via `?a=` |
| `app/quiz/[step]/` | Quiz engine; content lives in `lib/quiz/questions.ts` (copy edits are data edits) |
| `app/email` → `building` → `plan` → `offer` → `welcome` | The funnel spine |
| `app/waitlist` | Soft exit for Android / out-of-range ages |
| `app/api/*` | Thin proxies to edge functions (attach IP/UA for Meta CAPI) |
| `lib/session.ts` | localStorage session + first-touch attribution |
| `lib/analytics.ts` / `lib/meta.ts` | Typed PostHog registry / Meta Pixel wrapper |
| `supabase/functions/` | capture-email, create-checkout, dodo-webhook (single writer of entitlements), winback-sweep |
| `app/legal/*` | Privacy / terms / refunds — TEMPLATES, fill brackets before launch |

## House rules inherited from the app repo (`~/mamalearn/docs/INVARIANTS.md`)

- No PII to PostHog — identify by Supabase user ID only; email never leaves
  our systems except hashed to Meta CAPI (disclosed in the privacy policy).
- Dev Supabase + Dodo test mode everywhere except the Vercel Production env.
- `entitlements` is written ONLY by the dodo-webhook function; an error from
  any entitlement check is never treated as entitled.
