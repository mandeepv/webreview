// winback-sweep integration tests (spec work item 4, S1–S10).
//
// The sweep works over the WHOLE database, and other test files leave rows
// behind, so every assertion here looks at this test's own users and
// subscriptions — never at the sweep's totals.

import { INTEGRATION, itest, TEST } from '../_testing/env.ts';
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { FakeHttp, HOSTS, json } from '../_testing/fake_http.ts';
import {
  createSignedInUser,
  createUser,
  days,
  db,
  entitlement,
  isoIn,
  putEntitlement,
  putFunnelSession,
} from '../_testing/db.ts';
import { newId } from '../_testing/fixtures.ts';
import { verifyResumeToken } from '../_shared/email.ts';

const HOUR = 3600 * 1000;
const fake = new FakeHttp();
const handler: (req: Request) => Promise<Response> = INTEGRATION
  ? (await import('../winback-sweep/handler.ts')).handler
  : () => Promise.reject(new Error('integration tests are disabled'));

async function sweep(o: { key?: string | null; viaQuery?: boolean } = {}) {
  const key = o.key === undefined ? TEST.sweepSecret : o.key;
  const url = new URL('http://localhost/functions/v1/winback-sweep');
  const headers: Record<string, string> = {};
  if (key !== null && o.viaQuery) url.searchParams.set('key', key);
  else if (key !== null) headers['x-sweep-key'] = key;
  const res = await handler(new Request(url, { method: 'POST', headers }));
  return { status: res.status, text: await res.text() };
}

/** Someone who gave their email `ageMs` ago and never bought. */
async function lead(ageMs: number, userOverride?: { id: string; email: string }) {
  const user = userOverride ?? (await createUser());
  const sessionId = crypto.randomUUID();
  await putFunnelSession({ id: sessionId, user_id: user.id, created_at: isoIn(-ageMs) });
  return { user, sessionId };
}

async function stage(sessionId: string): Promise<number> {
  const { data } = await db().from('funnel_sessions').select('winback_stage').eq('id', sessionId).single();
  return data!.winback_stage;
}

const emailsTo = (email: string) => fake.emails().filter((e) => e.to.includes(email));

/** A paying customer whose first payment was `ageMs` ago. */
async function payer(ageMs: number, user?: { id: string; email: string }) {
  const u = user ?? (await createUser());
  const sub = newId('sub');
  await putEntitlement({
    user_id: u.id,
    status: 'active',
    dodo_subscription_id: sub,
    current_period_end: isoIn(days(300)),
    activated_subscription_id: sub,
    activated_at: isoIn(-ageMs),
  });
  return { user: u, sub };
}

itest('S1: the sweep refuses a missing or wrong key, and accepts the header or ?key=', async () => {
  fake.install();
  assertEquals((await sweep({ key: null })).status, 403);
  assertEquals((await sweep({ key: 'wrong' })).status, 403);
  assertEquals((await sweep()).status, 200);
  assertEquals((await sweep({ viaQuery: true })).status, 200);
});

