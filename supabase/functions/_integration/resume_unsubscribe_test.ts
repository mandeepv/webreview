// resume and unsubscribe integration tests (spec work item 4, R0–R4, U0–U2).

import { INTEGRATION, itest } from '../_testing/env.ts';
import { assertEquals } from 'jsr:@std/assert@1';
import { FakeHttp } from '../_testing/fake_http.ts';
import { createUser, days, db, isoIn, putEntitlement, putFunnelSession } from '../_testing/db.ts';
import { awayFromWindowEdge, call, randomIp } from '../_testing/proxy.ts';
import { resumeToken, unsubscribeToken } from '../_shared/email.ts';

type Handler = (req: Request) => Promise<Response>;
const disabled: Handler = () => Promise.reject(new Error('integration tests are disabled'));
const fake = new FakeHttp();
const resume: Handler = INTEGRATION ? (await import('../resume/handler.ts')).handler : disabled;
const unsubscribe: Handler = INTEGRATION ? (await import('../unsubscribe/handler.ts')).handler : disabled;

async function session() {
  const user = await createUser();
  const sessionId = crypto.randomUUID();
  await putFunnelSession({
    id: sessionId,
    user_id: user.id,
    answers: { role: 'father', 'child-age': '5-7' },
    utm: { fbclid: 'CLICK' },
    landing_variant: 'yelling',
  });
  return { user, sessionId };
}

const mint = (sessionId: string, ip = randomIp()) => call(resume, 'resume', { action: 'mint', sessionId, client_ip: ip });
const resolve = (token: string, ip = randomIp()) => call(resume, 'resume', { action: 'resolve', token, client_ip: ip });

itest('R0: wrong method, missing or wrong proxy key, bad JSON and unknown actions are refused', async () => {
  fake.install();
  assertEquals((await call(resume, 'resume', null, { method: 'GET' })).status, 405);
  assertEquals((await call(resume, 'resume', { action: 'mint' }, { key: null })).status, 403);
  assertEquals((await call(resume, 'resume', { action: 'mint' }, { key: 'wrong' })).status, 403);
  assertEquals((await call(resume, 'resume', null, { raw: '{nope' })).status, 400);
  assertEquals((await call(resume, 'resume', { action: 'steal', client_ip: randomIp() })).json.error, 'unknown_action');
  assertEquals((await mint('not-a-uuid')).json.error, 'missing_session');
  assertEquals((await mint(crypto.randomUUID())).json.error, 'session_not_found');
});

itest('R1: a minted link resolves back to the same session with its answers, in any browser', async () => {
  fake.install();
  const { user, sessionId } = await session();
  const minted = await mint(sessionId);
  assertEquals(minted.status, 200);

  const resolved = await resolve(minted.json.token as string);
  assertEquals(resolved.json, {
    sessionId,
    userId: user.id,
    email: user.email,
    answers: { role: 'father', 'child-age': '5-7' },
    utm: { fbclid: 'CLICK' },
    landingVariant: 'yelling',
    subscribed: false,
  });
});

itest('R2: a tampered, re-pointed or expired link is refused', async () => {
  fake.install();
  const { sessionId } = await session();
  const other = await session();
  const token = (await mint(sessionId)).json.token as string;
  const [, exp, sig] = token.split('.');

  assertEquals((await resolve(`${token.slice(0, -2)}xx`)).status, 401);
  assertEquals((await resolve(`${other.sessionId}.${exp}.${sig}`)).status, 401, 're-pointed at another session');
  assertEquals((await resolve('garbage')).status, 401);

  const realNow = Date.now;
  Date.now = () => realNow() - days(31);
  let expired: string;
  try {
    expired = await resumeToken(sessionId);
  } finally {
    Date.now = realNow;
  }
  assertEquals((await resolve(expired)).json.error, 'invalid_token');
});

itest('R3: resolve says whether the person already pays, by the same rule the app uses', async () => {
  fake.install();
  const cases: Array<[string, string, boolean]> = [
    ['active', isoIn(days(30)), true],
    ['cancelled', isoIn(days(30)), true],
    ['cancelled', isoIn(-days(1)), false],
    ['revoked', isoIn(days(30)), false],
  ];
  for (const [status, end, expected] of cases) {
    const { user, sessionId } = await session();
    await putEntitlement({ user_id: user.id, status, current_period_end: end });
    const token = (await mint(sessionId)).json.token as string;
    assertEquals((await resolve(token)).json.subscribed, expected, `${status} until ${end}`);
  }
});

itest('R4: more than 20 resume calls a minute from one IP are refused', async () => {
  fake.install();
  await awayFromWindowEdge(60);
  const ip = randomIp();
  for (let i = 1; i <= 20; i++) assertEquals((await resolve('garbage', ip)).status, 401, `call ${i}`);
  assertEquals((await resolve('garbage', ip)).status, 429);
});

itest('U0: unsubscribe refuses a wrong method, a missing or wrong proxy key and bad JSON', async () => {
  fake.install();
  assertEquals((await call(unsubscribe, 'unsubscribe', null, { method: 'GET' })).status, 405);
  assertEquals((await call(unsubscribe, 'unsubscribe', {}, { key: null })).status, 403);
  assertEquals((await call(unsubscribe, 'unsubscribe', {}, { key: 'wrong' })).status, 403);
  assertEquals((await call(unsubscribe, 'unsubscribe', null, { raw: '{nope' })).status, 400);
});

itest('U1: a valid link records the opt-out, and clicking it twice is fine', async () => {
  fake.install();
  const user = await createUser();
  const t = await unsubscribeToken(user.id);
  assertEquals(await call(unsubscribe, 'unsubscribe', { u: user.id, t }), { status: 200, json: { ok: true } });
  assertEquals(await call(unsubscribe, 'unsubscribe', { u: user.id, t }), { status: 200, json: { ok: true } });
  const { data } = await db().from('email_opt_outs').select('user_id').eq('user_id', user.id);
  assertEquals(data?.length, 1);
});

itest('U2: a link can only opt out the person it was sent to', async () => {
  fake.install();
  const victim = await createUser();
  const attacker = await createUser();
  const attackersToken = await unsubscribeToken(attacker.id);
  for (const body of [{ u: victim.id, t: attackersToken }, { u: victim.id, t: 'forged' }, { u: 'not-a-uuid', t: attackersToken }]) {
    assertEquals((await call(unsubscribe, 'unsubscribe', body)).json.error, 'invalid_link');
  }
  const { data } = await db().from('email_opt_outs').select('user_id').eq('user_id', victim.id);
  assertEquals(data, []);
});

itest('R5/U3: without UNSUBSCRIBE_SECRET, resume and unsubscribe refuse with 503 rather than trusting a fallback key', async () => {
  fake.install();
  const saved = Deno.env.get('UNSUBSCRIBE_SECRET')!;
  const user = await createUser();
  const t = await unsubscribeToken(user.id);
  Deno.env.delete('UNSUBSCRIBE_SECRET');
  try {
    assertEquals((await call(resume, 'resume', { action: 'resolve', token: 'x', client_ip: randomIp() })).status, 503);
    assertEquals((await call(unsubscribe, 'unsubscribe', { u: user.id, t })).status, 503);
  } finally {
    Deno.env.set('UNSUBSCRIBE_SECRET', saved);
  }
});
