import { assertEquals } from 'jsr:@std/assert@1';
import { classifyRefundOrDispute, describePlan, refundedExtent, refundRevokes } from './payment_events.ts';

Deno.test('full refund and losing disputes revoke', () => {
  for (const t of ['refund.succeeded', 'dispute.opened', 'dispute.accepted', 'dispute.lost']) {
    assertEquals(classifyRefundOrDispute(t, false), 'revoke', t);
  }
});

Deno.test('a refund flagged partial, or not flagged, is decided by the refunded total (MP-4)', () => {
  assertEquals(classifyRefundOrDispute('refund.succeeded', true), 'check_refund_total');
  assertEquals(classifyRefundOrDispute('refund.succeeded', undefined), 'check_refund_total');
});

Deno.test('refundedExtent adds up the refunds that went through', () => {
  const pay = (refunds: unknown, total: unknown = 5999) => ({ total_amount: total, refunds });
  assertEquals(refundedExtent(pay([])), 'partial');
  assertEquals(refundedExtent(pay([{ amount: 3000, status: 'succeeded' }])), 'partial');
  // Two partials that add up to the whole payment.
  assertEquals(refundedExtent(pay([{ amount: 3000, status: 'succeeded' }, { amount: 2999, status: 'succeeded' }])), 'full');
  assertEquals(refundedExtent(pay([{ amount: 5999 }])), 'full'); // no status: counted
  // A failed or pending refund gave nothing back.
  assertEquals(refundedExtent(pay([{ amount: 3000, status: 'succeeded' }, { amount: 2999, status: 'failed' }])), 'partial');
  assertEquals(refundedExtent(pay([{ amount: 5999, status: 'pending' }])), 'partial');
});

Deno.test('refundedExtent is unknown, never partial, when the payment lacks the fields', () => {
  assertEquals(refundedExtent(null), 'unknown');
  assertEquals(refundedExtent({ refunds: [] }), 'unknown');
  assertEquals(refundedExtent({ total_amount: 5999 }), 'unknown');
  assertEquals(refundedExtent({ total_amount: '5999', refunds: [] }), 'unknown');
  assertEquals(refundedExtent({ total_amount: 0, refunds: [] }), 'unknown');
});

Deno.test('refundRevokes: partials keep access until they add up; an unflagged refund revokes unless shown partial', () => {
  assertEquals(refundRevokes(true, 'partial'), false);
  assertEquals(refundRevokes(true, 'full'), true);
  assertEquals(refundRevokes(true, 'unknown'), false); // flagged partial and nothing says otherwise
  assertEquals(refundRevokes(undefined, 'partial'), false); // goodwill, as the payment shows
  assertEquals(refundRevokes(undefined, 'full'), true);
  assertEquals(refundRevokes(undefined, 'unknown'), true); // can't tell: stop the billing, tell the owner
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
