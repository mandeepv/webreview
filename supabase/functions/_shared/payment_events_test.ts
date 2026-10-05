import { assertEquals } from 'jsr:@std/assert@1';
import { classifyRefundOrDispute, describePlan } from './payment_events.ts';

Deno.test('full refund and losing disputes revoke', () => {
  for (const t of ['refund.succeeded', 'dispute.opened', 'dispute.accepted', 'dispute.lost']) {
    assertEquals(classifyRefundOrDispute(t, false), 'revoke', t);
  }
});

Deno.test('partial refund alerts instead of revoking', () => {
  assertEquals(classifyRefundOrDispute('refund.succeeded', true), 'alert_partial_refund');
});

Deno.test('disputes closed for us alert (P3-15)', () => {
  for (const t of ['dispute.won', 'dispute.cancelled', 'dispute.expired']) {
    assertEquals(classifyRefundOrDispute(t, undefined), 'alert_dispute_closed', t);
  }
});

Deno.test('refund.failed and dispute.challenged do nothing', () => {
  assertEquals(classifyRefundOrDispute('refund.failed', false), 'ignore');
  assertEquals(classifyRefundOrDispute('dispute.challenged', undefined), 'ignore');
});

const FALLBACK = { annual: 59.99, monthly: 12.99 };

Deno.test('plan comes from the charged amount, not the fallback (P1-11)', () => {
  const p = describePlan({ recurring_pre_tax_amount: 4999, currency: 'usd', payment_frequency_interval: 'Year' }, FALLBACK);
  assertEquals(p, { value: 49.99, currency: 'USD', label: 'Kinderwell Annual, $49.99 per year' });
});

Deno.test('monthly interval and tax-exclusive wording', () => {
  const p = describePlan({ recurring_pre_tax_amount: 1299, currency: 'USD', payment_frequency_interval: 'Month', tax_inclusive: false }, FALLBACK);
  assertEquals(p.label, 'Kinderwell Monthly, $12.99 per month plus applicable tax');
});

Deno.test('falls back to configured prices and metadata plan', () => {
  assertEquals(describePlan({ metadata: { plan: 'monthly' } }, FALLBACK).value, 12.99);
  assertEquals(describePlan({}, FALLBACK).value, 59.99);
});
