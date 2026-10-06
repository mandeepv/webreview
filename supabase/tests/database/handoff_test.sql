-- SPEC-21 purchase handoff (INVARIANTS #29): handoff_keys holds login
-- credentials (their hashes), and funnel_sessions.handoff_nonce_hash is what
-- lets the website mint them. Neither may be reachable with the public key the
-- browser and the app hold — the service role only.
--
-- Also pins the single-use statement redeem-handoff runs, so a change to the
-- table can't quietly let a key sign in twice.
-- Run with: supabase test db   (or, without Docker: scripts/db-test-local/run.sh)
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, email, aud, role) values
  ('a1a1a1a1-0000-4000-8000-000000000001', 'handoff-a@example.com', 'authenticated', 'authenticated'),
  ('b2b2b2b2-0000-4000-8000-000000000002', 'handoff-b@example.com', 'authenticated', 'authenticated');
-- Written as the table owner, the way the website writes them with the service role.
insert into public.handoff_keys (key_hash, user_id, source, created_at, expires_at) values
  (repeat('a', 64), 'a1a1a1a1-0000-4000-8000-000000000001', 'welcome', now(), now() + interval '7 days'),
  (repeat('b', 64), 'a1a1a1a1-0000-4000-8000-000000000001', 'email', now() - interval '8 days', now() - interval '1 day'),
  (repeat('c', 64), 'b2b2b2b2-0000-4000-8000-000000000002', 'email', now(), now() + interval '1 day');
insert into public.funnel_sessions (id, user_id, handoff_nonce_hash) values
  ('c3c3c3c3-0000-4000-8000-000000000003', 'a1a1a1a1-0000-4000-8000-000000000001', repeat('d', 64));

-- H1 ─ the table is locked to the service role
select ok((select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'handoff_keys'),
  'H1: handoff_keys has row-level security on');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'handoff_keys'), 0,
  'H1: handoff_keys has no policies (service role only)');

-- H2 ─ the public key reaches nothing, signed in or not
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select * from public.handoff_keys $$, '42501', null,
  'H2: anon cannot read handoff_keys');
select throws_ok(
  $$ insert into public.handoff_keys (key_hash, user_id, source) values (repeat('e', 64), 'a1a1a1a1-0000-4000-8000-000000000001', 'welcome') $$,
  '42501', null, 'H2: anon cannot mint a key');
select is_empty($$ select handoff_nonce_hash from public.funnel_sessions $$,
  'H2: anon reads no funnel nonce');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1a1a1a1-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select * from public.handoff_keys $$, '42501', null,
  'H3: a signed-in user cannot read even their own keys');
select throws_ok(
  $$ insert into public.handoff_keys (key_hash, user_id, source) values (repeat('e', 64), 'a1a1a1a1-0000-4000-8000-000000000001', 'welcome') $$,
  '42501', null, 'H3: a signed-in user cannot mint a key');
select throws_ok($$ update public.handoff_keys set used_at = null $$, '42501', null,
  'H3: a signed-in user cannot un-use a key');
select is_empty($$ select handoff_nonce_hash from public.funnel_sessions $$,
  'H3: a signed-in user cannot read even their own funnel nonce');
reset role;

-- H4 ─ the table refuses bad keys outright
select throws_ok(
  $$ insert into public.handoff_keys (key_hash, user_id, source, created_at, expires_at)
     values (repeat('f', 64), 'a1a1a1a1-0000-4000-8000-000000000001', 'welcome', now(), now() + interval '8 days') $$,
  '23514', null, 'H4: a key living longer than 7 days is refused');
select throws_ok(
  $$ insert into public.handoff_keys (key_hash, user_id, source) values ('not-a-hash', 'a1a1a1a1-0000-4000-8000-000000000001', 'welcome') $$,
  '23514', null, 'H4: key_hash must be a sha256 in lowercase hex');
select throws_ok(
  $$ insert into public.handoff_keys (key_hash, user_id, source) values (repeat('f', 64), 'a1a1a1a1-0000-4000-8000-000000000001', 'sms') $$,
  '23514', null, 'H4: source is welcome or email');
select is((select expires_at - created_at from public.handoff_keys where key_hash = repeat('c', 64)) <= interval '7 days', true,
  'H4: the default lifetime is within the limit');

-- H5 ─ the single-use claim, exactly as redeem-handoff sends it
select results_eq(
  $$ update public.handoff_keys set used_at = now()
     where key_hash = repeat('a', 64) and used_at is null and expires_at > now()
     returning user_id $$,
  $$ values ('a1a1a1a1-0000-4000-8000-000000000001'::uuid) $$,
  'H5: the first redeem claims the key and learns its user');
select is_empty(
  $$ update public.handoff_keys set used_at = now()
     where key_hash = repeat('a', 64) and used_at is null and expires_at > now()
     returning user_id $$,
  'H5: a second redeem of the same key gets nothing');
select is_empty(
  $$ update public.handoff_keys set used_at = now()
     where key_hash = repeat('b', 64) and used_at is null and expires_at > now()
     returning user_id $$,
  'H5: an expired key gets nothing');

-- H6 ─ deleting the account takes its keys with it
delete from auth.users where id = 'a1a1a1a1-0000-4000-8000-000000000001';
select is_empty($$ select 1 from public.handoff_keys where user_id = 'a1a1a1a1-0000-4000-8000-000000000001' $$,
  'H6: the keys cascade away with the user');
select is((select count(*)::int from public.handoff_keys where user_id = 'b2b2b2b2-0000-4000-8000-000000000002'), 1,
  'H6: other users keep theirs');

select * from finish();
rollback;
