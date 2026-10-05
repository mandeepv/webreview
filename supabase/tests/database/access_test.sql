-- Row-level security and function grants (spec work item 5, D1–D5, D8).
-- The browser and the iOS app hold a PUBLIC key; these rules are the only
-- thing stopping them reading other people's data or granting themselves
-- access. Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

-- Two users, each with an entitlement row (written as the table owner, the
-- way the webhook writes them with the service role).
insert into auth.users (id, email, aud, role) values
  ('11111111-1111-4111-8111-111111111111', 'a@example.com', 'authenticated', 'authenticated'),
  ('22222222-2222-4222-8222-222222222222', 'b@example.com', 'authenticated', 'authenticated');
insert into public.entitlements (user_id, source, status, product_id, current_period_end) values
  ('11111111-1111-4111-8111-111111111111', 'dodo', 'active', 'pdt_a', now() + interval '30 days'),
  ('22222222-2222-4222-8222-222222222222', 'dodo', 'active', 'pdt_b', now() + interval '30 days');
insert into public.email_opt_outs (user_id) values ('11111111-1111-4111-8111-111111111111');
insert into public.funnel_sessions (id, user_id) values
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111');

-- D1 ─ every table in public has RLS on (also catches a future table someone forgets)
select is_empty(
  $$ select tablename from pg_tables where schemaname = 'public' and not rowsecurity $$,
  'D1: every public table has row-level security enabled'
);

-- D2/D3 ─ a signed-in user sees only their own entitlement and can change none
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

select results_eq(
  $$ select user_id from public.entitlements $$,
  $$ values ('11111111-1111-4111-8111-111111111111'::uuid) $$,
  'D2: user A reads only their own entitlement'
);
select throws_ok(
  $$ insert into public.entitlements (user_id, source, status, product_id)
     values ('44444444-4444-4444-8444-444444444444', 'dodo', 'active', 'x') $$,
  '42501', null,
  'D3: user A cannot insert an entitlement'
);
-- With no update/delete policy these touch zero rows (or are refused outright —
-- either is safe; the checks below look at what actually happened).
do $$ begin
  update public.entitlements set current_period_end = now() + interval '10 years';
  delete from public.entitlements;
exception when insufficient_privilege then null;
end $$;

reset role;
select results_eq(
  $$ select status, current_period_end < now() + interval '1 year'
     from public.entitlements where user_id = '11111111-1111-4111-8111-111111111111' $$,
  $$ values ('active'::text, true) $$,
  'D3: user A cannot extend their own access'
);
select is(
  (select count(*)::int from public.entitlements
   where user_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')),
  2,
  'D3: user A cannot delete entitlements'
);

-- D4 ─ service-only tables are invisible and unwritable to anon and signed-in users
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is_empty($$ select * from public.entitlements $$, 'D4: anon reads no entitlements');
select is_empty($$ select * from public.funnel_sessions $$, 'D4: anon reads no funnel_sessions');
select is_empty($$ select * from public.webhook_events $$, 'D4: anon reads no webhook_events');
select is_empty($$ select * from public.unlinked_purchases $$, 'D4: anon reads no unlinked_purchases');
select is_empty($$ select * from public.waitlist $$, 'D4: anon reads no waitlist');
select is_empty($$ select * from public.email_opt_outs $$, 'D4: anon reads no email_opt_outs');
select is_empty($$ select * from public.rate_limit_hits $$, 'D4: anon reads no rate_limit_hits');
select throws_ok($$ insert into public.funnel_sessions (id) values (gen_random_uuid()) $$, '42501', null, 'D4: anon cannot write funnel_sessions');
select throws_ok($$ insert into public.webhook_events (id) values ('forged') $$, '42501', null, 'D4: anon cannot write webhook_events');
select throws_ok($$ insert into public.waitlist (email) values ('x@example.com') $$, '42501', null, 'D4: anon cannot write waitlist');
select throws_ok($$ insert into public.rate_limit_hits (key, window_start) values ('k', now()) $$, '42501', null, 'D4: anon cannot write rate_limit_hits');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select is_empty($$ select * from public.funnel_sessions $$, 'D4: a user cannot read even their own funnel session');
select is_empty($$ select * from public.email_opt_outs $$, 'D4: a user cannot read even their own opt-out');
select is_empty($$ select * from public.unlinked_purchases $$, 'D4: a user reads no unlinked_purchases');
select throws_ok(
  $$ insert into public.email_opt_outs (user_id) values ('22222222-2222-4222-8222-222222222222') $$,
  '42501', null, 'D4: a user cannot opt someone else out'
);
select throws_ok(
  $$ insert into public.unlinked_purchases (payload, reason) values ('{}', 'forged') $$,
  '42501', null, 'D4: a user cannot write unlinked_purchases'
);
reset role;

-- D5 ─ the security-definer functions are callable by the service role only
select ok(not has_function_privilege('anon', 'public.get_user_id_by_email(text)', 'execute'),
  'D5: anon cannot call get_user_id_by_email (would reveal who has an account)');
select ok(not has_function_privilege('authenticated', 'public.get_user_id_by_email(text)', 'execute'),
  'D5: signed-in users cannot call get_user_id_by_email');
select ok(not has_function_privilege('anon', 'public.expire_stale_entitlements()', 'execute'),
  'D5: anon cannot call expire_stale_entitlements');
select ok(not has_function_privilege('authenticated', 'public.expire_stale_entitlements()', 'execute'),
  'D5: signed-in users cannot call expire_stale_entitlements');
select ok(not has_function_privilege('anon', 'public.hit_rate_limit(text, integer, integer)', 'execute'),
  'D5: anon cannot call hit_rate_limit');
select ok(not has_function_privilege('authenticated', 'public.hit_rate_limit(text, integer, integer)', 'execute'),
  'D5: signed-in users cannot call hit_rate_limit');
select ok(has_function_privilege('service_role', 'public.get_user_id_by_email(text)', 'execute'),
  'D5: the service role can still call get_user_id_by_email');
select is(public.get_user_id_by_email('A@EXAMPLE.COM'), '11111111-1111-4111-8111-111111111111'::uuid,
  'D5: get_user_id_by_email ignores letter case');

-- D8 ─ deleting an auth user removes their access and opt-out, and orphans their funnel session
delete from auth.users where id = '11111111-1111-4111-8111-111111111111';
select is_empty($$ select 1 from public.entitlements where user_id = '11111111-1111-4111-8111-111111111111' $$,
  'D8: the entitlement cascades away with the user');
select is_empty($$ select 1 from public.email_opt_outs where user_id = '11111111-1111-4111-8111-111111111111' $$,
  'D8: the opt-out cascades away with the user');
select is((select user_id from public.funnel_sessions where id = '33333333-3333-4333-8333-333333333333'), null::uuid,
  'D8: the funnel session stays but loses its user');

select * from finish();
rollback;
