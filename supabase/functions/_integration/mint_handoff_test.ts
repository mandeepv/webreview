// mint-handoff integration tests (SPEC-21 §4.2 and §6 "Website", M0–M9):
// the welcome page's sign-in link is issued only to the buyer's own browser,
// only after the purchase landed, only within 24 h, only while entitled, and
// at most 5 times per session a day.

import { INTEGRATION, itest } from '../_testing/env.ts';
import { assert, assertEquals, assertMatch, assertNotEquals } from 'jsr:@std/assert@1';
import { FakeHttp } from '../_testing/fake_http.ts';
import { createUser, days, db, isoIn, putEntitlement, putFunnelSession } from '../_testing/db.ts';
import { awayFromWindowEdge, call, proxyRequest, randomIp } from '../_testing/proxy.ts';
import { newHandoffKey, sha256Hex } from '../_shared/handoff.ts';

const fake = new FakeHttp();
const handler: (req: Request) => Promise<Response> = INTEGRATION
  ? (await import('../mint-handoff/handler.ts')).handler
  : () => Promise.reject(new Error('integration tests are disabled'));

const LINK_RE = /^https:\/\/open\.kinderwell\.app\/k\/([A-Za-z0-9_-]{43})$/;
const HOUR = 3600 * 1000;

/** A buyer as /welcome finds them: purchase recorded by the webhook, nonce on file from checkout. */
async function paidBuyer(o: { purchasedAt?: string | null; status?: string | null; periodEnd?: string } = {}) {
  const user = await createUser();
  const sessionId = crypto.randomUUID();
  const nonce = newHandoffKey();
  await putFunnelSession({
    id: sessionId,
    user_id: user.id,
    handoff_nonce_hash: await sha256Hex(nonce),
    purchased_at: o.purchasedAt === undefined ? isoIn(-60_000) : o.purchasedAt,
  });
  if (o.status !== null) {
    await putEntitlement({ user_id: user.id, status: o.status ?? 'active', current_period_end: o.periodEnd ?? isoIn(days(365)) });
  }
  return { user, sessionId, nonce };
}

const body = (sessionId: string, nonce: string, extra: Record<string, unknown> = {}) => ({
  sessionId,
  nonce,
  client_ip: randomIp(),
  client_ua: 'Mozilla/5.0 (iPhone) test',
  ...extra,
});

async function keysOf(userId: string) {
  const { data, error } = await db().from('handoff_keys').select('*').eq('user_id', userId);
  if (error) throw new Error(`handoff_keys read failed: ${error.message}`);
  return data ?? [];
}

itest('M0: wrong method, missing or wrong proxy key, and malformed input are refused', async () => {
  fake.install();
  const { user, sessionId, nonce } = await paidBuyer();
  assertEquals((await call(handler, 'mint-handoff', null, { method: 'GET' })).status, 405);
  assertEquals((await call(handler, 'mint-handoff', body(sessionId, nonce), { key: null })).status, 403);
  assertEquals((await call(handler, 'mint-handoff', body(sessionId, nonce), { key: 'wrong' })).status, 403);
  assertEquals((await call(handler, 'mint-handoff', null, { raw: '{not json' })).status, 400);
  for (const [s, n] of [['not-a-uuid', nonce], [sessionId, 'short'], [sessionId, `${nonce.slice(1)}=`], [sessionId, 42]]) {
    assertEquals((await call(handler, 'mint-handoff', body(s as string, n as string))).json.error, 'bad_request');
  }
  assertEquals((await keysOf(user.id)).length, 0);
});

itest('M1: the buyer’s browser gets a universal link whose key is stored only as its sha256, for 7 days', async () => {
  fake.install();
  const { user, sessionId, nonce } = await paidBuyer();
  const res = await handler(proxyRequest('mint-handoff', body(sessionId, nonce)));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('cache-control'), 'no-store');
  const { link } = (await res.json()) as { link: string };
  const key = LINK_RE.exec(link)?.[1];
  assert(key, `not a handoff link: ${link}`);

  const [row, ...rest] = await keysOf(user.id);
  assertEquals(rest.length, 0);
  assertEquals(row.key_hash, await sha256Hex(key));
  assertEquals(row.source, 'welcome');
  assertEquals(row.used_at, null);
  const lifetime = new Date(row.expires_at).getTime() - new Date(row.created_at).getTime();
  assert(Math.abs(lifetime - 7 * 24 * HOUR) < 60_000, `lifetime ${lifetime}`);
  assert(!JSON.stringify(row).includes(key), 'the key itself was stored');
  assert(!JSON.stringify(row).includes(nonce), 'the nonce was stored');
  assertEquals(fake.calls.length, 0); // nothing leaves for a third party
});

itest('M2: an unknown session, a wrong nonce, or no nonce on file all get the same 404 and no key', async () => {
  fake.install();
  const { user, sessionId, nonce } = await paidBuyer();
  const wrongNonce = await call(handler, 'mint-handoff', body(sessionId, newHandoffKey()));
  const unknownSession = await call(handler, 'mint-handoff', body(crypto.randomUUID(), nonce));
  assertEquals(wrongNonce, { status: 404, json: { error: 'not_found' } });
  assertEquals(unknownSession, wrongNonce);

  // A checkout opened by a page from before the nonce existed: no hash on file.
  await db().from('funnel_sessions').update({ handoff_nonce_hash: null }).eq('id', sessionId);
  assertEquals((await call(handler, 'mint-handoff', body(sessionId, nonce))).json.error, 'not_found');
  assertEquals((await keysOf(user.id)).length, 0);
});

