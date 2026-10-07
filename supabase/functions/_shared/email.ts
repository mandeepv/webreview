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
 * Local development opts out explicitly with ALLOW_UNAUTHENTICATED_FUNNEL=1,
 * which is ignored when DODO_ENV=live.
 */
export function isFromProxy(req: Request): boolean {
  const expected = Deno.env.get('FUNNEL_PROXY_SECRET');
  if (!expected) {
    if (Deno.env.get('ALLOW_UNAUTHENTICATED_FUNNEL') === '1') {
      // Never in live mode (IN-9): a dev opt-out copied into the prod
      // secrets would open the funnel to direct calls.
      if (Deno.env.get('DODO_ENV') !== 'live') return true;
      console.error('ALLOW_UNAUTHENTICATED_FUNNEL is ignored in live mode — refusing request');
      return false;
    }
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
const RESUME_PREFIX = 'r2.';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** AES-256-GCM key for resume tokens, derived from UNSUBSCRIBE_SECRET so no new secret is needed. */
async function resumeKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('UNSUBSCRIBE_SECRET');
  if (!secret) throw new Error('UNSUBSCRIBE_SECRET is not set');
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode('kinderwell resume token v2') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Resume token for a funnel session. Lets a win-back email (or an "open in
 * Safari" link) rebuild the session in a browser that never saw the quiz
 * (review P1-6). It reveals that session's answers and email, so it only
 * ever goes to that email's inbox or to the device that already holds the
 * session.
 *
 * OPAQUE (review 2026-10-07, B-3 / IN-2): `r2.` + base64url of an AES-GCM
 * ciphertext of `<sessionId>.<expiry>`. The previous `<sessionId>.<exp>.<sig>`
 * put the session id in cleartext in every email link, in Vercel's request
 * log for /r/<token> and in mail scanners' logs, and the session id is what
 * create-checkout and resume act on. GCM authenticates as well as hides: a
 * token can't be edited to name another session or a later expiry. Tokens
 * in the old format are refused; they only ever went out from the dev
 * project, whose checkout is in test mode.
 */
export async function resumeToken(sessionId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + RESUME_TTL_SECONDS;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await resumeKey(), new TextEncoder().encode(`${sessionId}.${exp}`))
  );
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return RESUME_PREFIX + toBase64Url(out);
}

/** The session id a valid, unexpired resume token names; null otherwise. */
export async function verifyResumeToken(token: string): Promise<string | null> {
  if (!token.startsWith(RESUME_PREFIX)) return null;
  const bytes = fromBase64Url(token.slice(RESUME_PREFIX.length));
  // 12-byte IV + at least one byte of text + the 16-byte GCM tag.
  if (!bytes || bytes.length < 12 + 1 + 16) return null;
  let plain: string;
  try {
    plain = new TextDecoder().decode(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await resumeKey(), bytes.slice(12))
    );
  } catch {
    return null; // tampered, truncated or sealed with another key
  }
  const [sessionId, expRaw, extra] = plain.split('.');
  const exp = Number(expRaw);
  if (extra !== undefined || !UUID_RE.test(sessionId ?? '') || !Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
  return sessionId;
}

/** The link and headers every marketing email carries (CAN-SPAM + Gmail/Yahoo one-click). */
export async function unsubscribeParts(
  siteUrl: string,
  userId: string
): Promise<{ pageUrl: string; headers: Record<string, string> }> {
  const qs = `u=${encodeURIComponent(userId)}&t=${await unsubscribeToken(userId)}`;
  return {
    // /u, not /unsubscribe?…: the page runs the Meta pixel, which would send
    // the user id and token on (app/u/route.ts).
    pageUrl: `${siteUrl}/u?${qs}`,
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
