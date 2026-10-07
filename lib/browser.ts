// Small pure helpers shared by pages; unit-tested in lib/*.test.ts.

export type PaymentState = 'confirmed' | 'processing' | 'failed' | 'unknown';

const PROCESSING = new Set([
  'pending',
  'processing',
  'requires_customer_action',
  'requires_merchant_action',
  'requires_confirmation',
  'requires_capture',
]);
const FAILED = new Set(['failed', 'cancelled', 'expired', 'requires_payment_method']);

/**
 * Dodo's ?status= on return_url → what /welcome may claim. Only
 * active|succeeded is a confirmed payment; only a status that means the
 * payment did not happen is 'failed' ("You haven't been charged"). Anything
 * else — a status Dodo adds later, a typo — is 'unknown', which claims
 * neither (review 2026-10-07, FE-8: it used to tell such buyers they had
 * not been charged).
 */
export function paymentStateFrom(status: string | null): PaymentState {
  if (!status) return 'unknown';
  if (status === 'active' || status === 'succeeded') return 'confirmed';
  if (PROCESSING.has(status)) return 'processing';
  if (FAILED.has(status)) return 'failed';
  return 'unknown';
}

/**
 * Instagram / Facebook / Threads in-app browsers, where Apple Pay on the web
 * is unavailable. Threads' in-app browser identifies as "Barcelona" (its
 * codename), not "Threads".
 */
export function isInAppBrowser(ua: string): boolean {
  return /FBAN|FBAV|FB_IAB|Instagram|Barcelona/i.test(ua);
}
