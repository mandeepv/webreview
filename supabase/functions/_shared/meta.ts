// Meta Conversions API — the server-side twin of every browser pixel event
// that matters for ad optimisation (Lead, InitiateCheckout, Purchase). Each
// is sent with the SAME event_id the browser pixel uses, so Meta keeps one of
// the pair; the server copy survives ad blockers and Safari's tracking
// limits (review P2-2). Best-effort: never throws.

export type CapiUser = {
  /** Plain email; hashed here, never sent in the clear. */
  email?: string | null;
  /** Supabase user id; hashed here (matches the browser pixel's external_id). */
  userId?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  ip?: string | null;
  ua?: string | null;
};

export type CapiEvent = {
  eventName: 'Lead' | 'InitiateCheckout' | 'Purchase';
  eventId: string;
  /** Page the event belongs to, e.g. '/email' — joined to SITE_URL. */
  sourcePath: string;
  user: CapiUser;
  customData?: Record<string, unknown>;
};

/** Sends one event. Returns false (and logs) on any failure, or when Meta isn't configured. */
export async function sendCapiEvent(e: CapiEvent): Promise<boolean> {
  const pixelId = Deno.env.get('META_PIXEL_ID');
  const token = Deno.env.get('META_CAPI_TOKEN');
  if (!pixelId || !token) return false;
  try {
    const email = e.user.email?.trim().toLowerCase();
    const testEventCode = Deno.env.get('META_TEST_EVENT_CODE');
    const site = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
    const res = await fetch(`https://graph.facebook.com/v21.0/${pixelId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: token,
        // Set ONLY while verifying in Events Manager → Test events; remove after.
        ...(testEventCode ? { test_event_code: testEventCode } : {}),
        data: [
          {
            event_name: e.eventName,
            event_time: Math.floor(Date.now() / 1000),
            event_id: e.eventId,
            action_source: 'website',
            // Limited Data Use, geolocated by Meta — matches the pixel (app/layout.tsx).
            data_processing_options: ['LDU'],
            data_processing_options_country: 0,
            data_processing_options_state: 0,
            event_source_url: `${site}${e.sourcePath}`,
            user_data: {
              ...(email ? { em: [await sha256Hex(email)] } : {}),
              ...(e.user.userId ? { external_id: [await sha256Hex(e.user.userId)] } : {}),
              ...(e.user.fbp ? { fbp: e.user.fbp } : {}),
              ...(e.user.fbc ? { fbc: e.user.fbc } : {}),
              ...(e.user.ip ? { client_ip_address: e.user.ip } : {}),
              ...(e.user.ua ? { client_user_agent: e.user.ua } : {}),
            },
            ...(e.customData ? { custom_data: e.customData } : {}),
          },
        ],
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.error(`CAPI ${e.eventName} failed`, res.status, await res.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (err) {
    console.error(`CAPI ${e.eventName} failed`, err);
    return false;
  }
}

/**
 * Runs work after the response is sent when the Supabase runtime allows it
 * (EdgeRuntime.waitUntil), so the buyer never waits on Meta. Elsewhere (the
 * tests) it simply awaits, which keeps them deterministic.
 */
export async function afterResponse(work: Promise<unknown>): Promise<void> {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  const safe = work.catch((err) => console.error('background task failed', err));
  if (runtime?.waitUntil) runtime.waitUntil(safe);
  else await safe;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
