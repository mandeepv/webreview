// deno test --node-modules-dir=none supabase/functions/_shared/
import { assertEquals } from 'jsr:@std/assert@1';
import { CurrentRow, decideSubscriptionWrite, hasAccess, IncomingEvent, laterOf, PAST_DUE_GRACE_MS } from './entitlement.ts';

const NOW = new Date('2026-10-01T12:00:00Z');
const FUTURE = '2027-10-01T12:00:00.000Z';
const LATER = '2027-11-01T12:00:00.000Z';
const PAST = '2026-09-01T12:00:00.000Z';

function row(status: string, sub: string | null, end: string | null): CurrentRow {
  return { status, dodo_subscription_id: sub, current_period_end: end };
}
function ev(type: string, sub: string | null, next: string | null = FUTURE, plan = 'annual'): IncomingEvent {
  return { type: `subscription.${type}`, subscriptionId: sub, nextBillingDate: next, plan };
}

Deno.test('first purchase with no row writes active', () => {
  const d = decideSubscriptionWrite(null, ev('active', 'sub_A'), NOW);
  assertEquals(d, { kind: 'write', status: 'active', currentPeriodEnd: FUTURE, replacesSubscription: false, periodEndFallback: null });
});

Deno.test('first-purchase burst in any order yields active each time', () => {
  // renewed / updated arriving before active must still write active; the
  // exactly-once side effects are claimed separately (activated_subscription_id).
  for (const type of ['renewed', 'active', 'plan_changed']) {
    const d = decideSubscriptionWrite(row('active', 'sub_A', FUTURE), ev(type, 'sub_A'), NOW);
    assertEquals(d.kind === 'write' && d.status, 'active');
  }
});

Deno.test('unknown event types are ignored', () => {
  assertEquals(decideSubscriptionWrite(null, ev('updated', 'sub_A'), NOW).kind, 'ignore');
});

Deno.test('P0-1: revoked row ignores late events for the same subscription', () => {
  for (const type of ['active', 'renewed', 'cancelled', 'expired']) {
    assertEquals(decideSubscriptionWrite(row('revoked', 'sub_A', FUTURE), ev(type, 'sub_A'), NOW).kind, 'ignore');
  }
});

Deno.test('P0-1: refunded customer who buys again gets access', () => {
  const d = decideSubscriptionWrite(row('revoked', 'sub_A', FUTURE), ev('active', 'sub_B'), NOW);
  assertEquals(d, { kind: 'write', status: 'active', currentPeriodEnd: FUTURE, replacesSubscription: true, periodEndFallback: null });
});

Deno.test('P0-1: renewed as the first event of a re-purchase also activates', () => {
  const d = decideSubscriptionWrite(row('revoked', 'sub_A', FUTURE), ev('renewed', 'sub_B'), NOW);
  assertEquals(d.kind === 'write' && d.status, 'active');
});

Deno.test('P1-3: late expired/cancelled for an OLD subscription does not touch the new one', () => {
  for (const type of ['expired', 'cancelled', 'on_hold', 'past_due', 'failed']) {
    const d = decideSubscriptionWrite(row('active', 'sub_B', FUTURE), ev(type, 'sub_A', PAST), NOW);
    assertEquals(d.kind, 'ignore', type);
  }
});

Deno.test('P1-3: re-purchase after the old subscription expired replaces it', () => {
  const d = decideSubscriptionWrite(row('expired', 'sub_A', PAST), ev('active', 'sub_B'), NOW);
  assertEquals(d.kind === 'write' && d.replacesSubscription, true);
});

Deno.test('P1-3b: second live subscription while the first is entitled is a duplicate', () => {
  for (const status of ['active', 'past_due', 'cancelled']) {
    const d = decideSubscriptionWrite(row(status, 'sub_A', FUTURE), ev('active', 'sub_B'), NOW);
    assertEquals(d.kind, 'duplicate', status);
  }
});

Deno.test('P1-3b: a cancelled subscription whose period ended is not a duplicate', () => {
  const d = decideSubscriptionWrite(row('cancelled', 'sub_A', PAST), ev('active', 'sub_B'), NOW);
  assertEquals(d.kind, 'write');
});

Deno.test('P1-4: missing next_billing_date on activation falls back to plan length', () => {
  const annual = decideSubscriptionWrite(null, ev('active', 'sub_A', null, 'annual'), NOW);
  assertEquals(annual.kind === 'write' && annual.currentPeriodEnd, '2027-10-01T12:00:00.000Z');
  assertEquals(annual.kind === 'write' && annual.periodEndFallback, '2027-10-01T12:00:00.000Z');
  const monthly = decideSubscriptionWrite(null, ev('active', 'sub_A', null, 'monthly'), NOW);
  assertEquals(monthly.kind === 'write' && monthly.currentPeriodEnd, '2026-11-01T12:00:00.000Z');
});

