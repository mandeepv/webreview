// create-checkout integration tests (spec work item 4, C0–C9; SPEC-21 C10).

import { INTEGRATION, itest, TEST } from '../_testing/env.ts';
import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import { FakeHttp, HOSTS, json } from '../_testing/fake_http.ts';
import { createUser, days, db, isoIn, putEntitlement, putFunnelSession } from '../_testing/db.ts';
import { productResponse } from '../_testing/fixtures.ts';
import { awayFromWindowEdge, call, randomIp } from '../_testing/proxy.ts';
import { newHandoffKey, sha256Hex } from '../_shared/handoff.ts';

type Handler = (req: Request) => Promise<Response>;
const fake = new FakeHttp();
const createHandler: () => Handler = INTEGRATION
  ? (await import('../create-checkout/handler.ts')).createHandler
  : () => () => Promise.reject(new Error('integration tests are disabled'));

let checkoutCount = 0;
function setup(o: { cents?: number } = {}) {
  fake.install();
  fake.on('GET', HOSTS.dodo, /^\/products\//, (c) =>
    json(productResponse({ productId: c.url.pathname.split('/').at(-1)!, cents: o.cents ?? 5999 }))
  );
  fake.on('POST', HOSTS.dodo, /^\/checkouts$/, () => {
    const id = `cks_T${++checkoutCount}_${crypto.randomUUID().slice(0, 8)}`;
    return json({ session_id: id, checkout_url: `https://test.checkout.dodopayments.com/session/${id}` });
  });
  return createHandler();
}

/** A funnel session that has been through capture-email: it has a user. */
async function capturedSession() {
  const user = await createUser();
  const sessionId = crypto.randomUUID();
  await putFunnelSession({ id: sessionId, user_id: user.id, capi: { ip: '203.0.113.1', ua: 'test' } });
  return { user, sessionId };
}

const checkoutCalls = () => fake.to(HOSTS.dodo, 'POST', /^\/checkouts$/);
const body = (sessionId: string, extra: Record<string, unknown> = {}) => ({
  sessionId,
  plan: 'annual',
  displayedPrice: 59.99,
  meta: { fbp: 'fb.1.1.111', fbc: 'fb.1.2.abc' },
  client_ip: randomIp(),
  client_ua: 'Mozilla/5.0 (iPhone) test',
  ...extra,
});

itest('C0: wrong method, missing or wrong proxy key, and malformed input are refused', async () => {
  const handler = setup();
  const { sessionId } = await capturedSession();
  assertEquals((await call(handler, 'create-checkout', null, { method: 'GET' })).status, 405);
  assertEquals((await call(handler, 'create-checkout', body(sessionId), { key: null })).status, 403);
  assertEquals((await call(handler, 'create-checkout', body(sessionId), { key: 'wrong' })).status, 403);
  assertEquals((await call(handler, 'create-checkout', null, { raw: '{not json' })).status, 400);
  assertEquals((await call(handler, 'create-checkout', body('not-a-uuid'))).json.error, 'missing_session');
  assertEquals(checkoutCalls().length, 0);
});

itest('C1: a checkout locks the account email, carries the linking metadata and stores the CAPI keys', async () => {
  const handler = setup();
  const { user, sessionId } = await capturedSession();
  const res = await call(handler, 'create-checkout', body(sessionId));
  assertEquals(res.status, 200);
  assert(String(res.json.checkoutUrl).startsWith('https://test.checkout.dodopayments.com/'));

  const [dodo] = checkoutCalls();
  const sent = dodo.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  assertEquals(sent.customer, { email: user.email });
  assertEquals(sent.feature_flags, { allow_customer_editing_email: false });
  assertEquals(sent.metadata, {
    supabase_user_id: user.id,
    funnel_session_id: sessionId,
    event_id: res.json.eventId,
    plan: 'annual',
  });
  assertEquals(sent.product_cart, [{ product_id: TEST.productAnnual, quantity: 1 }]);
  assert(sent.allowed_payment_method_types.includes('apple_pay'));
  assertEquals(sent.return_url, `${TEST.siteUrl}/welcome`);

  const { data } = await db().from('funnel_sessions').select('capi').eq('id', sessionId).single();
  assertEquals(data!.capi.fbp, 'fb.1.1.111');
  assertEquals(data!.capi.event_id, res.json.eventId);
  assertEquals(data!.capi.checkout_url, res.json.checkoutUrl);
});