itest('M3: before the webhook lands the page is told to retry, and gets its link once it has', async () => {
  fake.install();
  const { user, sessionId, nonce } = await paidBuyer({ purchasedAt: null, status: null });
  assertEquals(await call(handler, 'mint-handoff', body(sessionId, nonce)), { status: 409, json: { error: 'not_ready' } });

  // The webhook writes the entitlement, then purchased_at at first activation.
  await putEntitlement({ user_id: user.id, status: 'active', current_period_end: isoIn(days(365)) });
  assertEquals((await call(handler, 'mint-handoff', body(sessionId, nonce))).json.error, 'not_ready');
  await db().from('funnel_sessions').update({ purchased_at: new Date().toISOString() }).eq('id', sessionId);
  const res = await call(handler, 'mint-handoff', body(sessionId, nonce));
  assertEquals(res.status, 200);
  assertMatch(String(res.json.link), LINK_RE);
});

itest('M4: more than 24 hours after the purchase the welcome page gets no more keys', async () => {
  fake.install();
  const fresh = await paidBuyer({ purchasedAt: isoIn(-23 * HOUR) });
  assertEquals((await call(handler, 'mint-handoff', body(fresh.sessionId, fresh.nonce))).status, 200);
  const stale = await paidBuyer({ purchasedAt: isoIn(-25 * HOUR) });
  assertEquals(await call(handler, 'mint-handoff', body(stale.sessionId, stale.nonce)), { status: 410, json: { error: 'expired' } });
  assertEquals((await keysOf(stale.user.id)).length, 0);
});

itest('M5: a refunded buyer, or one whose paid period is over, gets no key', async () => {
  fake.install();
  for (const o of [{ status: 'revoked' }, { status: 'expired' }, { status: 'cancelled', periodEnd: isoIn(-HOUR) }]) {
    const { user, sessionId, nonce } = await paidBuyer(o);
    assertEquals(await call(handler, 'mint-handoff', body(sessionId, nonce)), { status: 403, json: { error: 'not_entitled' } }, o.status);
    assertEquals((await keysOf(user.id)).length, 0, o.status);
  }
  // A cancelled subscription still inside its period is entitled, as in the app.
  const { sessionId, nonce } = await paidBuyer({ status: 'cancelled' });
  assertEquals((await call(handler, 'mint-handoff', body(sessionId, nonce))).status, 200);
});

itest('M6: at most 5 keys per session a day, each a different working key', async () => {
  fake.install();
  await awayFromWindowEdge(86_400);
  const { user, sessionId, nonce } = await paidBuyer();
  const links = new Set<string>();
  for (let i = 1; i <= 5; i++) {
    const res = await call(handler, 'mint-handoff', body(sessionId, nonce));
    assertEquals(res.status, 200, `mint ${i}`);
    links.add(String(res.json.link));
  }
  assertEquals(links.size, 5);
  assertEquals(await call(handler, 'mint-handoff', body(sessionId, nonce)), { status: 429, json: { error: 'rate_limited' } });
  assertEquals((await keysOf(user.id)).length, 5);
});

itest('M7: polling while the webhook lands does not use up the 5 keys', async () => {
  fake.install();
  await awayFromWindowEdge(86_400);
  await awayFromWindowEdge(600);
  const { user, sessionId, nonce } = await paidBuyer({ purchasedAt: null });
  for (let i = 0; i < 12; i++) {
    assertEquals((await call(handler, 'mint-handoff', body(sessionId, nonce))).json.error, 'not_ready');
  }
  await db().from('funnel_sessions').update({ purchased_at: new Date().toISOString() }).eq('id', sessionId);
  for (let i = 1; i <= 5; i++) {
    assertEquals((await call(handler, 'mint-handoff', body(sessionId, nonce))).status, 200, `mint ${i}`);
  }
  assertEquals((await keysOf(user.id)).length, 5);
});

itest('M8: more than 30 attempts per session, or 60 per IP, in 10 minutes are refused before any lookup', async () => {
  fake.install();
  await awayFromWindowEdge(600);
  const sessionId = crypto.randomUUID();
  for (let i = 1; i <= 30; i++) {
    assertEquals((await call(handler, 'mint-handoff', body(sessionId, newHandoffKey()))).status, 404, `call ${i}`);
  }
  assertEquals((await call(handler, 'mint-handoff', body(sessionId, newHandoffKey()))).status, 429);

  const ip = randomIp();
  for (let i = 1; i <= 60; i++) {
    const res = await call(handler, 'mint-handoff', body(crypto.randomUUID(), newHandoffKey(), { client_ip: ip }));
    assertEquals(res.status, 404, `ip call ${i}`);
  }
  assertEquals((await call(handler, 'mint-handoff', body(crypto.randomUUID(), newHandoffKey(), { client_ip: ip }))).status, 429);
});

itest('M9: one buyer’s nonce cannot mint for another buyer’s session', async () => {
  fake.install();
  const a = await paidBuyer();
  const b = await paidBuyer();
  assertEquals((await call(handler, 'mint-handoff', body(b.sessionId, a.nonce))).status, 404);
  const ok = await call(handler, 'mint-handoff', body(a.sessionId, a.nonce));
  assertEquals(ok.status, 200);
  const [row] = await keysOf(a.user.id);
  assertEquals(row.user_id, a.user.id);
  assertNotEquals(row.user_id, b.user.id);
  assertEquals((await keysOf(b.user.id)).length, 0);
});
