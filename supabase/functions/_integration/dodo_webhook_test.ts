// dodo-webhook integration tests (spec work item 3, W1–W20). Each test sends
// signed Dodo events to the real handler, against a real local database, with
// Dodo / Resend / Meta / PostHog faked at the HTTP boundary, then checks the
// rows written and the calls recorded.
//
// Run: supabase start, then
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… deno test --allow-all supabase/functions/_integration/
// Skipped (not failed) when no local Supabase is configured.

import { INTEGRATION, itest } from '../_testing/env.ts';
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { FakeHttp, HOSTS, json } from '../_testing/fake_http.ts';
import {
  createUser,
  days,
  db,
  deleteUser,
  entitlement,
  isoIn,
  putEntitlement,
  putFunnelSession,
  unlinked,
  webhookEvent,
} from '../_testing/db.ts';
import { disputeEvent, newId, paymentEvent, paymentResponse, refundEvent, subscriptionEvent } from '../_testing/fixtures.ts';
import { signedRequest, type SignOpts } from '../_testing/webhook.ts';
import { sha256Hex } from '../_shared/handoff.ts';

const fake = new FakeHttp();
// Imported only when a local Supabase exists: the handler builds its client on load.
const handler: (req: Request) => Promise<Response> = INTEGRATION
  ? (await import('../dodo-webhook/handler.ts')).handler
  : () => Promise.reject(new Error('integration tests are disabled'));

async function deliver(event: unknown, opts: SignOpts = {}) {
  const res = await handler(await signedRequest(event, opts));
  return { status: res.status, text: await res.text() };
}

/** A paying customer as the first-purchase burst leaves them: an active row on `sub`. */
async function activeCustomer(o: { periodEnd?: string } = {}) {
  const user = await createUser();
  const sub = newId('sub');
  await putEntitlement({
    user_id: user.id,
    status: 'active',
    dodo_subscription_id: sub,
    current_period_end: o.periodEnd ?? isoIn(days(300)),
    activated_subscription_id: sub,
  });
  return { user, sub };
}

const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest])
  );
}

// ── W1 ─────────────────────────────────────────────────────────────────────

itest('W1: unsigned, mis-signed or stale deliveries are rejected before anything happens', async () => {
  fake.install();
  const user = await createUser();
  const event = subscriptionEvent('subscription.active', { userId: user.id, subscriptionId: newId('sub') });

  const attempts: SignOpts[] = [
    { secretBytes: new TextEncoder().encode('not-the-secret') },
    { timestamp: Math.floor(Date.now() / 1000) - 600 },
    { timestamp: Math.floor(Date.now() / 1000) + 600 },
    { omit: ['webhook-signature'] },
    { omit: ['webhook-id'] },
    { omit: ['webhook-timestamp'] },
  ];
  for (const opts of attempts) {
    assertEquals((await deliver(event, opts)).status, 401, JSON.stringify(opts));
  }
  assertEquals(await entitlement(user.id), null);
  assertEquals(fake.calls.length, 0);
});

// ── W2: the P0-2 bug class ─────────────────────────────────────────────────

itest('W2: the first-purchase burst in all 24 orders grants access and fires the welcome email and Meta Purchase exactly once', async () => {
  fake.install();
  const kinds = ['subscription.active', 'subscription.renewed', 'subscription.updated', 'payment.succeeded'];
  const nextBilling = '2027-10-05T09:59:40.000Z';

  for (const order of permutations(kinds)) {
    fake.reset();
    const user = await createUser();
    const sub = newId('sub');
    const sessionId = crypto.randomUUID();
    const eventId = newId('evt');
    await putFunnelSession({ id: sessionId, user_id: user.id, capi: { fbp: 'fb.1.111.222', ip: '203.0.113.9' } });

    for (const kind of order) {
      const event = kind.startsWith('payment.')
        ? paymentEvent(kind, { paymentId: newId('pay'), subscriptionId: sub, userId: user.id })
        : subscriptionEvent(kind, {
            userId: user.id,
            subscriptionId: sub,
            sessionId,
            eventId,
            customerEmail: user.email,
            nextBillingDate: nextBilling,
          });
      assertEquals((await deliver(event)).status, 200, `${order.join(' → ')}: ${kind}`);
    }

    const row = await entitlement(user.id);
    const label = order.join(' → ');
    assertEquals(row?.status, 'active', label);
    assertEquals(row?.dodo_subscription_id, sub, label);
    assertEquals(time(row?.current_period_end), time(nextBilling), label);
    assertEquals(row?.activated_subscription_id, sub, label);
    assertEquals(fake.welcomeEmails().length, 1, `welcome emails for ${label}`);
    assertEquals(fake.capiPurchases().length, 1, `Meta Purchases for ${label}`);
  }
});

