'use client';

// Dodo overlay checkout — keeps the buyer on kinderwell.app through payment.
//
// Why overlay and not inline: the audience is on phones. A modal gives the
// payment form the whole screen and leaves the offer page intact behind it;
// an inline frame has to share a small viewport with a long sales page.
//
// The hosted redirect stays as a FALLBACK. If the SDK fails to load or throws
// (blocked script, slow network, SDK change), we send the buyer to Dodo's
// hosted page rather than leaving them staring at a dead button. A checkout
// that works but looks less slick beats a checkout that doesn't work.

import { track } from './analytics';

type CheckoutEvent = {
  event_type?: string;
  data?: { message?: unknown };
};

let initialized = false;

/**
 * Opens the Dodo overlay. Returns false if the SDK could not be used, so the
 * caller can fall back to a plain redirect.
 */
export async function openOverlayCheckout(
  checkoutUrl: string,
  onClose: () => void
): Promise<boolean> {
  try {
    const mod = await import('dodopayments-checkout');
    const DodoPayments = mod.DodoPayments;
    if (!DodoPayments?.Checkout?.open) return false;

    if (!initialized) {
      DodoPayments.Initialize({
        // Test vs live must match the key the edge function used to CREATE
        // the session, or the overlay will not resolve it.
        mode: (process.env.NEXT_PUBLIC_DODO_ENV as 'test' | 'live') ?? 'test',
        displayType: 'overlay',
        onEvent: (event: CheckoutEvent) => {
          switch (event.event_type) {
            case 'checkout.opened':
              track('web_funnel_checkout_overlay_opened');
              break;
            case 'checkout.closed':
              // Abandonment: the buyer dismissed the modal without paying.
              // /welcome is only reached via Dodo's return_url, so this is
              // the only signal we get for it.
              track('web_funnel_checkout_abandoned');
              onClose();
              break;
            case 'checkout.error':
              track('web_funnel_error', { where: 'checkout_overlay' });
              onClose();
              break;
          }
        },
      });
      initialized = true;
    }

    DodoPayments.Checkout.open({ checkoutUrl });
    return true;
  } catch {
    // Swallowed on purpose — the caller redirects instead.
    return false;
  }
}