itest('S2: a lead gets "plan ready" at 1 hour and "still thinking" at 24 hours — and never a third', async () => {
  fake.install();
  const { user, sessionId } = await lead(2 * HOUR);

  await sweep();
  const [first] = emailsTo(user.email);
  assertEquals(emailsTo(user.email).length, 1);
  assertEquals(first.subject, 'Your Kinderwell plan is ready');
  assertEquals(await stage(sessionId), 1);

  // CAN-SPAM: unsubscribe link, postal address, one-click headers.
  assertStringIncludes(first.html ?? '', `${TEST.siteUrl}/u?u=${user.id}`);
  assertStringIncludes(first.html ?? '', 'PO Box 1');
  const sent = fake.to(HOSTS.resend).find((c) => (c.body as { to: string[] }).to.includes(user.email))!;
  assertEquals((sent.body as { headers: Record<string, string> }).headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');

  // The button rebuilds THIS session in whatever browser opens it (P1-6).
  const token = decodeURIComponent(/\/r\/([^"]+)"/.exec(first.html ?? '')![1]);
  assertEquals(await verifyResumeToken(token), sessionId);

  await db().from('funnel_sessions').update({ created_at: isoIn(-25 * HOUR) }).eq('id', sessionId);
  fake.reset();
  await sweep();
  assertEquals(emailsTo(user.email).map((e) => e.subject), ['Still thinking it over?']);
  assertEquals(await stage(sessionId), 2);

  fake.reset();
  await sweep();
  assertEquals(emailsTo(user.email).length, 0, 'S8: a later run sends nothing more');
});

itest('S2b: a lead younger than an hour is left alone', async () => {
  fake.install();
  const { user, sessionId } = await lead(20 * 60 * 1000);
  await sweep();
  assertEquals(emailsTo(user.email).length, 0);
  assertEquals(await stage(sessionId), 0);
});

itest('S3: no win-back email to someone who opted out or already pays — and their sessions are closed', async () => {
  fake.install();
  const optedOut = await lead(2 * HOUR);
  await db().from('email_opt_outs').insert({ user_id: optedOut.user.id });
  const paying = await lead(2 * HOUR);
  await payer(10 * 60 * 1000, paying.user);

  await sweep();
  assertEquals(emailsTo(optedOut.user.email).length, 0);
  assertEquals(emailsTo(paying.user.email).filter((e) => e.subject.includes('plan')).length, 0);
  assertEquals(await stage(optedOut.sessionId), 2);
  assertEquals(await stage(paying.sessionId), 2);
});

itest('S3b: the ladder is per person — two abandoned sessions get one email, not two', async () => {
  fake.install();
  const first = await lead(2 * HOUR);
  await lead(3 * HOUR, first.user);
  await sweep();
  assertEquals(emailsTo(first.user.email).length, 1);
});

itest('S4: live mode without a postal address skips marketing mail but still nudges payers', async () => {
  fake.install();
  Deno.env.set('DODO_ENV', 'live');
  Deno.env.delete('MAILING_ADDRESS');
  try {
    const { user: leadUser, sessionId } = await lead(2 * HOUR);
    const { user: payingUser } = await payer(25 * HOUR);
    await sweep();
    assertEquals(emailsTo(leadUser.email).length, 0);
    assertEquals(await stage(sessionId), 0, 'left for a run that may send');
    assertEquals(emailsTo(payingUser.email).map((e) => e.subject), ['Your Kinderwell subscription is waiting']);
  } finally {
    Deno.env.set('DODO_ENV', 'test');
    Deno.env.set('MAILING_ADDRESS', 'PO Box 1, Testville, CA 90000');
  }
});

itest('S5: a payer who never signed in gets a nudge at 24 hours and 72 hours after paying, then no more', async () => {
  fake.install();
  const { user } = await payer(25 * HOUR);

  await sweep();
  const [nudge] = emailsTo(user.email);
  assertEquals(nudge.subject, 'Your Kinderwell subscription is waiting');
  assertStringIncludes(nudge.html ?? '', 'Continue with Email');
  assertEquals((await entitlement(user.id))?.nudge_stage, 1);

  await db().from('entitlements').update({ activated_at: isoIn(-73 * HOUR) }).eq('user_id', user.id);
  fake.reset();
  await sweep();
  assertEquals(emailsTo(user.email).map((e) => e.subject), ['Don’t leave your plan unused']);

  fake.reset();
  await sweep();
  assertEquals(emailsTo(user.email).length, 0);
});

itest('S5b: no nudge for a payer who has signed in, or who paid under a day ago', async () => {
  fake.install();
  const signedIn = await payer(30 * HOUR, await createSignedInUser());
  const recent = await payer(2 * HOUR);
  await sweep();
  assertEquals(emailsTo(signedIn.user.email).length, 0);
  assertEquals(emailsTo(recent.user.email).length, 0);
  // A signed-in customer's ladder is closed, so they stop occupying the batch.
  assertEquals((await entitlement(signedIn.user.id))?.nudge_stage, 2);
  assertEquals((await entitlement(recent.user.id))?.nudge_stage, 0);
});

itest('S6: pending cancels are retried — cleared when Dodo confirms, kept when it fails', async () => {
  fake.install();
  const ok = await payer(10 * HOUR);
  const failing = await payer(10 * HOUR);
  for (const p of [ok, failing]) {
    await putEntitlement({ user_id: p.user.id, status: 'revoked', dodo_subscription_id: p.sub, cancel_pending: true });
  }
  fake.on('PATCH', HOSTS.dodo, new RegExp(`^/subscriptions/${failing.sub}$`), () => json({ message: 'down' }, 503));

  await sweep();
  assert(fake.dodoCancels().includes(ok.sub));
  assert(fake.dodoCancels().includes(failing.sub));
  assertEquals((await entitlement(ok.user.id))?.cancel_pending, false);
  assertEquals((await entitlement(failing.user.id))?.cancel_pending, true);
  assertEquals(fake.alerts().filter((a) => a.subject.includes('Cancel this subscription')).length, 0, 'no hourly re-alert');
});

itest('S6b: a cancel still failing two days after the refund is handed to the owner once a day (P3)', async () => {
  fake.install();
  const stuck = await payer(10 * HOUR);
  await putEntitlement({ user_id: stuck.user.id, status: 'revoked', dodo_subscription_id: stuck.sub, cancel_pending: true, updated_at: isoIn(-days(3)) });
  await db().from('rate_limit_hits').delete().eq('key', `sweep:cancel:${stuck.sub}`);
  fake.on('PATCH', HOSTS.dodo, new RegExp(`^/subscriptions/${stuck.sub}$`), () => json({ message: 'down' }, 503));

  await sweep();
  await sweep();
  const alerts = fake.alerts().filter((a) => a.subject.includes('Cancel still failing') && (a.text ?? '').includes(stuck.sub));
  assertEquals(alerts.length, 1);
});

itest('S7: an active row past its grace is healed if Dodo says it renewed, and expired if not (P1-8)', async () => {
  fake.install();
  const renewed = await payer(400 * 24 * HOUR);
  const lapsed = await payer(400 * 24 * HOUR);
  for (const p of [renewed, lapsed]) {
    await putEntitlement({ user_id: p.user.id, status: 'active', dodo_subscription_id: p.sub, current_period_end: isoIn(-days(6)) });
  }
  const nextBilling = isoIn(days(25));
  fake.on('GET', HOSTS.dodo, new RegExp(`^/subscriptions/${renewed.sub}$`), () =>
    json({ subscription_id: renewed.sub, status: 'active', next_billing_date: nextBilling })
  );
  fake.on('GET', HOSTS.dodo, new RegExp(`^/subscriptions/${lapsed.sub}$`), () =>
    json({ subscription_id: lapsed.sub, status: 'cancelled', next_billing_date: isoIn(-days(6)) })
  );

  await sweep();
  const healed = await entitlement(renewed.user.id);
  assertEquals(healed?.status, 'active');
  assertEquals(new Date(healed!.current_period_end!).getTime(), new Date(nextBilling).getTime());
  assertEquals((await entitlement(lapsed.user.id))?.status, 'expired');
  assert(fake.alerts().some((a) => a.subject.includes('overdue active subscriptions')));
});

itest('S7b: when Dodo cannot be reached, nobody is expired that run, the owner is told, and the next run catches up (MP-3)', async () => {
  fake.install();
  await db().from('rate_limit_hits').delete().like('key', 'sweep:expiry-paused%'); // the alert's 6-hour latch
  const payerDuringOutage = await payer(400 * 24 * HOUR);
  const lapsedCancelled = await payer(400 * 24 * HOUR);
  await putEntitlement({ user_id: payerDuringOutage.user.id, status: 'active', dodo_subscription_id: payerDuringOutage.sub, current_period_end: isoIn(-days(6)) });
  await putEntitlement({ user_id: lapsedCancelled.user.id, status: 'cancelled', dodo_subscription_id: lapsedCancelled.sub, current_period_end: isoIn(-days(2)) });
  fake.on('GET', HOSTS.dodo, new RegExp(`^/subscriptions/${payerDuringOutage.sub}$`), () => json({ message: 'upstream' }, 503));

  const run = JSON.parse((await sweep()).text);
  assertEquals(run.expiryPaused, true);
  assertEquals((await entitlement(payerDuringOutage.user.id))?.status, 'active', 'a payer was expired because Dodo was down');
  assertEquals((await entitlement(lapsedCancelled.user.id))?.status, 'cancelled'); // waits an hour too
  assert(fake.alerts().some((a) => a.subject.includes('Expiry paused')));

  // Dodo answers again: it really has lapsed.
  fake.on('GET', HOSTS.dodo, new RegExp(`^/subscriptions/${payerDuringOutage.sub}$`), () =>
    json({ subscription_id: payerDuringOutage.sub, status: 'cancelled', next_billing_date: isoIn(-days(6)) })
  );
  assertEquals(JSON.parse((await sweep()).text).expiryPaused, false);
  assertEquals((await entitlement(payerDuringOutage.user.id))?.status, 'expired');
  assertEquals((await entitlement(lapsedCancelled.user.id))?.status, 'expired');
});

itest('S7c: a past_due row whose card retry went through is healed to active, not expired (MP-3)', async () => {
  fake.install();
  const p = await payer(400 * 24 * HOUR);
  await putEntitlement({ user_id: p.user.id, status: 'past_due', dodo_subscription_id: p.sub, current_period_end: isoIn(-days(2)) });
  const nextBilling = isoIn(days(28));
  fake.on('GET', HOSTS.dodo, new RegExp(`^/subscriptions/${p.sub}$`), () =>
    json({ subscription_id: p.sub, status: 'active', next_billing_date: nextBilling })
  );
  await sweep();
  const row = await entitlement(p.user.id);
  assertEquals(row?.status, 'active');
  assertEquals(new Date(row!.current_period_end!).getTime(), new Date(nextBilling).getTime());
});

itest('S7d: more than 50 overdue rows are all reconciled in one run (MP-3)', async () => {
  fake.install();
  const payers = [];
  for (let i = 0; i < 60; i++) {
    const p = await payer(400 * 24 * HOUR);
    await putEntitlement({ user_id: p.user.id, status: 'active', dodo_subscription_id: p.sub, current_period_end: isoIn(-days(6)) });
    payers.push(p);
  }
  const renewed = new Set(payers.map((p) => p.sub));
  fake.on('GET', HOSTS.dodo, /^\/subscriptions\/[^/]+$/, (c) => {
    const sub = c.url.pathname.split('/').at(-1)!;
    return renewed.has(sub)
      ? json({ subscription_id: sub, status: 'active', next_billing_date: isoIn(days(25)) })
      : json({ message: 'not found' }, 404);
  });
  await sweep();
  for (const p of payers) assertEquals((await entitlement(p.user.id))?.status, 'active', p.sub);
});

itest('S9: a backlog of more than 50 leads drains oldest first over successive runs — nobody is starved', async () => {
  fake.install();
  const leads = [];
  for (let i = 0; i < 55; i++) leads.push(await lead(2 * HOUR + i * 60 * 1000));
  await sweep();
  await sweep();
  for (const l of leads) assertEquals(emailsTo(l.user.email).length, 1, l.user.email);
});

itest('S10: rate-limit windows older than a day are deleted', async () => {
  fake.install();
  const key = `s10:${crypto.randomUUID()}`;
  await db().from('rate_limit_hits').insert({ key, window_start: isoIn(-days(2)), count: 3 });
  await sweep();
  const { data } = await db().from('rate_limit_hits').select('key').eq('key', key);
  assertEquals(data, []);
});

itest('S11: without UNSUBSCRIBE_SECRET the sweep skips marketing mail but still retries cancels (P3-1)', async () => {
  fake.install();
  const saved = Deno.env.get('UNSUBSCRIBE_SECRET')!;
  Deno.env.delete('UNSUBSCRIBE_SECRET');
  try {
    const { user, sessionId } = await lead(2 * HOUR);
    const refunded = await payer(10 * HOUR);
    await putEntitlement({ user_id: refunded.user.id, status: 'revoked', dodo_subscription_id: refunded.sub, cancel_pending: true });

    assertEquals((await sweep()).status, 200);
    assertEquals(emailsTo(user.email).length, 0);
    assertEquals(await stage(sessionId), 0);
    assertEquals((await entitlement(refunded.user.id))?.cancel_pending, false);
  } finally {
    Deno.env.set('UNSUBSCRIBE_SECRET', saved);
  }
});

itest('S12: retention — ad-matching data cleared after 30 days, unlinked sessions deleted after 90 (P3-18)', async () => {
  fake.install();
  const user = await createUser();
  const old = crypto.randomUUID();
  const recent = crypto.randomUUID();
  const orphanOld = crypto.randomUUID();
  const orphanRecent = crypto.randomUUID();
  const capi = { ip: '203.0.113.9', ua: 'test', fbp: 'fb.1.1.1' };
  await putFunnelSession({ id: old, user_id: user.id, capi, winback_stage: 2, created_at: isoIn(-days(31)) });
  await putFunnelSession({ id: recent, user_id: user.id, capi, winback_stage: 2, created_at: isoIn(-days(29)) });
  await putFunnelSession({ id: orphanOld, user_id: null, created_at: isoIn(-days(91)) });
  await putFunnelSession({ id: orphanRecent, user_id: null, created_at: isoIn(-days(89)) });

  await sweep();
  const rows = async (ids: string[]) =>
    (await db().from('funnel_sessions').select('id, capi, answers').in('id', ids)).data ?? [];
  const [oldRow] = await rows([old]);
  const [recentRow] = await rows([recent]);
  assertEquals(oldRow.capi, null);
  assertEquals(recentRow.capi, capi);
  assertEquals((await rows([orphanOld])).length, 0);
  assertEquals((await rows([orphanRecent])).length, 1);
});

itest('S13: a lead whose first payment failed still gets the win-back ladder; a buyer does not (P3)', async () => {
  fake.install();
  const failed = await lead(2 * HOUR);
  await putEntitlement({ user_id: failed.user.id, status: 'expired', dodo_subscription_id: newId('sub'), current_period_end: isoIn(-HOUR) });
  const bought = await lead(2 * HOUR);
  const sub = newId('sub');
  await putEntitlement({ user_id: bought.user.id, status: 'expired', dodo_subscription_id: sub, activated_subscription_id: sub, current_period_end: isoIn(-HOUR) });

  await sweep();
  assertEquals(emailsTo(failed.user.email).length, 1);
  assertEquals(emailsTo(bought.user.email).length, 0);
});

itest('S14: handoff keys past their lifetime and old webhook ids are deleted (P3)', async () => {
  fake.install();
  const user = await createUser();
  const hex = () => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const [stale, live] = [hex(), hex()];
  await db().from('handoff_keys').insert([
    { key_hash: stale, user_id: user.id, source: 'email', created_at: isoIn(-days(9)), expires_at: isoIn(-days(2)) },
    { key_hash: live, user_id: user.id, source: 'email' },
  ]);
  const oldId = `msg_${crypto.randomUUID()}`;
  const newIdMsg = `msg_${crypto.randomUUID()}`;
  await db().from('webhook_events').insert([
    { id: oldId, event_type: 'subscription.active', status: 'done', received_at: isoIn(-days(31)) },
    { id: newIdMsg, event_type: 'subscription.active', status: 'done', received_at: isoIn(-days(2)) },
  ]);

  await sweep();
  const { data: keys } = await db().from('handoff_keys').select('key_hash').eq('user_id', user.id);
  assertEquals((keys ?? []).map((k) => k.key_hash), [live]);
  const { data: events } = await db().from('webhook_events').select('id').in('id', [oldId, newIdMsg]);
  assertEquals((events ?? []).map((e) => e.id), [newIdMsg]);
});