Deno.test('P1-4: missing next_billing_date keeps a future period end already on file', () => {
  const d = decideSubscriptionWrite(row('active', 'sub_A', LATER), ev('renewed', 'sub_A', null), NOW);
  assertEquals(d.kind === 'write' && d.currentPeriodEnd, LATER);
});

Deno.test('P2-3c: on_hold never shortens access and grants a retry grace', () => {
  // Existing end in the future is kept even if Dodo sends today's date.
  const kept = decideSubscriptionWrite(row('active', 'sub_A', FUTURE), ev('on_hold', 'sub_A', NOW.toISOString()), NOW);
  assertEquals(kept, { kind: 'write', status: 'past_due', currentPeriodEnd: FUTURE, replacesSubscription: false, periodEndFallback: null });
  // Period already over: grace from now.
  const grace = decideSubscriptionWrite(row('active', 'sub_A', PAST), ev('on_hold', 'sub_A', PAST), NOW);
  assertEquals(grace.kind === 'write' && grace.currentPeriodEnd, new Date(NOW.getTime() + PAST_DUE_GRACE_MS).toISOString());
});

Deno.test('cancelled keeps access to the later of existing and incoming period end', () => {
  const d = decideSubscriptionWrite(row('active', 'sub_A', LATER), ev('cancelled', 'sub_A', FUTURE), NOW);
  assertEquals(d.kind === 'write' && d.currentPeriodEnd, LATER);
});

Deno.test('expired writes expired', () => {
  const d = decideSubscriptionWrite(row('cancelled', 'sub_A', PAST), ev('expired', 'sub_A', null), NOW);
  assertEquals(d, { kind: 'write', status: 'expired', currentPeriodEnd: PAST, replacesSubscription: false, periodEndFallback: null });
});

Deno.test('hasAccess: the access rule the app, checkout and resume share', () => {
  const at = (status: string, end: string | null) => hasAccess({ status, current_period_end: end }, NOW);
  assertEquals(at('active', FUTURE), true);
  assertEquals(at('past_due', FUTURE), true);
  assertEquals(at('cancelled', FUTURE), true); // paid for — keeps access until period end
  assertEquals(at('active', PAST), false);
  assertEquals(at('cancelled', PAST), false);
  assertEquals(at('revoked', FUTURE), false); // refund/chargeback: never
  assertEquals(at('expired', FUTURE), false);
  assertEquals(at('active', null), false);
  assertEquals(hasAccess(null, NOW), false);
  assertEquals(hasAccess(undefined, NOW), false);
});

Deno.test('P2-17: an older event for the same subscription is ignored once a newer one was applied', () => {
  const current = { ...row('expired', 'sub_A', PAST)!, last_event_at: '2026-10-01T10:00:00Z' };
  const late = { ...ev('renewed', 'sub_A', FUTURE), occurredAt: '2026-09-30T10:00:00Z' };
  assertEquals(decideSubscriptionWrite(current, late, NOW).kind, 'ignore');
});

Deno.test('P2-17: a newer event, an event at the same instant, or one without a timestamp still applies', () => {
  const current = { ...row('past_due', 'sub_A', FUTURE)!, last_event_at: '2026-10-01T10:00:00Z' };
  for (const occurredAt of ['2026-10-01T11:00:00Z', '2026-10-01T10:00:00Z', null]) {
    assertEquals(decideSubscriptionWrite(current, { ...ev('renewed', 'sub_A', LATER), occurredAt }, NOW).kind, 'write', String(occurredAt));
  }
});

Deno.test('P2-17: ordering only compares events of the SAME subscription — a new purchase is never "older"', () => {
  const current = { ...row('expired', 'sub_A', PAST)!, last_event_at: '2026-10-01T10:00:00Z' };
  const newPurchase = { ...ev('active', 'sub_B', FUTURE), occurredAt: '2026-09-01T10:00:00Z' };
  assertEquals(decideSubscriptionWrite(current, newPurchase, NOW).kind, 'write');
});

Deno.test('laterOf picks the later timestamp and tolerates missing ones', () => {
  assertEquals(laterOf('2026-10-01T10:00:00Z', '2026-10-02T10:00:00Z'), '2026-10-02T10:00:00Z');
  assertEquals(laterOf(null, '2026-10-02T10:00:00Z'), '2026-10-02T10:00:00Z');
  assertEquals(laterOf('2026-10-01T10:00:00Z', undefined), '2026-10-01T10:00:00Z');
  assertEquals(laterOf(null, null), null);
});
