// capture-email integration tests (spec work item 4, E0–E7).

import { INTEGRATION, itest } from '../_testing/env.ts';
import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import { FakeHttp } from '../_testing/fake_http.ts';
import { createUser, db } from '../_testing/db.ts';
import { awayFromWindowEdge, call, randomIp } from '../_testing/proxy.ts';
import { leadEventId } from '../_shared/meta.ts';

type Handler = (req: Request) => Promise<Response>;
const fake = new FakeHttp();
const handler: Handler = INTEGRATION
  ? (await import('../capture-email/handler.ts')).handler
  : () => Promise.reject(new Error('integration tests are disabled'));

const freshEmail = () => `buyer-${crypto.randomUUID().slice(0, 12)}@example.com`;
const capture = (extra: Record<string, unknown> = {}) =>
  call(handler, 'capture-email', {
    email: freshEmail(),
    sessionId: crypto.randomUUID(),
    answers: { role: 'mother', 'child-age': '2-4', name: 'Sam' },
    utm: { utm_source: 'fb', fbclid: 'CLICK' },
    landingVariant: 'tantrums',
    client_ip: randomIp(),
    client_ua: 'Mozilla/5.0 (iPhone) test',
    ...extra,
  });

async function userIdFor(email: string): Promise<string | null> {
  const { data, error } = await db().rpc('get_user_id_by_email', { p_email: email });
  if (error) throw new Error(error.message);
  return data as string | null;
}

async function session(id: string) {
  const { data } = await db().from('funnel_sessions').select('*').eq('id', id).maybeSingle();
  return data;
}

itest('E0: wrong method, missing or wrong proxy key, and malformed input are refused', async () => {
  fake.install();
  assertEquals((await call(handler, 'capture-email', null, { method: 'GET' })).status, 405);
  assertEquals((await call(handler, 'capture-email', { email: freshEmail() }, { key: null })).status, 403);
  assertEquals((await call(handler, 'capture-email', { email: freshEmail() }, { key: 'wrong' })).status, 403);
  assertEquals((await call(handler, 'capture-email', null, { raw: '{not json' })).status, 400);
  assertEquals(fake.calls.length, 0);
});

itest('E1: a new email creates a confirmed account and saves the funnel session', async () => {
  fake.install();
  const email = freshEmail();
  const sessionId = crypto.randomUUID();
  const ip = randomIp();
  const res = await capture({ email: `  ${email.toUpperCase()} `, sessionId, client_ip: ip });
  assertEquals(res.status, 200);

  const userId = res.json.userId as string;
  assertEquals(await userIdFor(email), userId);
  const { data } = await db().auth.admin.getUserById(userId);
  assertEquals(data.user?.email, email);
  assert(data.user?.email_confirmed_at, 'account must be confirmed so OTP sign-in matches it');

  const row = await session(sessionId);
  assertEquals(row?.user_id, userId);
  assertEquals(row?.answers, { role: 'mother', 'child-age': '2-4', name: 'Sam' });
  assertEquals(row?.utm, { utm_source: 'fb', fbclid: 'CLICK' });
  assertEquals(row?.landing_variant, 'tantrums');
  assertEquals(row?.capi, { ip, ua: 'Mozilla/5.0 (iPhone) test', fbp: '', fbc: '' });
  assertEquals(fake.emails().length, 0); // no email at capture
});

itest('E2: an existing account is reused whatever the letter case — never a second user', async () => {
  fake.install();
  const existing = await createUser(freshEmail());
  const res = await capture({ email: existing.email.toUpperCase() });
  assertEquals(res.json.userId, existing.id);
});

itest('E3: a filled honeypot looks like success but creates nothing', async () => {
  fake.install();
  const email = freshEmail();
  const sessionId = crypto.randomUUID();
  const res = await capture({ email, sessionId, hp: 'bot-filled-this' });
  assertEquals(res.status, 200);
  assert(typeof res.json.userId === 'string');
  assertEquals(await userIdFor(email), null);
  assertEquals(await session(sessionId), null);
});

itest('E4: a bad email, an oversized body or a bad session id is refused', async () => {
  fake.install();
  assertEquals((await capture({ email: 'not-an-email' })).json.error, 'invalid_email');
  assertEquals((await capture({ email: `${'a'.repeat(250)}@example.com` })).json.error, 'invalid_email');
  assertEquals((await capture({ padding: 'x'.repeat(16_001) })).status, 413);
  assertEquals((await capture({ sessionId: 'not-a-uuid' })).json.error, 'missing_session');
});

itest('E5: one address can be captured at most 5 times an hour', async () => {
  fake.install();
  await awayFromWindowEdge(3600, 20);
  const email = freshEmail();
  for (let i = 1; i <= 5; i++) assertEquals((await capture({ email })).status, 200, `capture ${i}`);
  // The page tells them how long: an hour for this address (IN-5).
  assertEquals((await capture({ email })).json, { error: 'rate_limited', retry: 'hour' });
});

itest('E5c: honeypot posts never use up a real person’s allowance for their address (IN-5)', async () => {
  fake.install();
  await awayFromWindowEdge(3600, 20);
  const email = freshEmail();
  for (let i = 0; i < 8; i++) assertEquals((await capture({ email, hp: 'bot' })).status, 200);
  assertEquals((await capture({ email })).status, 200, 'a bot locked the address out');
  assert(await userIdFor(email));
});

