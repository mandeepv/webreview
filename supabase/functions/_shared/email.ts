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
 * Fails CLOSED: an unset secret refuses every request, whatever DODO_ENV
 * says — a forgotten or mistyped DODO_ENV must not open the door (P2-15).
 * Local development opts out explicitly with ALLOW_UNAUTHENTICATED_FUNNEL=1.
 */
export function isFromProxy(req: Request): boolean {
  const expected = Deno.env.get('FUNNEL_PROXY_SECRET');
  if (!expected) {
    if (Deno.env.get('ALLOW_UNAUTHENTICATED_FUNNEL') === '1') return true;
    console.error('FUNNEL_PROXY_SECRET is not set — refusing request');
    return false;
  }
  return timingSafeEqual(req.headers.get('x-funnel-proxy-key') ?? '', expected);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Signed tokens (unsubscribe + resume links) ──────────────────────────────
// HMACs keyed by UNSUBSCRIBE_SECRET — required, with NO fallback. It used to
// fall back to SWEEP_SECRET, so one leaked secret would have let someone both
// trigger the sweep and forge opt-outs or resume links for named users
// (review P3-1, and what made P2-16's exposed user ids matter).

/** True when links can be signed. Callers degrade instead of failing when it isn't. */
export function signingConfigured(): boolean {
  return !!Deno.env.get('UNSUBSCRIBE_SECRET');
}

async function hmacKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('UNSUBSCRIBE_SECRET');
  if (!secret) throw new Error('UNSUBSCRIBE_SECRET is not set');
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

/** base64url HMAC-SHA256 of `message`. */
async function sign(message: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(), new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Unsubscribe token: an HMAC of the user id, so a link can only opt out the person it was sent to. */
export function unsubscribeToken(userId: string): Promise<string> {
  return sign(`unsubscribe:${userId}`);
}

export async function verifyUnsubscribeToken(userId: string, token: string): Promise<boolean> {
  return timingSafeEqual(token, await unsubscribeToken(userId));
}

const RESUME_TTL_SECONDS = 30 * 24 * 3600;

/**
 * Resume token for a funnel session: `<sessionId>.<expiry>.<sig>`. Lets a
 * win-back email (or an "open in Safari" link) rebuild the session in a
 * browser that never saw the quiz (review P1-6). It reveals that session's
 * answers and email, so it only ever goes to that email's inbox or to the
 * device that already holds the session.
 */
export async function resumeToken(sessionId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + RESUME_TTL_SECONDS;
  return `${sessionId}.${exp}.${await sign(`resume:${sessionId}:${exp}`)}`;
}

/** The session id a valid, unexpired resume token names; null otherwise. */
export async function verifyResumeToken(token: string): Promise<string | null> {
  const [sessionId, expRaw, sig] = token.split('.');
  const exp = Number(expRaw);
  if (!sessionId || !sig || !Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
  return timingSafeEqual(sig, await sign(`resume:${sessionId}:${exp}`)) ? sessionId : null;
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
