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
