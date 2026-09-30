-- Web2App funnel schema. Canonical home for this migration is the APP repo's
-- supabase/migrations/ (copy it there and apply with the existing dev/prod
-- discipline: dev first, prod only via scripts/db-push-prod.sh).
--
-- Design rules (see ~/kinderwell-web2app/02-payments-entitlements.md):
--   * entitlements rows are written ONLY by the dodo-webhook edge function
--     (service_role). The app reads its own row. Apple/StoreKit state is
--     NEVER mirrored here — the check constraint enforces source='dodo'.
--   * The app treats status IN ('active','past_due','cancelled') AND
--     current_period_end > now() as entitled; everything else is not.

create table if not exists public.entitlements (
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('dodo')),
  status text not null check (status in ('active','past_due','cancelled','expired','revoked')),
  product_id text not null,
  dodo_customer_id text,
  dodo_subscription_id text unique,
  current_period_end timestamptz,
  nudge_stage int not null default 0,      -- "paid but never signed into app" email ladder
  updated_at timestamptz not null default now(),
  primary key (user_id, source)
);

alter table public.entitlements enable row level security;

drop policy if exists "own entitlement readable" on public.entitlements;
create policy "own entitlement readable"
  on public.entitlements for select
  using (auth.uid() = user_id);
-- No insert/update/delete policies: service_role only.

-- Quiz answers + attribution. Written only by edge functions (service_role);
-- the browser never touches this table directly.
create table if not exists public.funnel_sessions (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete set null,
  answers jsonb not null default '{}'::jsonb,   -- enum answers only, no free text by design
  utm jsonb,
  capi jsonb,                                    -- fbp/fbc/ip/ua/event_id for Meta CAPI at purchase
  landing_variant text,
  winback_stage int not null default 0,          -- abandoned-after-email ladder position
  purchased_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.funnel_sessions enable row level security;
-- No policies at all: service_role only.

create index if not exists funnel_sessions_winback_idx
  on public.funnel_sessions (winback_stage, created_at)
  where purchased_at is null and user_id is not null;

-- Webhook idempotency: Dodo retries deliveries; a replayed "renewed" event
-- must not resurrect a revoked entitlement. First insert wins.
create table if not exists public.webhook_events (
  id text primary key,                           -- webhook-id header
  event_type text,
  received_at timestamptz not null default now()
);
alter table public.webhook_events enable row level security;

-- Purchases the webhook could not attach to a user (missing/invalid metadata).
-- Anything landing here is a paying customer without access: alarm, not log.
create table if not exists public.unlinked_purchases (
  id bigint generated always as identity primary key,
  dodo_subscription_id text,
  payload jsonb not null,
  reason text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.unlinked_purchases enable row level security;

-- Android / out-of-age-range waitlist. Deliberately NOT auth users.
create table if not exists public.waitlist (
  email text primary key,
  reason text,
  answers jsonb,
  created_at timestamptz not null default now()
);
alter table public.waitlist enable row level security;

-- Email → user id lookup for capture-email. GoTrue's admin API has no clean
-- email filter across versions; a security-definer RPC against auth.users is
-- the reliable path. Callable only by service_role.
create or replace function public.get_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke all on function public.get_user_id_by_email(text) from public, anon, authenticated;

-- Daily expiry sweep: statuses don't flip themselves at period end, and we
-- never rely on a webhook arriving to end access. Schedule via pg_cron
-- (MANUAL_STEPS.md §2.4) or run from the winback-sweep function.
create or replace function public.expire_stale_entitlements()
returns int
language sql
security definer
set search_path = ''
as $$
  with flipped as (
    update public.entitlements
    set status = 'expired', updated_at = now()
    where status in ('active','past_due','cancelled')
      and current_period_end is not null
      and current_period_end < now() - interval '1 day'
    returning 1
  )
  select count(*)::int from flipped;
$$;

revoke all on function public.expire_stale_entitlements() from public, anon, authenticated;
