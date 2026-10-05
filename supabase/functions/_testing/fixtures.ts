// Builds Dodo webhook events from the fixtures in _fixtures/dodo/, changing
// only what a test needs. Each call returns a fresh deep copy.

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function load(name: string): Json {
  return JSON.parse(Deno.readTextFileSync(new URL(`../_fixtures/dodo/${name}.json`, import.meta.url)));
}

const SUBSCRIPTION_STATUS: Record<string, string> = {
  'subscription.active': 'active',
  'subscription.renewed': 'active',
  'subscription.updated': 'active',
  'subscription.plan_changed': 'active',
  'subscription.past_due': 'past_due',
  'subscription.on_hold': 'on_hold',
  'subscription.cancelled': 'cancelled',
  'subscription.expired': 'expired',
  'subscription.failed': 'failed',
};

export const newId = (prefix: string) => `${prefix}_T${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

export type SubscriptionOpts = {
  userId?: string | null;
  subscriptionId: string;
  nextBillingDate?: string | null;
  sessionId?: string;
  eventId?: string;
  customerEmail?: string;
  plan?: 'annual' | 'monthly';
  amount?: number;
  /** Dodo's envelope timestamp (when the event happened). */
  occurredAt?: string;
};

export function subscriptionEvent(type: string, o: SubscriptionOpts): Json {
  const e = load('subscription.active');
  e.type = type;
  const d = e.data;
  d.status = SUBSCRIPTION_STATUS[type] ?? d.status;
  d.subscription_id = o.subscriptionId;
  if (o.nextBillingDate !== undefined) {
    if (o.nextBillingDate === null) delete d.next_billing_date;
    else d.next_billing_date = o.nextBillingDate;
  }
  if (o.userId === null) delete d.metadata.supabase_user_id;
  else if (o.userId) d.metadata.supabase_user_id = o.userId;
  if (o.sessionId) d.metadata.funnel_session_id = o.sessionId;
  if (o.eventId) d.metadata.event_id = o.eventId;
  if (o.plan) d.metadata.plan = o.plan;
  if (o.plan === 'monthly') {
    d.payment_frequency_interval = 'Month';
    d.recurring_pre_tax_amount = 1299;
    d.product_id = 'pdt_TEST_MONTHLY';
  }
  if (o.amount !== undefined) d.recurring_pre_tax_amount = o.amount;
  if (o.customerEmail) d.customer.email = o.customerEmail;
  if (o.occurredAt) e.timestamp = o.occurredAt;
  return e;
}

export function paymentEvent(type: string, o: { paymentId: string; subscriptionId: string; userId?: string }): Json {
  const e = load('payment.succeeded');
  e.type = type;
  e.data.payment_id = o.paymentId;
  e.data.subscription_id = o.subscriptionId;
  e.data.subscription_ids = [o.subscriptionId];
  if (o.userId) e.data.metadata.supabase_user_id = o.userId;
  return e;
}

export function refundEvent(type: string, o: { paymentId: string; isPartial?: boolean }): Json {
  const e = load('refund.succeeded');
  e.type = type;
  e.data.payment_id = o.paymentId;
  e.data.refund_id = newId('ref');
  e.data.is_partial = o.isPartial ?? false;
  e.data.status = type === 'refund.failed' ? 'failed' : 'succeeded';
  return e;
}

export function disputeEvent(type: string, o: { paymentId: string }): Json {
  const e = load('dispute.opened');
  e.type = type;
  e.data.payment_id = o.paymentId;
  e.data.dispute_id = newId('dsp');
  e.data.dispute_status = `dispute_${type.split('.')[1]}`;
  return e;
}

/** The GET /payments/{id} response, linked to a subscription (or to none). */
export function paymentResponse(o: { paymentId: string; subscriptionId: string | null }): Json {
  const p = load('payments.get');
  p.payment_id = o.paymentId;
  p.subscription_id = o.subscriptionId;
  p.subscription_ids = o.subscriptionId ? [o.subscriptionId] : [];
  return p;
}

/** The GET /products/{id} response, priced in cents. */
export function productResponse(o: { productId: string; cents: number; currency?: string }): Json {
  const p = load('products.get');
  p.product_id = o.productId;
  p.price.price = o.cents;
  if (o.currency) p.price.currency = o.currency;
  return p;
}
