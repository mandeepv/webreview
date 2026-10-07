// Pure classification of Dodo refund/dispute events and subscription pricing
// for dodo-webhook. Tested in payment_events_test.ts.

export type RefundDisputeAction =
  /** End access and cancel the subscription. */
  | 'revoke'
  /**
   * A refund Dodo flags as partial, or doesn't flag at all: decide from how
   * much of the payment has been refunded in total (refundedExtent) — a
   * partial refund is goodwill and keeps access, but partials can add up to
   * the whole payment (review 2026-10-07, MP-4).
   */
  | 'check_refund_total'
  /** A dispute closed in our favour after dispute.opened already revoked — a human decides. */
  | 'alert_dispute_closed'
  /** refund.failed, dispute.challenged, …: no money moved or nothing to do. */
  | 'ignore';

const REVOKING_EVENTS = new Set(['refund.succeeded', 'dispute.opened', 'dispute.accepted', 'dispute.lost']);
const DISPUTE_CLOSED_FOR_US = new Set(['dispute.won', 'dispute.cancelled', 'dispute.expired']);

export function classifyRefundOrDispute(type: string, isPartial: boolean | undefined): RefundDisputeAction {
  if (DISPUTE_CLOSED_FOR_US.has(type)) return 'alert_dispute_closed';
  if (!REVOKING_EVENTS.has(type)) return 'ignore';
  if (type === 'refund.succeeded' && isPartial !== false) return 'check_refund_total';
  return 'revoke';
}

export type RefundExtent = 'full' | 'partial' | 'unknown';

/**
 * How much of a payment has been refunded in all, from Dodo's
 * GET /payments/{id} (`total_amount` and `refunds[].amount`, both in the
 * smallest currency unit). 'unknown' when the response lacks either field —
 * these are read from Dodo's published schema, not yet from a captured
 * payload (MP-13), so a missing field must never read as "partial".
 */
export function refundedExtent(payment: { total_amount?: unknown; refunds?: unknown } | null): RefundExtent {
  if (!payment || typeof payment.total_amount !== 'number' || payment.total_amount <= 0) return 'unknown';
  if (!Array.isArray(payment.refunds)) return 'unknown';
  let refunded = 0;
  for (const r of payment.refunds as Array<{ amount?: unknown; status?: unknown }>) {
    if (!r || typeof r.amount !== 'number') continue;
    // Count refunds that went through (or carry no status at all); a failed
    // or still-pending refund has not given the money back.
    if (r.status === undefined || r.status === 'succeeded') refunded += r.amount;
  }
  return refunded >= payment.total_amount ? 'full' : 'partial';
}

/**
 * Whether a refund flagged partial (or not flagged) ends access. A flagged
 * partial revokes only once the refunds add up to the payment. An unflagged
 * one revokes unless the payment shows it was partial: when unsure, stop the
 * billing (a missed full refund is re-billed at renewal — a chargeback) and
 * let the owner restore access if it was goodwill.
 */
export function refundRevokes(isPartial: boolean | undefined, extent: RefundExtent): boolean {
  if (extent === 'full') return true;
  if (extent === 'partial') return false;
  return isPartial === undefined;
}

export type PlanSummary = { value: number; currency: string; label: string };

export type PlanFields = {
  recurring_pre_tax_amount?: number; // smallest currency unit
  currency?: string;
  tax_inclusive?: boolean;
  payment_frequency_interval?: string; // Day | Week | Month | Year
  metadata?: Record<string, string>;
};

/**
 * Price and renewal terms from the subscription payload — the amount Dodo
 * actually charges — falling back to the configured prices only when the
 * payload lacks them.
 */
export function describePlan(
  data: PlanFields,
  fallbackPrices: { annual: number; monthly: number }
): PlanSummary {
  const interval = (data.payment_frequency_interval ?? '').toLowerCase();
  const monthly = interval ? interval === 'month' : data.metadata?.plan === 'monthly';
  const value =
    typeof data.recurring_pre_tax_amount === 'number'
      ? data.recurring_pre_tax_amount / 100
      : monthly
        ? fallbackPrices.monthly
        : fallbackPrices.annual;
  const currency = (data.currency ?? 'USD').toUpperCase();
  const amount = currency === 'USD' ? `$${value.toFixed(2)}` : `${value.toFixed(2)} ${currency}`;
  const tax = data.tax_inclusive === false ? ' plus applicable tax' : '';
  return {
    value,
    currency,
    label: `Kinderwell ${monthly ? 'Monthly' : 'Annual'}, ${amount} per ${monthly ? 'month' : 'year'}${tax}`,
  };
}
