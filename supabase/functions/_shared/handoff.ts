// SPEC-21 purchase handoff (~/mamalearn/docs/specs/SPEC-21-purchase-handoff.md):
// the website hands a buyer a one-time key, and the app's redeem-handoff
// function (app repo) swaps it for a sign-in, so the buyer opens the app
// already signed in instead of following sign-in instructions.
//
// A handoff key is a LOGIN CREDENTIAL (app INVARIANTS #29): whoever holds it
// gets a session for its user. So only its sha256 is stored (handoff_keys,
// service role only), it is single use and lives 7 days at most (the table
// enforces both), and it is never logged: not here, not by any caller.
//
// THE FORMAT IS A CONTRACT with the app's link parser, its redeem-handoff
// function and its E2E seed (scripts/e2e/seed.mjs create-handoff-key):
// 32 random bytes as base64url without padding (43 characters), stored as
// the lowercase hex sha256 of the key's UTF-8 string. Change it in all of
// them the same day, or not at all.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { timingSafeEqual } from './email.ts';
import { hasAccess } from './entitlement.ts';

/**
 * The universal link. The host must match the app's associatedDomains
 * (applinks:open.kinderwell.app) and the AASA file the site serves there.
 * The link page's own "Open Kinderwell" uses the same key on kinderwell.app
 * (another host, so iOS opens the app; see lib/link-page.ts).
 */
export const HANDOFF_LINK_BASE = 'https://open.kinderwell.app/k/';

/** A handoff key, and also the browser nonce (same shape: 32 random bytes, base64url). */
export const KEY_RE = /^[A-Za-z0-9_-]{43}$/;

/** How long after the purchase the welcome page may still mint keys. */
export const MINT_WINDOW_MS = 24 * 3600 * 1000;

export function newHandoffKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function handoffLink(key: string): string {
  return HANDOFF_LINK_BASE + key;
}

/**
 * Stores a new key for `userId` and returns its link, or null when the
 * insert fails (callers fall back to the email-code sign-in). Expiry is the
 * table's default, 7 days.
 */
export async function mintHandoffKey(
  admin: SupabaseClient,
  userId: string,
  source: 'welcome' | 'email'
): Promise<string | null> {
  const key = newHandoffKey();
  const { error } = await admin
    .from('handoff_keys')
    .insert({ key_hash: await sha256Hex(key), user_id: userId, source });
  if (error) {
    // The message only: never the key, and the row's values stay out of logs too.
    console.error('handoff key insert failed', source, error.message);
    return null;
  }
  return handoffLink(key);
}

export type MintDecision = 'ok' | 'not_found' | 'not_ready' | 'expired' | 'not_entitled';

/**
 * May this browser have a welcome-page key now? Pure, so every branch is
 * unit-tested (handoff_test.ts); mint-handoff does the I/O.
 *
 * `not_found` covers "no such session" AND "wrong nonce" alike, so the
 * answer never tells a guesser which half was right.
 */
export function decideMint(
  session: { user_id: string | null; handoff_nonce_hash: string | null; purchased_at: string | null } | null,
  nonceHash: string,
  entitlement: { status: string; current_period_end: string | null } | null,
  now: Date
): MintDecision {
  if (!session?.user_id || !session.handoff_nonce_hash) return 'not_found';
  if (!timingSafeEqual(session.handoff_nonce_hash, nonceHash)) return 'not_found';
  // purchased_at is written by dodo-webhook at first activation, after the
  // entitlement. The page usually asks before the webhook lands: retry.
  if (!session.purchased_at) return 'not_ready';
  if (now.getTime() - new Date(session.purchased_at).getTime() > MINT_WINDOW_MS) return 'expired';
  // A refund or chargeback since: no session for a buyer who no longer pays.
  if (!hasAccess(entitlement, now)) return 'not_entitled';
  return 'ok';
}
