'use client';

// Meta Pixel wrapper. The pixel base snippet is injected in app/layout.tsx;
// this module only fires events (and stays silent when no pixel id is set).
//
// Purchase dedup: the browser-side Purchase and the server-side (CAPI, from
// the Dodo webhook) Purchase share one event_id, generated at checkout
// creation and threaded through Dodo metadata. Meta counts them once.

import { config } from './config';

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

export function pixel(
  event:
    | 'PageView'
    | 'ViewContent'
    | 'Lead'
    | 'AddToCart'
    | 'InitiateCheckout'
    | 'Purchase',
  params?: Record<string, unknown>,
  eventId?: string
): void {
  try {
    if (!config.metaPixelId || typeof window === 'undefined' || !window.fbq) return;
    window.fbq('track', event, params ?? {}, eventId ? { eventID: eventId } : undefined);
  } catch {
    // Tracking must never break the funnel.
  }
}

export function pixelCustom(event: string, params?: Record<string, unknown>): void {
  try {
    if (!config.metaPixelId || typeof window === 'undefined' || !window.fbq) return;
    window.fbq('trackCustom', event, params ?? {});
  } catch {
    /* same */
  }
}

/**
 * Manual advanced matching: re-calling init with user data is Meta's
 * documented way to attach it to every later event on the page. The pixel
 * hashes `em` itself. `external_id` is sent PRE-hashed (SHA-256 hex of the
 * Supabase user id) because the webhook's CAPI Purchase sends exactly that
 * value — the two sides must agree for it to count as a match.
 */
export async function setPixelUserData(email: string, userId: string): Promise<void> {
  try {
    if (!config.metaPixelId || typeof window === 'undefined' || !window.fbq) return;
    window.fbq('init', config.metaPixelId, {
      em: email.trim().toLowerCase(),
      external_id: await sha256Hex(userId),
    });
  } catch {
    /* same */
  }
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
