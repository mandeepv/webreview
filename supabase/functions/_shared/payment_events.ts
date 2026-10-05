// Pure classification of Dodo refund/dispute events and subscription pricing
// for dodo-webhook. Tested in payment_events_test.ts.

export type RefundDisputeAction =
  /** End access and cancel the subscription. */
  | 'revoke'
  /** A partial refund: goodwill, never cut access automatically — tell the owner. */
  | 'alert_partial_refund'
  /** A dispute closed in our favour after dispute.opened already revoked — a human decides. */
  | 'alert_dispute_closed'
  /** refund.failed, dispute.challenged, …: no money moved or nothing to do. */
  | 'ignore';

const REVOKING_EVENTS = new Set(['refund.succeeded', 'dispute.opened', 'dispute.accepted', 'dispute.lost']);
const DISPUTE_CLOSED_FOR_US = new Set(['dispute.won', 'dispute.cancelled', 'dispute.expired']);

export function classifyRefundOrDispute(type: string, isPartial: boolean | undefined): RefundDisputeAction {
  if (DISPUTE_CLOSED_FOR_US.has(type)) return 'alert_dispute_closed';
  if (!REVOKING_EVENTS.has(type)) return 'ignore';
  if (type === 'refund.succeeded' && isPartial) return 'alert_partial_refund';
  return 'revoke';
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
