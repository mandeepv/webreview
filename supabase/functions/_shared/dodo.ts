// Dodo Payments API calls shared by dodo-webhook and winback-sweep.

import { alertOwner } from './email.ts';

export const DODO_BASE =
  (Deno.env.get('DODO_ENV') ?? 'test') === 'live'
    ? 'https://live.dodopayments.com'
    : 'https://test.dodopayments.com';

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${Deno.env.get('DODO_API_KEY')}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Cancels a Dodo subscription so the customer is not billed again. NEVER
 * throws: by the time this runs, access has usually been revoked already, and
 * a throw would make the webhook retry skip the cancel (P1-3c). Returns true
 * only when Dodo confirmed. On failure the owner is alerted when `alert` is
 * set; callers track the retry via entitlements.cancel_pending.
 */
export async function cancelDodoSubscription(
  subscriptionId: string,
  reason: string,
  { alert = true }: { alert?: boolean } = {}
): Promise<boolean> {
  let detail: string;
  try {
    const res = await fetch(`${DODO_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ status: 'cancelled' }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return true;
    detail = `${res.status}: ${await res.text().catch(() => '')}`;
  } catch (err) {
    detail = `network error: ${err instanceof Error ? err.message : String(err)}`;
  }
  console.error('dodo cancel failed', subscriptionId, detail);
  if (alert) {
    await alertOwner(
      'Cancel this subscription manually',
      `After ${reason}, cancelling Dodo subscription ${subscriptionId} failed (${detail}).\n` +
        `The hourly sweep will keep retrying, but cancel it in the Dodo dashboard so the ` +
        `customer is not billed again.`
    );
  }
  return false;
}

/** Recurring price of a product in major units (e.g. 59.99), or null if it can't be read. */
export async function fetchProductPrice(productId: string): Promise<{ amount: number; currency: string } | null> {
  try {
    const res = await fetch(`${DODO_BASE}/products/${encodeURIComponent(productId)}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const product = (await res.json()) as { price?: { price?: number; currency?: string; discount_bps?: number } };
    const cents = product.price?.price;
    if (typeof cents !== 'number') return null;
    const discounted = cents * (1 - (product.price?.discount_bps ?? 0) / 10_000);
    return { amount: Math.round(discounted) / 100, currency: (product.price?.currency ?? 'USD').toUpperCase() };
  } catch {
    return null;
  }
}

export type DodoSubscription = {
  subscription_id?: string;
  status?: string;
  next_billing_date?: string;
};

/** GET /subscriptions/{id}. Returns null on any failure — callers treat that as "unknown". */
export async function fetchDodoSubscription(subscriptionId: string): Promise<DodoSubscription | null> {
  try {
    const res = await fetch(`${DODO_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as DodoSubscription;
  } catch {
    return null;
  }
}
