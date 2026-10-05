-- TEST-ONLY. Loaded into the LOCAL Supabase the tests use (config.toml →
-- [db.seed]); never part of supabase/migrations, never applied to dev/prod.
--
-- The iOS app owns these tables (~/mamalearn/supabase/migrations/
-- 20260101000000_initial_schema.sql). dodo-webhook writes user_profiles at
-- first purchase, so the integration tests need the same shape. If the app
-- changes this table, copy the change here — a webhook test failing on a
-- missing column is the signal.

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  user_type text,
  name text,
  age integer,
  children_count integer,
  children jsonb,
  improvement_goals text[],
  notifications_enabled boolean default false,
  partner_involvement text,
  partner_invited boolean default false,
  learning_goal text,
  experience_level text,
  familiar_parenting_styles text[],
  emotional_challenges text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.user_profiles enable row level security;
create policy "Users can read own profile" on public.user_profiles for select using (auth.uid() = id);
create policy "Users can insert/update own profile" on public.user_profiles for insert with check (auth.uid() = id);
create policy "Users can update own profile" on public.user_profiles for update using (auth.uid() = id);
