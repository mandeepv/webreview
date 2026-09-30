// Shared by the edge functions that send email or accept funnel traffic.
// Supabase bundles _shared/ into each function that imports it.

/** Anything interpolated into an email's HTML goes through this. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * True when the request came through the Next.js proxy (/api/*), which is
 * where Vercel's rate limiting applies and where the caller's real IP/UA are
 * attached. The anon key is public, so without this check anyone can call the
 * function directly and skip both.
 *
 * Unset secret: allowed in TEST mode so dev keeps working, refused in LIVE
 * mode — production cannot launch with the door open by accident.
 */
export function isFromProxy(req: Request): boolean {
  const expected = Deno.env.get('FUNNEL_PROXY_SECRET');
  if (!expected) {
    const live = Deno.env.get('DODO_ENV') === 'live';
    if (live) console.error('FUNNEL_PROXY_SECRET is not set in LIVE mode — refusing request');
    return !live;
  }
  return timingSafeEqual(req.headers.get('x-funnel-proxy-key') ?? '', expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Unsubscribe tokens ───────────────────────────────────────────────────────
// HMAC of the user id, so an unsubscribe link can only opt out the person it
// was sent to. Keyed by UNSUBSCRIBE_SECRET, falling back to SWEEP_SECRET (both
// server-only) so the feature works before the dedicated secret is set.

async function hmacKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('UNSUBSCRIBE_SECRET') ?? Deno.env.get('SWEEP_SECRET');
  if (!secret) throw new Error('no UNSUBSCRIBE_SECRET or SWEEP_SECRET configured');
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

export async function unsubscribeToken(userId: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(),
    new TextEncoder().encode(`unsubscribe:${userId}`)
  );
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function verifyUnsubscribeToken(userId: string, token: string): Promise<boolean> {
  return timingSafeEqual(token, await unsubscribeToken(userId));
}

/** The link and headers every marketing email carries (CAN-SPAM + Gmail/Yahoo one-click). */
export async function unsubscribeParts(
  siteUrl: string,
  userId: string
): Promise<{ pageUrl: string; headers: Record<string, string> }> {
  const qs = `u=${encodeURIComponent(userId)}&t=${await unsubscribeToken(userId)}`;
  return {
    pageUrl: `${siteUrl}/unsubscribe?${qs}`,
    headers: {
      'List-Unsubscribe': `<${siteUrl}/api/unsubscribe?${qs}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

// ── Owner alerts ─────────────────────────────────────────────────────────────

/**
 * Emails the owner. For states a human must act on — a paying customer
 * without access, a won dispute to restore. A PostHog event nobody watches is
 * not an alarm. Best-effort: never throws.
 */
export async function alertOwner(subject: string, detail: string): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const to = Deno.env.get('ALERT_EMAIL') ?? Deno.env.get('SUPPORT_EMAIL');
  if (!apiKey || !to) {
    console.error('ALERT (no email configured):', subject, detail);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('EMAIL_FROM') ?? 'Kinderwell <hello@example.com>',
        to: [to],
        subject: `[Kinderwell alert] ${subject}`,
        text: detail,
      }),
    });
    if (!res.ok) console.error('alert email failed', res.status);
  } catch (err) {
    console.error('alert email failed', err);
  }
}