itest('E5b: one IP can capture at most 10 emails a minute', async () => {
  fake.install();
  await awayFromWindowEdge(60);
  const ip = randomIp();
  for (let i = 1; i <= 10; i++) assertEquals((await capture({ client_ip: ip })).status, 200, `capture ${i}`);
  assertEquals((await capture({ client_ip: ip })).json, { error: 'rate_limited', retry: 'minute' });
});

itest('E5d: IPv6 addresses in one /64 share the per-IP limit (IN-7)', async () => {
  fake.install();
  await awayFromWindowEdge(60);
  const prefix = `2001:db8:${Math.floor(Math.random() * 0xffff).toString(16)}:${Math.floor(Math.random() * 0xffff).toString(16)}`;
  for (let i = 1; i <= 10; i++) {
    assertEquals((await capture({ client_ip: `${prefix}:0:0:0:${i.toString(16)}` })).status, 200, `capture ${i}`);
  }
  assertEquals((await capture({ client_ip: `${prefix}:dead:beef:0:1` })).json.error, 'rate_limited');
});

itest('E6: the waitlist keeps only the reason and child age, creates no account, and cannot be overwritten', async () => {
  fake.install();
  const email = freshEmail();
  const first = await capture({ email, waitlist: 'android', answers: { 'child-age': '5-7', name: 'Sam', mood: 'calm' } });
  assertEquals(first.json, { ok: true });
  const second = await capture({ email, waitlist: 'someone-else', answers: { 'child-age': '13-17' } });
  assertEquals(second.json, { ok: true });

  const { data } = await db().from('waitlist').select('reason, answers').eq('email', email).single();
  assertEquals(data, { reason: 'android', answers: { 'child-age': '5-7' } });
  assertEquals(await userIdFor(email), null);
});

itest('E7: answers and attribution are trimmed to known shapes before storage (P3-19)', async () => {
  fake.install();
  const sessionId = crypto.randomUUID();
  await capture({
    sessionId,
    answers: {
      name: 'N'.repeat(100),
      goals: ['calm', 7, 'x'.repeat(200)],
      'BAD KEY': 'dropped',
      nested: { deep: 'dropped' },
      mood: 'm'.repeat(200),
    },
    utm: { utm_source: 's'.repeat(800), evil: 'dropped' },
  });
  const row = await session(sessionId);
  assertEquals(row?.answers.name.length, 40);
  assertEquals(row?.answers.goals, ['calm', 'x'.repeat(80)]);
  assertEquals(row?.answers.mood.length, 80);
  assertEquals(row?.answers['BAD KEY'], undefined);
  assertEquals(row?.answers.nested, undefined);
  assertEquals(row?.utm, { utm_source: 's'.repeat(500) });
  assertNotEquals(row?.user_id, null);
});

itest('E8: a capture sends Meta a server-side Lead with the browser’s event id and hashed match keys (P2-2)', async () => {
  fake.install();
  const email = freshEmail();
  const sessionId = crypto.randomUUID();
  const ip = randomIp();
  const res = await capture({ email, sessionId, client_ip: ip, meta: { fbp: 'fb.1.1.111', fbc: 'fb.1.2.abc' } });

  const leads = fake.capiEvents('Lead');
  assertEquals(leads.length, 1);
  const event = (leads[0].data as Array<Record<string, any>>)[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
  // What /email passes to pixel('Lead'): a hash, so the session id itself
  // (half of what mints an app sign-in link, SPEC-21) never reaches Meta.
  assertEquals(event.event_id, await leadEventId(sessionId));
  assertEquals(JSON.stringify(leads[0]).includes(sessionId), false);
  assertEquals(event.user_data.fbp, 'fb.1.1.111');
  assertEquals(event.user_data.client_ip_address, ip);
  assertEquals(event.user_data.em[0].length, 64);
  assertEquals(event.user_data.external_id[0].length, 64);
  assertEquals(JSON.stringify(leads[0]).includes(email), false);
  assertEquals(JSON.stringify(leads[0]).includes(res.json.userId as string), false);

  const row = await session(sessionId);
  assertEquals([row?.capi.fbp, row?.capi.fbc], ['fb.1.1.111', 'fb.1.2.abc']);
});

itest('E8b: no Lead for a honeypot bot or a waitlist signup', async () => {
  fake.install();
  await capture({ hp: 'bot' });
  await capture({ waitlist: 'android' });
  assertEquals(fake.capiEvents('Lead').length, 0);
});

itest('E9: a session that belongs to one email is never moved to another (B-3)', async () => {
  fake.install();
  const sessionId = crypto.randomUUID();
  const first = await capture({ sessionId });
  assertEquals(first.status, 200);

  // Someone who learned the session id posts it with their own address.
  const other = freshEmail();
  const second = await capture({ sessionId, email: other });
  assertEquals(second, { status: 409, json: { error: 'session_taken' } });
  assertEquals((await session(sessionId))?.user_id, first.json.userId);
  assertEquals(await userIdFor(other), null, 'an account was created for the refused email');

  // The same email again is fine (a retry, or answers updated).
  assertEquals((await capture({ sessionId, email: (await db().auth.admin.getUserById(first.json.userId as string)).data.user!.email })).status, 200);
});
