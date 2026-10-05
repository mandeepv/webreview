// Small pure helpers shared by pages; unit-tested in lib/*.test.ts.

export type PaymentState = 'confirmed' | 'processing' | 'failed' | 'unknown';

/** Dodo's ?status= on return_url → what /welcome may claim. Only active|succeeded is a confirmed payment. */
export function paymentStateFrom(status: string | null): PaymentState {
  if (!status) return 'unknown';
  if (status === 'active' || status === 'succeeded') return 'confirmed';
  if (status === 'pending' || status === 'processing' || status === 'requires_customer_action') {
    return 'processing';
  }
  return 'failed';
}

/** Instagram / Facebook in-app browsers, where Apple Pay on the web is unavailable. */
export function isInAppBrowser(ua: string): boolean {
  return /FBAN|FBAV|FB_IAB|Instagram/i.test(ua);
}
