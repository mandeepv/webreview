-- Webhook hardening + rate limits from reviews/PROD_REVIEW.md (P0-2, P1-3c, P1-7, P1-8, P2-10).
-- Additive only: new nullable/defaulted columns and a replaced function body.
-- Nothing the iOS app reads changes meaning.
--
-- Same discipline as the earlier migrations: copy into the app repo's
-- supabase/migrations/, dev first, prod only via scripts/db-push-prod.sh.
-- ORDER: apply this BEFORE deploying the edge functions from the same commit —
-- dodo-webhook and winback-sweep select these columns.

-- P0-2: first-activation side effects (handoff email, CAPI Purchase,
-- purchased_at) fire exactly once per Dodo subscription, whatever order Dodo
-- delivers the first-purchase burst in. The webhook claims the activation with
-- a conditional UPDATE on activated_subscription_id; only the winner fires.
alter table public.entitlements
  add column if not exists activated_subscription_id text,
  add column if not exists activated_at timestamptz;

-- Existing rows already had their side effects fired under the old logic.
-- Without this backfill their next renewal would re-send the welcome email.
update public.entitlements
set activated_subscription_id = dodo_subscription_id,
    activated_at = updated_at
where dodo_subscription_id is not null
  and activated_subscription_id is null;

-- P1-3c: set when access is revoked and the Dodo subscription still needs
-- cancelling; cleared when Dodo confirms. winback-sweep retries any row left
-- true, so a network error after a refund can't leave the customer billed.
alter table public.entitlements
  add column if not exists cancel_pending boolean not null default false;

-- P2-10: idempotency rows are written as 'processing' and flipped to 'done'
-- at the end. A run killed mid-way leaves 'processing', which a retry can
-- reclaim after two minutes instead of being acknowledged as a duplicate.
-- Existing rows are completed runs, hence the 'done' default.
alter table public.webhook_events
  add column if not exists status text not null default 'done'
    check (status in ('processing', 'done'));

-- P1-8: a late renewal webhook must not lock out someone who was just billed.
-- 'active' rows get 5 days past period end (winback-sweep also reconciles them
-- against the Dodo API first); 'past_due' / 'cancelled' keep the 1-day grace.
create or replace function public.expire_stale_entitlements()
returns int
language sql
security definer
set search_path = ''
as $$
  with flipped as (
    update public.entitlements
    set status = 'expired', updated_at = now()
    where current_period_end is not null
      and (
        (status = 'active' and current_period_end < now() - interval '5 days')
        or (status in ('past_due', 'cancelled') and current_period_end < now() - interval '1 day')
      )
    returning 1
  )
  select count(*)::int from flipped;
$$;

revoke all on function public.expire_stale_entitlements() from public, anon, authenticated;

-- P1-7: rate limiting that doesn't depend on a dashboard setting. Fixed
-- windows counted in Postgres (no extra vendor); the edge functions call
-- hit_rate_limit() per IP / per email before creating accounts or checkouts.
-- winback-sweep deletes windows older than a day.
create table if not exists public.rate_limit_hits (
  key text not null,
  window_start timestamptz not null,
  count int not null default 1,
  primary key (key, window_start)
);
alter table public.rate_limit_hits enable row level security;
-- No policies: service_role only.

-- True while `p_key` is within `p_max` hits in the current window.
create or replace function public.hit_rate_limit(p_key text, p_window_seconds int, p_max int)
returns boolean
language sql
security definer
set search_path = ''
as $$
  insert into public.rate_limit_hits as r (key, window_start, count)
  values (
    p_key,
    to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds),
    1
  )
  on conflict (key, window_start) do update set count = r.count + 1
  returning count <= p_max;
$$;

revoke all on function public.hit_rate_limit(text, int, int) from public, anon, authenticated;