itest('C1b: the monthly plan uses the monthly product', async () => {
  const handler = setup({ cents: 1299 });
  const { sessionId } = await capturedSession();
  const res = await call(handler, 'create-checkout', body(sessionId, { plan: 'monthly', displayedPrice: 12.99 }));
  assertEquals(res.status, 200);
  const sent = checkoutCalls()[0].body as { product_cart: Array<{ product_id: string }>; metadata: { plan: string } };
  assertEquals(sent.product_cart[0].product_id, TEST.productMonthly);
  assertEquals(sent.metadata.plan, 'monthly');
});

itest('C2: someone who already has access cannot be charged again — including a cancelled sub still in its period', async () => {
  const handler = setup();
  for (const status of ['active', 'past_due', 'cancelled']) {
    const { user, sessionId } = await capturedSession();
    await putEntitlement({ user_id: user.id, status, current_period_end: isoIn(days(10)) });
    const res = await call(handler, 'create-checkout', body(sessionId));
    assertEquals(res, { status: 409, json: { error: 'already_subscribed' } }, status);
  }
  assertEquals(checkoutCalls().length, 0);

  // …but once the paid period is over they can buy again.
  const { user, sessionId } = await capturedSession();
  await putEntitlement({ user_id: user.id, status: 'cancelled', current_period_end: isoIn(-days(2)) });
  assertEquals((await call(handler, 'create-checkout', body(sessionId))).status, 200);
});

itest('C2b: during a late renewal (active, a few days past its date) the app still lets them in, so checkout won’t sell again (AP-3)', async () => {
  const handler = setup();
  const { user, sessionId } = await capturedSession();
  await putEntitlement({ user_id: user.id, status: 'active', current_period_end: isoIn(-days(2)) });
  assertEquals(await call(handler, 'create-checkout', body(sessionId)), { status: 409, json: { error: 'already_subscribed' } });

  // Past the 6-day grace the sweep has had its say: they can buy again.
  await putEntitlement({ user_id: user.id, status: 'active', current_period_end: isoIn(-days(7)) });
  assertEquals((await call(handler, 'create-checkout', body(sessionId))).status, 200);
});

itest('C3: tapping again within 30 minutes returns the same checkout, so nobody can pay twice', async () => {
  const handler = setup();
  const { sessionId } = await capturedSession();
  const first = await call(handler, 'create-checkout', body(sessionId));
  const second = await call(handler, 'create-checkout', body(sessionId));
  assertEquals(second.json, first.json);
  assertEquals(checkoutCalls().length, 1);
});

