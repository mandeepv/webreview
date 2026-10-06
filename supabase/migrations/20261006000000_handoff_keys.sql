-- SPEC-21 purchase handoff: a kinderwell.app buyer opens the app already
-- signed in. The website mints a one-time key; the app's redeem-handoff edge
-- function swaps it for a sign-in.
--
-- AUTHORED IN THE APP REPO (unlike the earlier web migrations): copy it into
-- kinderwell-web's supabase/migrations/ unchanged, so
-- scripts/check-migration-parity.sh stays green. Dev first, prod only via
-- scripts/db-push-prod.sh. ORDER: apply this BEFORE deploying redeem-handoff
-- (and, on the website, mint-handoff / the webhook change), which read and
-- write these columns.
--
-- A handoff key is a LOGIN CREDENTIAL (INVARIANTS #29): whoever holds it gets
-- a session for its user. So the key itself is never stored, only its sha256
-- (lowercase hex of the UTF-8 key string), and the table is reachable only
-- with the service role.

create table if not exists public.handoff_keys (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Where the key was handed out: the welcome page (clipboard / button / QR)
  -- or the confirmation email.
  source text not null check (source in ('welcome', 'email')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  -- Set by the one redeem that wins (redeem-handoff's conditional UPDATE).
  -- A key with used_at set can never sign anyone in again.
  used_at timestamptz,
  -- "7 days at most" is a rule, not a default: a minting bug that wrote a
  -- year-long credential fails here instead of shipping.
  constraint handoff_keys_lifetime check (expires_at <= created_at + interval '7 days')
);

alter table public.handoff_keys enable row level security;
-- No policies: service role only. Revoked as well, so a policy added by
-- mistake later still can't hand the browser or the app a credential.
revoke all on public.handoff_keys from anon, authenticated;

-- Deleting an account cascades its keys away; this keeps that delete cheap.
create index if not exists handoff_keys_user_id_idx on public.handoff_keys (user_id);

-- What proves the welcome page is the buyer's own browser (SPEC-21 §4.2).
-- The funnel's sessionId is not enough on its own: it travels to Meta inside
-- the CAPI event_id. So create-checkout also stores the sha256 of a
-- browser-only nonce, which never leaves the browser except to our own
-- functions. funnel_sessions already has RLS on and no policies, so this
-- column is service-role only like the rest of the row.
alter table public.funnel_sessions
  add column if not exists handoff_nonce_hash text;
