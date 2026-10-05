-- The SQL functions the edge functions depend on (spec work item 5, D6–D7).
-- Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- D6 ─ expire_stale_entitlements(): grace periods by status
insert into auth.users (id, email, aud, role)
select ('d6000000-0000-4000-8000-00000000000' || n)::uuid, 'd6-' || n || '@example.com', 'authenticated', 'authenticated'
from generate_series(1, 7) n;

insert into public.entitlements (user_id, source, status, product_id, current_period_end) values
  ('d6000000-0000-4000-8000-000000000001', 'dodo', 'active',    'p', now() - interval '4 days'),   -- inside the 5-day grace
  ('d6000000-0000-4000-8000-000000000002', 'dodo', 'active',    'p', now() - interval '6 days'),   -- past it
  ('d6000000-0000-4000-8000-000000000003', 'dodo', 'past_due',  'p', now() - interval '12 hours'), -- inside the 1-day grace
  ('d6000000-0000-4000-8000-000000000004', 'dodo', 'past_due',  'p', now() - interval '2 days'),   -- past it
  ('d6000000-0000-4000-8000-000000000005', 'dodo', 'cancelled', 'p', now() - interval '2 days'),   -- past it
  ('d6000000-0000-4000-8000-000000000006', 'dodo', 'revoked',   'p', now() - interval '30 days'),  -- never touched
  ('d6000000-0000-4000-8000-000000000007', 'dodo', 'active',    'p', null);                        -- no date: never touched

select cmp_ok(public.expire_stale_entitlements(), '>=', 3, 'D6: the sweep reports the rows it flipped');

select is((select status from public.entitlements where user_id = 'd6000000-0000-4000-8000-000000000001'), 'active',
  'D6: active stays active for 5 days past period end (a late renewal webhook must not lock out a payer)');
select is((select status from public.entitlements where user_id = 'd6000000-0000-4000-8000-000000000002'), 'expired',
  'D6: active expires after the 5-day grace');
select is((select status from public.entitlements where user_id = 'd6000000-0000-4000-8000-000000000003'), 'past_due',
  'D6: past_due keeps a 1-day grace');
select is((select status from public.entitlements where user_id = 'd6000000-0000-4000-8000-000000000004'), 'expired',
  'D6: past_due expires after 1 day');
select is((select status from public.entitlements where user_id = 'd6000000-0000-4000-8000-000000000005'), 'expired',
  'D6: cancelled expires after 1 day');
select is((select status from public.entitlements where user_id = 'd6000000-0000-4000-8000-000000000006'), 'revoked',
  'D6: revoked is never rewritten');
select is((select status from public.entitlements where user_id = 'd6000000-0000-4000-8000-000000000007'), 'active',
  'D6: a row with no period end is never expired by the sweep');

-- D7 ─ hit_rate_limit(): fixed windows. now() is fixed inside a transaction,
-- so every call below lands in the same window.
select is(public.hit_rate_limit('d7:ip:203.0.113.7', 60, 3), true, 'D7: 1st hit in the window is allowed');
select is(public.hit_rate_limit('d7:ip:203.0.113.7', 60, 3), true, 'D7: 2nd hit is allowed');
select is(public.hit_rate_limit('d7:ip:203.0.113.7', 60, 3), true, 'D7: 3rd hit (the max) is allowed');
select is(public.hit_rate_limit('d7:ip:203.0.113.7', 60, 3), false, 'D7: 4th hit is refused');
select is(public.hit_rate_limit('d7:ip:198.51.100.1', 60, 3), true, 'D7: other keys are counted separately');

-- A full window from the past does not count against the current one.
insert into public.rate_limit_hits (key, window_start, count) values ('d7:old', now() - interval '2 hours', 999);
select is(public.hit_rate_limit('d7:old', 60, 3), true, 'D7: a new window starts from zero');

select * from finish();
rollback;