itest('C4: a different plan, or the same plan after 30 minutes, gets a new checkout', async () => {
  const handler = setup();
  const { sessionId } = await capturedSession();
  const annual = await call(handler, 'create-checkout', body(sessionId));
  fake.on('GET', HOSTS.dodo, /^\/products\//, () => json(productResponse({ productId: TEST.productMonthly, cents: 1299 })));
  const monthly = await call(handler, 'create-checkout', body(sessionId, { plan: 'monthly', displayedPrice: 12.99 }));
  assertNotEquals(monthly.json.checkoutUrl, annual.json.checkoutUrl);

  // Age the stored monthly checkout past the reuse window.
  const { data } = await db().from('funnel_sessions').select('capi').eq('id', sessionId).single();
  const checkouts = data!.capi.checkouts;
  checkouts.monthly.created_at = isoIn(-31 * 60 * 1000);
  await db().from('funnel_sessions').update({ capi: { ...data!.capi, checkouts } }).eq('id', sessionId);
  const later = await call(handler, 'create-checkout', body(sessionId, { plan: 'monthly', displayedPrice: 12.99 }));
  assertNotEquals(later.json.checkoutUrl, monthly.json.checkoutUrl);
  assertEquals(checkoutCalls().length, 3);
});

itest('C4b: switching plans back and forth hands back each plan’s own checkout (IN-7)', async () => {
  const handler = setup();
  const { sessionId } = await capturedSession();
  const annual = await call(handler, 'create-checkout', body(sessionId));
  fake.on('GET', HOSTS.dodo, /^\/products\//, (c) =>
    json(productResponse({ productId: c.url.pathname.split('/').at(-1)!, cents: c.url.pathname.endsWith(TEST.productMonthly) ? 1299 : 5999 }))
  );
  const monthly = await call(handler, 'create-checkout', body(sessionId, { plan: 'monthly', displayedPrice: 12.99 }));
  const annualAgain = await call(handler, 'create-checkout', body(sessionId));
  const monthlyAgain = await call(handler, 'create-checkout', body(sessionId, { plan: 'monthly', displayedPrice: 12.99 }));
  assertEquals(annualAgain.json, annual.json);
  assertEquals(monthlyAgain.json, monthly.json);
  assertEquals(checkoutCalls().length, 2);
});

itest('C5: a displayed price that differs from Dodo blocks checkout, with one owner alert however many tries', async () => {
  const handler = setup({ cents: 4999 }); // Dodo charges 49.99; the page shows 59.99
  for (let i = 0; i < 3; i++) {
    const { sessionId } = await capturedSession();
    assertEquals(await call(handler, 'create-checkout', body(sessionId)), {
      status: 409,
      json: { error: 'price_mismatch' },
    });
  }
  assertEquals(checkoutCalls().length, 0);
  assertEquals(fake.alerts().filter((a) => a.subject.includes('displayed price')).length, 1);
});

itest('C5b: when Dodo’s price cannot be read, the sale is not blocked', async () => {
  const handler = setup();
  fake.on('GET', HOSTS.dodo, /^\/products\//, () => json({ message: 'down' }, 500));
  const { sessionId } = await capturedSession();
  assertEquals((await call(handler, 'create-checkout', body(sessionId))).status, 200);
});

itest('C6: more than 10 checkouts per session in 10 minutes are refused', async () => {
  const handler = setup();
  await awayFromWindowEdge(600);
  const { sessionId } = await capturedSession();
  for (let i = 1; i <= 10; i++) {
    assertEquals((await call(handler, 'create-checkout', body(sessionId))).status, 200, `call ${i}`);
  }
  assertEquals((await call(handler, 'create-checkout', body(sessionId))).json.error, 'rate_limited');
});

itest('C6b: more than 20 calls a minute from one IP are refused', async () => {
  const handler = setup();
  await awayFromWindowEdge(60);
  const ip = randomIp();
  for (let i = 1; i <= 20; i++) {
    // Unknown sessions: the limit is checked before the session is looked up.
    const res = await call(handler, 'create-checkout', body(crypto.randomUUID(), { client_ip: ip }));
    assertEquals(res.status, 404, `call ${i}`);
  }
  assertEquals((await call(handler, 'create-checkout', body(crypto.randomUUID(), { client_ip: ip }))).status, 429);
});

itest('C7: an unknown session, or one that never captured an email, is refused', async () => {
  const handler = setup();
  assertEquals((await call(handler, 'create-checkout', body(crypto.randomUUID()))).json.error, 'session_not_found');
  const orphan = crypto.randomUUID();
  await putFunnelSession({ id: orphan, user_id: null });
  assertEquals((await call(handler, 'create-checkout', body(orphan))).json.error, 'session_not_found');
});

itest('C8: when Dodo fails, the buyer gets 502 and nothing is stored for reuse', async () => {
  const handler = setup();
  fake.on('POST', HOSTS.dodo, /^\/checkouts$/, () => json({ message: 'boom' }, 500));
  const { sessionId } = await capturedSession();
  assertEquals((await call(handler, 'create-checkout', body(sessionId))).status, 502);
  const { data } = await db().from('funnel_sessions').select('capi').eq('id', sessionId).single();
  assertEquals(data!.capi.checkout_url, undefined);

  // Dodo recovers: the retry creates a real checkout instead of reusing a broken one.
  setup();
  const retry = await call(createHandler(), 'create-checkout', body(sessionId));
  assertEquals(retry.status, 200);
});

itest('C9: a new checkout sends Meta a server-side InitiateCheckout once; a reused one does not (P2-2)', async () => {
  const handler = setup();
  const { sessionId } = await capturedSession();
  const first = await call(handler, 'create-checkout', body(sessionId));
  await call(handler, 'create-checkout', body(sessionId)); // reused checkout

  const events = fake.capiEvents('InitiateCheckout');
  assertEquals(events.length, 1);
  const event = (events[0].data as Array<Record<string, any>>)[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
  assertEquals(event.event_id, `ic-${first.json.eventId}`); // what /offer passes to pixel('InitiateCheckout')
  assertEquals(event.custom_data, { value: 59.99, currency: 'USD' });
  assertEquals(event.user_data.fbp, 'fb.1.1.111');
});

// ── C10: the handoff nonce (SPEC-21), bound to the checkout (B-3) ─────────

const nonceHashOf = async (sessionId: string) =>
  (await db().from('funnel_sessions').select('handoff_nonce_hash').eq('id', sessionId).single()).data!.handoff_nonce_hash;
const metadataOf = (i: number) => (checkoutCalls()[i].body as { metadata: Record<string, string> }).metadata;

itest('C10: the sha256 of the browser’s nonce rides in that checkout’s Dodo metadata; the session column is left to the webhook', async () => {
  const handler = setup();
  const { sessionId } = await capturedSession();
  const nonce = newHandoffKey();
  assertEquals((await call(handler, 'create-checkout', body(sessionId, { handoffNonce: nonce }))).status, 200);

  assertEquals(metadataOf(0).handoff_nonce_hash, await sha256Hex(nonce));
  // Written only by dodo-webhook, from the PAID checkout's metadata.
  assertEquals(await nonceHashOf(sessionId), null);

  const { data } = await db().from('funnel_sessions').select('*').eq('id', sessionId).single();
  assert(!JSON.stringify(data).includes(nonce), 'the nonce itself was stored');
  assert(!JSON.stringify(checkoutCalls()[0].body).includes(nonce), 'the nonce went to Dodo');
});

itest('C10b: the same browser gets its checkout back; another browser on the same session gets its own, with its own nonce', async () => {
  const handler = setup();
  const { sessionId } = await capturedSession();
  const buyer = newHandoffKey();
  const first = await call(handler, 'create-checkout', body(sessionId, { handoffNonce: buyer }));
  const again = await call(handler, 'create-checkout', body(sessionId, { handoffNonce: buyer }));
  assertEquals(again.json, first.json);
  assertEquals(checkoutCalls().length, 1);

  // Someone else holding the session id (or the buyer's other browser) can't
  // take over the buyer's checkout: theirs is a separate one, and only the
  // checkout that is PAID decides whose nonce mints (W26).
  const other = newHandoffKey();
  const second = await call(handler, 'create-checkout', body(sessionId, { handoffNonce: other }));
  assertNotEquals(second.json.checkoutUrl, first.json.checkoutUrl);
  assertEquals(checkoutCalls().length, 2);
  assertEquals(metadataOf(0).handoff_nonce_hash, await sha256Hex(buyer));
  assertEquals(metadataOf(1).handoff_nonce_hash, await sha256Hex(other));
  assertEquals(await nonceHashOf(sessionId), null);
});

itest('C10c: no nonce, or a malformed one, means no hash in the metadata, and checkout still works', async () => {
  const handler = setup();
  for (const bad of [undefined, 'short', 42, `${newHandoffKey().slice(1)}=`]) {
    const { sessionId } = await capturedSession();
    assertEquals((await call(handler, 'create-checkout', body(sessionId, { handoffNonce: bad }))).status, 200, String(bad));
  }
  for (let i = 0; i < 4; i++) assertEquals('handoff_nonce_hash' in metadataOf(i), false);
});

itest('C11: a request without the displayed price is refused, and Meta’s InitiateCheckout value never comes from the request (IN-7)', async () => {
  const handler = setup();
  const { sessionId } = await capturedSession();
  for (const displayedPrice of [undefined, '59.99', null, Number.NaN]) {
    assertEquals(
      await call(handler, 'create-checkout', body(sessionId, { displayedPrice })),
      { status: 400, json: { error: 'missing_price' } },
      String(displayedPrice)
    );
  }
  assertEquals(checkoutCalls().length, 0);

  // Dodo's price can't be read, so the guard lets an odd number through;
  // Meta still gets the configured price, not the one in the request.
  fake.on('GET', HOSTS.dodo, /^\/products\//, () => json({ message: 'down' }, 500));
  assertEquals((await call(handler, 'create-checkout', body(sessionId, { displayedPrice: 1 }))).status, 200);
  const event = (fake.capiEvents('InitiateCheckout')[0].data as Array<Record<string, any>>)[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
  assertEquals(event.custom_data, { value: 59.99, currency: 'USD' });
});
