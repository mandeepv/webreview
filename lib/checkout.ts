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
  data?: { message?: { redirect_to?: string } & Record<string, unknown> };
};

type DodoModule = typeof import('dodopayments-checkout');

let sdk: Promise<DodoModule> | null = null;

/**
 * How long the overlay may stay silent before we assume its iframe never
 * loaded (review 2026-10-07, FE-3). The SDK's overlay is a TRANSPARENT
 * full-screen iframe; if it is blocked or never loads, it still sits over
 * the page and swallows every tap — no way out but a reload. A working
 * overlay talks within a second or two (checkout.opened, checkout.resize).
 */
export const OVERLAY_WATCHDOG_MS = 15_000;

/** Starts downloading the SDK. Call on /offer mount so the first tap only waits for the session (P2-14). */
export function preloadCheckout(): void {
  sdk ??= import('dodopayments-checkout');
  sdk.catch(() => {
    sdk = null; // let a later open retry the download
  });
}

/**
 * Test vs live comes from the session URL itself (test.checkout.… vs
 * checkout.…), i.e. from the key the edge function used to CREATE it. A
 * separate env var can disagree, and then the SDK drops the overlay's
 * messages as coming from the wrong origin: the buyer pays and is never
 * redirected (P0-3).
 */
function modeFor(checkoutUrl: string): 'test' | 'live' {
  try {
    return new URL(checkoutUrl).hostname.startsWith('test.') ? 'test' : 'live';
  } catch {
    return 'live';
  }
}

/**
 * Opens the Dodo overlay. Returns false if the SDK could not be used, so the
 * caller can fall back to a plain redirect.
 *
 * `onClose` is re-bound on every call: the SDK keeps one global event
 * handler, and a handler captured by an earlier (unmounted) offer page would
 * leave the current page's button stuck on "Opening…" (P1-10).
 */
export async function openOverlayCheckout(
  checkoutUrl: string,
  onClose: (reason: 'closed' | 'error' | 'expired') => void
): Promise<boolean> {
  try {
    preloadCheckout();
    const { DodoPayments } = await sdk!;
    if (!DodoPayments?.Checkout?.open) return false;

    let failed = false;
    let heard = false;
    // Silence means the overlay never loaded: take it down and send the
    // buyer to the same checkout on Dodo's hosted page (same session, so
    // nobody can pay twice).
    const watchdog = window.setTimeout(() => {
      if (heard) return;
      track('web_funnel_error', { where: 'checkout_overlay_silent' });
      closeOverlayCheckout();
      window.location.assign(checkoutUrl);
    }, OVERLAY_WATCHDOG_MS);
    DodoPayments.Initialize({
      mode: modeFor(checkoutUrl),
      displayType: 'overlay',
      onEvent: (event: CheckoutEvent) => {
        if (!heard) {
          heard = true;
          window.clearTimeout(watchdog);
        }
        switch (event.event_type) {
          case 'checkout.opened':
            track('web_funnel_checkout_overlay_opened');
            break;
          case 'checkout.redirect': {
            // The SDK navigates itself; this is the belt to its braces in
            // case it doesn't (e.g. a future SDK change).
            const to = event.data?.message?.redirect_to;
            if (to && isOurReturnUrl(to)) window.setTimeout(() => window.location.assign(to), 1500);
            break;
          }
          case 'checkout.closed':
            // Abandonment: the buyer dismissed the modal without paying.
            // /welcome is only reached via Dodo's return_url, so this is
            // the only signal we get for it. A close after an error was
            // already counted as an error, not an abandonment.
            if (!failed) track('web_funnel_checkout_abandoned');
            onClose('closed');
            break;
          case 'checkout.error':
            failed = true;
            track('web_funnel_error', { where: 'checkout_overlay' });
            closeOverlayCheckout();
            onClose('error');
            break;
          case 'checkout.link_expired':
            // Sessions expire (24h). The page asks for a fresh one on retry.
            failed = true;
            closeOverlayCheckout();
            onClose('expired');
            break;
        }
      },
    });

    DodoPayments.Checkout.open({ checkoutUrl });
    return true;
  } catch {
    // Swallowed on purpose — the caller redirects instead.
    return false;
  }
}

/** Removes a lingering overlay, e.g. when iOS restores /offer from the back-forward cache (P1-10b). */
export function closeOverlayCheckout(): void {
  sdk
    ?.then(({ DodoPayments }) => {
      // false: no checkout.closed event, so this is not counted as an abandonment.
      if (DodoPayments.Checkout.isOpen()) DodoPayments.Checkout.close(false);
    })
    .catch(() => {});
}

function isOurReturnUrl(url: string): boolean {
  try {
    return new URL(url).origin === window.location.origin;
  } catch {
    return false;
  }
}
