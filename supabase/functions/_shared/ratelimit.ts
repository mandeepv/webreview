// Per-key fixed-window limits backed by public.hit_rate_limit() (review P1-7).
// The Vercel firewall rule is the first line; this one can't be switched off
// by forgetting a dashboard setting.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type Limit = { key: string; windowSeconds: number; max: number };

/**
 * True when ANY of the limits is exceeded. Fails OPEN on a database error:
 * a rate-limiter hiccup must not take the funnel down with it.
 */
export async function isRateLimited(admin: SupabaseClient, limits: Limit[]): Promise<boolean> {
  const results = await Promise.all(
    limits
      .filter((l) => l.key && !l.key.endsWith(':'))
      .map(async (l) => {
        const { data, error } = await admin.rpc('hit_rate_limit', {
          p_key: l.key,
          p_window_seconds: l.windowSeconds,
          p_max: l.max,
        });
        if (error) {
          console.error('rate limit check failed (allowing)', l.key, error.message);
          return false;
        }
        return data === false;
      })
  );
  return results.some(Boolean);
}

/**
 * The rate-limit bucket for a client address: IPv4 as it is, IPv6 by its
 * /64. Mobile carriers give each phone a whole /64, so a key per IPv6
 * address handed one person 2^64 fresh buckets (review 2026-10-07, IN-7).
 * Anything that doesn't parse as plain IPv6 is kept as it is.
 */
export function ipBucket(ip: string | null | undefined): string {
  const v = (ip ?? '').trim().toLowerCase();
  if (!v.includes(':') || v.includes('.')) return v; // IPv4, v4-mapped, or not an address
  const parts = v.split('::');
  if (parts.length > 2) return v;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const groups =
    parts.length === 2 ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail] : head;
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return v;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