itest('W2b: the burst delivered concurrently grants access without errors and fires side effects exactly once', async () => {
  fake.install();
  // Two simultaneous FIRST inserts for one user collide only some of the
  // time, so: many rounds, each with 8 simultaneous deliveries (the burst
  // plus the duplicates Dodo sends when it retries).
  const kinds = ['subscription.active', 'subscription.renewed', 'subscription.plan_changed', 'subscription.active'];
  for (let round = 0; round < 20; round++) {
    fake.reset();
    const user = await createUser();
    const sub = newId('sub');
    const events = [...kinds, ...kinds].map((type) =>
      subscriptionEvent(type, { userId: user.id, subscriptionId: sub, customerEmail: user.email })
    );
    const results = await Promise.all(events.map((e) => deliver(e)));
    for (const r of results) assertEquals(r.status, 200, `round ${round}: a concurrent delivery failed`);
    assertEquals((await entitlement(user.id))?.status, 'active');
    assertEquals(fake.welcomeEmails().length, 1, `round ${round}`);
    assertEquals(fake.capiPurchases().length, 1, `round ${round}`);
  }
});

itest('W2c: the Meta Purchase carries the charged amount and hashed match keys, never a plain email', async () => {
  fake.install();
  const user = await createUser();
  const sessionId = crypto.randomUUID();
  await putFunnelSession({ id: sessionId, user_id: user.id, capi: { fbp: 'fb.1.111.222', ua: 'Mozilla/5.0 test' } });
  await deliver(
    subscriptionEvent('subscription.active', {
      userId: user.id,
      subscriptionId: newId('sub'),
      sessionId,
      eventId: 'evt_paid_checkout',
      customerEmail: user.email,
      amount: 4999,
    })
  );

  const [capi] = fake.capiPurchases();
  const event = (capi.data as Array<Record<string, any>>)[0]; // eslint-disable-line @typescript-eslint/no-explicit-any
  assertEquals(event.event_name, 'Purchase');
  assertEquals(event.event_id, 'evt_paid_checkout');
  assertEquals(event.custom_data, { value: 49.99, currency: 'USD' });
  assertEquals(event.user_data.fbp, 'fb.1.111.222');
  assertEquals(event.user_data.em[0].length, 64); // sha256 hex
  assert(!JSON.stringify(capi).includes(user.email), 'plain email sent to Meta');
  assertEquals(capi.test_event_code, undefined);

  const [welcome] = fake.welcomeEmails();
  assertEquals(welcome.to, [user.email]);
  assertStringIncludes(welcome.html ?? '', 'Continue with Email');
  for (const call of fake.to(HOSTS.posthog)) {
    assert(!JSON.stringify(call.body).includes(user.email), 'email sent to PostHog');
  }
});

// ── W3–W6: idempotency ─────────────────────────────────────────────────────

itest('W3: a delivery replayed after it succeeded is a no-op', async () => {
  fake.install();
  const user = await createUser();
  const event = subscriptionEvent('subscription.active', { userId: user.id, subscriptionId: newId('sub') });
  const id = `msg_${crypto.randomUUID()}`;
  assertEquals((await deliver(event, { id })).status, 200);
  const before = await entitlement(user.id);

  fake.reset();
  const replay = await deliver(event, { id });
  assertEquals(replay, { status: 200, text: 'duplicate' });
  assertEquals(fake.calls.length, 0);
  assertEquals(await entitlement(user.id), before);
});

itest('W4: a delivery racing an in-flight run of the same webhook gets 500 so Dodo retries later', async () => {
  fake.install();
  const user = await createUser();
  const id = `msg_${crypto.randomUUID()}`;
  await db().from('webhook_events').insert({ id, event_type: 'subscription.active', status: 'processing' });

  const res = await deliver(subscriptionEvent('subscription.active', { userId: user.id, subscriptionId: newId('sub') }), { id });
  assertEquals(res, { status: 500, text: 'in progress' });
  assertEquals(await entitlement(user.id), null);
});

itest('W5: a run that died mid-way (processing for over 2 minutes) is reclaimed by the retry', async () => {
  fake.install();
  const user = await createUser();
  const id = `msg_${crypto.randomUUID()}`;
  await db()
    .from('webhook_events')
    .insert({ id, event_type: 'subscription.active', status: 'processing', received_at: isoIn(-5 * 60 * 1000) });

  const res = await deliver(subscriptionEvent('subscription.active', { userId: user.id, subscriptionId: newId('sub') }), { id });
  assertEquals(res.status, 200);
  assertEquals((await entitlement(user.id))?.status, 'active');
  assertEquals((await webhookEvent(id))?.status, 'done');
});

itest('W6: a run that throws returns 500 and frees its idempotency row, so the retry does the work', async () => {
  fake.install();
  const { user, sub } = await activeCustomer();
  const paymentId = newId('pay');
  const id = `msg_${crypto.randomUUID()}`;
  fake.on('GET', HOSTS.dodo, /^\/payments\//, () => json({ message: 'upstream' }, 500));

  assertEquals((await deliver(refundEvent('refund.succeeded', { paymentId }), { id })).status, 500);
  assertEquals(await webhookEvent(id), null);
  assertEquals((await entitlement(user.id))?.status, 'active');

  fake.reset();
  fake.on('GET', HOSTS.dodo, /^\/payments\//, () => json(paymentResponse({ paymentId, subscriptionId: sub })));
  assertEquals((await deliver(refundEvent('refund.succeeded', { paymentId }), { id })).status, 200);
  assertEquals((await entitlement(user.id))?.status, 'revoked');
});

// ── W7–W10: refunds and disputes ───────────────────────────────────────────

itest('W7: a full refund (no subscription_id in the payload) revokes access and cancels the subscription once', async () => {
  fake.install();
  const { user, sub } = await activeCustomer();
  const paymentId = newId('pay');
  fake.on('GET', HOSTS.dodo, /^\/payments\//, () => json(paymentResponse({ paymentId, subscriptionId: sub })));

  assertEquals((await deliver(refundEvent('refund.succeeded', { paymentId }))).status, 200);

  const row = await entitlement(user.id);
  assertEquals(row?.status, 'revoked');
  assertEquals(row?.cancel_pending, false);
  assertEquals(fake.dodoCancels(), [sub]);
  assert(fake.posthogEvents().includes('web_sub_revoked'));
});

itest('W7b: dispute opened then lost revokes once and cancels once', async () => {
  fake.install();
  const { user, sub } = await activeCustomer();
  const paymentId = newId('pay');
  fake.on('GET', HOSTS.dodo, /^\/payments\//, () => json(paymentResponse({ paymentId, subscriptionId: sub })));

  await deliver(disputeEvent('dispute.opened', { paymentId }));
  await deliver(disputeEvent('dispute.lost', { paymentId }));
  assertEquals((await entitlement(user.id))?.status, 'revoked');
  assertEquals(fake.dodoCancels(), [sub]);
});

itest('W8: when the Dodo cancel fails, access is still revoked and the cancel is left pending with an alert', async () => {
  fake.install();
  const { user, sub } = await activeCustomer();
  const paymentId = newId('pay');
  fake.on('GET', HOSTS.dodo, /^\/payments\//, () => json(paymentResponse({ paymentId, subscriptionId: sub })));
  fake.on('PATCH', HOSTS.dodo, /^\/subscriptions\//, () => json({ message: 'down' }, 503));

  assertEquals((await deliver(refundEvent('refund.succeeded', { paymentId }))).status, 200);
  const row = await entitlement(user.id);
  assertEquals(row?.status, 'revoked');
  assertEquals(row?.cancel_pending, true);
  assert(fake.alerts().some((a) => a.subject.includes('Cancel this subscription manually')));
});

itest('W9: a partial refund changes nothing and alerts the owner', async () => {
  fake.install();
  const { user } = await activeCustomer();
  assertEquals((await deliver(refundEvent('refund.succeeded', { paymentId: newId('pay'), isPartial: true }))).status, 200);
  assertEquals((await entitlement(user.id))?.status, 'active');
  assertEquals(fake.dodoCancels(), []);
  assert(fake.alerts().some((a) => a.subject.includes('Partial refund')));
});

itest('W10: a refund whose payment Dodo cannot find is parked for a human, revoking nobody (P3-27)', async () => {
  fake.install();
  const { user } = await activeCustomer();
  const paymentId = newId('pay'); // the default fake answers GET /payments/* with 404
  assertEquals((await deliver(refundEvent('refund.succeeded', { paymentId }))).status, 200);

  assertEquals((await entitlement(user.id))?.status, 'active');
  const { data } = await db().from('unlinked_purchases').select('reason').ilike('reason', `%${paymentId}%`);
  assertEquals(data?.length, 1);
  assert(fake.alerts().some((a) => a.subject.includes('Unlinked purchase')));
});

// ── W11–W14: stale and duplicate subscriptions ─────────────────────────────

itest('W11: a late renewal for a revoked subscription does not restore access (P0-1)', async () => {
  fake.install();
  const { user, sub } = await activeCustomer();
  await putEntitlement({ user_id: user.id, status: 'revoked', dodo_subscription_id: sub });

  await deliver(subscriptionEvent('subscription.renewed', { userId: user.id, subscriptionId: sub }));
  assertEquals((await entitlement(user.id))?.status, 'revoked');
  assertEquals(fake.welcomeEmails().length, 0);
});

itest('W12: a refunded customer who buys again gets access on the new subscription and one welcome email (P0-1)', async () => {
  fake.install();
  const { user, sub } = await activeCustomer();
  await putEntitlement({ user_id: user.id, status: 'revoked', dodo_subscription_id: sub });
  const newSub = newId('sub');

  await deliver(subscriptionEvent('subscription.active', { userId: user.id, subscriptionId: newSub, customerEmail: user.email }));
  const row = await entitlement(user.id);
  assertEquals(row?.status, 'active');
  assertEquals(row?.dodo_subscription_id, newSub);
  assertEquals(fake.welcomeEmails().length, 1);
});

itest('W13: a late expiry for an old subscription leaves the new one alone (P1-3)', async () => {
  fake.install();
  const { user, sub } = await activeCustomer();
  const before = await entitlement(user.id);

  await deliver(subscriptionEvent('subscription.expired', { userId: user.id, subscriptionId: newId('sub') }));
  assertEquals(await entitlement(user.id), before);
  assertEquals(before?.dodo_subscription_id, sub);
});

itest('W14: a second live subscription while the first is entitled is cancelled and flagged (P1-3b)', async () => {
  fake.install();
  const { user, sub } = await activeCustomer();
  const second = newId('sub');

  await deliver(subscriptionEvent('subscription.active', { userId: user.id, subscriptionId: second }));
  assertEquals((await entitlement(user.id))?.dodo_subscription_id, sub);
  assertEquals(fake.dodoCancels(), [second]);
  assert(fake.alerts().some((a) => a.subject.includes('Duplicate purchase')));
  assertEquals(fake.welcomeEmails().length, 0);
});

// ── W15–W20: linking, deleted users, period rules ──────────────────────────

itest('W15: a purchase with no supabase_user_id is parked for a human, not dropped', async () => {
  fake.install();
  const sub = newId('sub');
  assertEquals((await deliver(subscriptionEvent('subscription.active', { userId: null, subscriptionId: sub }))).status, 200);
  assertEquals((await unlinked(sub)).length, 1);
  assert(fake.alerts().some((a) => a.subject.includes('Unlinked purchase')));
});

itest('W16: an event for a deleted user cancels the subscription and alerts, without a retry loop (P2-3)', async () => {
  fake.install();
  const user = await createUser();
  await deleteUser(user.id);
  const sub = newId('sub');

  assertEquals((await deliver(subscriptionEvent('subscription.renewed', { userId: user.id, subscriptionId: sub }))).status, 200);
  assertEquals(fake.dodoCancels(), [sub]);
  assert(fake.alerts().some((a) => a.subject.includes('deleted user')));
});

itest('W17: on_hold keeps access and never moves the period end earlier (P2-3c)', async () => {
  fake.install();
  const periodEnd = isoIn(days(20));
  const { user, sub } = await activeCustomer({ periodEnd });

  await deliver(subscriptionEvent('subscription.on_hold', { userId: user.id, subscriptionId: sub, nextBillingDate: isoIn(0) }));
  const row = await entitlement(user.id);
  assertEquals(row?.status, 'past_due');
  assert(time(row?.current_period_end) >= time(periodEnd) - 1000, 'period end moved earlier');
});

itest('W18: when the checkout email differs from the account, the welcome email names the account and the owner is told (P1-2)', async () => {
  fake.install();
  const user = await createUser();
  await deliver(
    subscriptionEvent('subscription.active', { userId: user.id, subscriptionId: newId('sub'), customerEmail: 'someone-else@example.com' })
  );
  const [welcome] = fake.welcomeEmails();
  assertEquals(welcome.to, [user.email, 'someone-else@example.com']);
  assertStringIncludes(welcome.html ?? '', user.email);
  assert(fake.alerts().some((a) => a.subject.includes('Checkout email differs')));
});

itest('W19: META_TEST_EVENT_CODE marks the Purchase as a test event only while it is set', async () => {
  fake.install();
  Deno.env.set('META_TEST_EVENT_CODE', 'TEST123');
  try {
    const user = await createUser();
    await deliver(subscriptionEvent('subscription.active', { userId: user.id, subscriptionId: newId('sub') }));
    assertEquals(fake.capiPurchases()[0].test_event_code, 'TEST123');
  } finally {
    Deno.env.delete('META_TEST_EVENT_CODE');
  }
  fake.reset();
  const user = await createUser();
  await deliver(subscriptionEvent('subscription.active', { userId: user.id, subscriptionId: newId('sub') }));
  assertEquals(fake.capiPurchases()[0].test_event_code, undefined);
});

itest('W20: an activation without next_billing_date still grants a full plan period and alerts (P1-4)', async () => {
  fake.install();
  const user = await createUser();
  await deliver(subscriptionEvent('subscription.active', { userId: user.id, subscriptionId: newId('sub'), nextBillingDate: null }));
  const row = await entitlement(user.id);
  assertEquals(row?.status, 'active');
  assert(time(row?.current_period_end) > Date.now() + days(360), 'annual plan should get about a year');
  assert(fake.alerts().some((a) => a.subject.includes('without next_billing_date')));
});

// ── W21–W23: the buyer's app profile (03-app-changes §5) ───────────────────

async function profile(userId: string) {
  const { data, error } = await db().from('user_profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw new Error(`user_profiles read failed: ${error.message}`);
  return data;
}

async function buyWithAnswers(answers: Record<string, unknown>, user?: { id: string; email: string }) {
  const buyer = user ?? (await createUser());
  const sessionId = crypto.randomUUID();
  await putFunnelSession({ id: sessionId, user_id: buyer.id, answers });
  await deliver(subscriptionEvent('subscription.active', { userId: buyer.id, subscriptionId: newId('sub'), sessionId }));
  return buyer;
}

itest('W21: first purchase gives the buyer an app profile from their quiz answers, so the app skips its questions', async () => {
  fake.install();
  const buyer = await buyWithAnswers({
    role: 'mother',
    name: 'Sam',
    'children-count': '2',
    'child-age': '2-4',
    experience: 'new-to-science',
    goals: ['calm_mornings'],
    mood: 'stretched',
  });
  const row = await profile(buyer.id);
  assertEquals(row?.user_type, 'mother'); // what the app checks to count them as onboarded
  assertEquals(row?.name, 'Sam');
  assertEquals(row?.children_count, 2);
  assertEquals(row?.children, [{ ageRange: '2-4' }]);
  assertEquals(row?.experience_level, 'new-to-science');
  assertEquals(row?.improvement_goals, null);
  assertEquals(row?.emotional_challenges, null);
  assert(fake.posthogEvents().includes('web_profile_created'));
});

itest('W22: an existing app user who buys on the web keeps their own profile untouched', async () => {
  fake.install();
  const user = await createUser();
  await db().from('user_profiles').insert({ id: user.id, user_type: 'father', name: 'Alex', children_count: 1 });
  await buyWithAnswers({ role: 'mother', name: 'Sam', 'children-count': '3+' }, user);
  const row = await profile(user.id);
  assertEquals([row?.user_type, row?.name, row?.children_count], ['father', 'Alex', 1]);
  assert(!fake.posthogEvents().includes('web_profile_created'));
});

itest('W23: no profile without a valid role, and a profile problem never fails the purchase', async () => {
  fake.install();
  const buyer = await buyWithAnswers({ name: 'Sam' });
  assertEquals(await profile(buyer.id), null);
  assertEquals((await entitlement(buyer.id))?.status, 'active');
  assertEquals(fake.welcomeEmails().length, 1);
});

// ── W24: event ordering (P2-17) ────────────────────────────────────────────

itest('W24: a renewal Dodo retries hours late cannot undo a newer expiry', async () => {
  fake.install();
  const user = await createUser();
  const sub = newId('sub');
  const t = (h: number) => new Date(Date.UTC(2026, 9, 5, h)).toISOString();

  await deliver(subscriptionEvent('subscription.active', { userId: user.id, subscriptionId: sub, occurredAt: t(8) }));
  await deliver(subscriptionEvent('subscription.expired', { userId: user.id, subscriptionId: sub, occurredAt: t(12), nextBillingDate: isoIn(-days(1)) }));
  // The renewal happened at 10:00 but its first delivery failed; Dodo retries it now.
  await deliver(subscriptionEvent('subscription.renewed', { userId: user.id, subscriptionId: sub, occurredAt: t(10), nextBillingDate: isoIn(days(30)) }));

  const row = await entitlement(user.id);
  assertEquals(row?.status, 'expired');
  assertEquals(new Date(row!.last_event_at!).toISOString(), t(12));

  // A genuinely newer renewal still brings them back.
  await deliver(subscriptionEvent('subscription.renewed', { userId: user.id, subscriptionId: sub, occurredAt: t(14), nextBillingDate: isoIn(days(30)) }));
  assertEquals((await entitlement(user.id))?.status, 'active');
});

// ── W25: the email's sign-in link (SPEC-21) ────────────────────────────────

const LINK_RE = /https:\/\/open\.kinderwell\.app\/k\/([A-Za-z0-9_-]{43})/;

async function handoffKeysOf(userId: string) {
  const { data, error } = await db().from('handoff_keys').select('*').eq('user_id', userId);
  if (error) throw new Error(`handoff_keys read failed: ${error.message}`);
  return data ?? [];
}

itest('W25: the welcome email carries one "Open Kinderwell" sign-in link, stored only as its hash, once per purchase', async () => {
  fake.install();
  const user = await createUser();
  const sub = newId('sub');
  const sessionId = crypto.randomUUID();
  await putFunnelSession({ id: sessionId, user_id: user.id, capi: {} });
  for (const type of ['subscription.active', 'subscription.renewed', 'subscription.active']) {
    await deliver(subscriptionEvent(type, { userId: user.id, subscriptionId: sub, sessionId, customerEmail: user.email }));
  }

  const [welcome, ...more] = fake.welcomeEmails();
  assertEquals(more.length, 0);
  assertEquals(welcome.to, [user.email]);
  const html = welcome.html ?? '';
  assertStringIncludes(html, 'Open Kinderwell');
  const key = LINK_RE.exec(html)?.[1];
  assert(key, 'no sign-in link in the welcome email');
  // The email-code steps stay as the fallback.
  assertStringIncludes(html, 'Continue with Email');

  const keys = await handoffKeysOf(user.id);
  assertEquals(keys.length, 1);
  assertEquals(keys[0].key_hash, await sha256Hex(key));
  assertEquals(keys[0].source, 'email');
  assertEquals(keys[0].used_at, null);

  // The credential goes to the buyer's inbox and nowhere else.
  for (const call of [...fake.to(HOSTS.meta), ...fake.to(HOSTS.posthog)]) {
    assert(!JSON.stringify(call.body).includes(key), `sign-in key sent to ${call.url.hostname}`);
  }
});

itest('W25b: when the checkout email differs from the account, no sign-in link is minted or sent', async () => {
  fake.install();
  const user = await createUser();
  await deliver(
    subscriptionEvent('subscription.active', { userId: user.id, subscriptionId: newId('sub'), customerEmail: 'someone-else@example.com' })
  );
  const [welcome] = fake.welcomeEmails();
  assert(!LINK_RE.test(welcome.html ?? ''), 'a sign-in link went to a second inbox');
  assertStringIncludes(welcome.html ?? '', 'Continue with Email');
  assertEquals((await handoffKeysOf(user.id)).length, 0);
});
