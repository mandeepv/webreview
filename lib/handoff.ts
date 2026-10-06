'use client';

// SPEC-21 purchase handoff, browser side (~/mamalearn/docs/specs/
// SPEC-21-purchase-handoff.md). A buyer should open the app already signed in:
//
//   /offer    makes a browser-only nonce and sends it with create-checkout,
//             which stores its sha256 on the funnel session;
//   /welcome  proves it is the same browser (sessionId + nonce) to
//             mint-handoff and gets a one-time sign-in link back;
//   the "Get Kinderwell" tap copies that link, then opens the App Store; on
//   first launch the app offers to paste it and redeems it.
//
// The link is a LOGIN CREDENTIAL. It lives in memory only (never in storage,
// never in a URL of a page that runs analytics, never in an analytics event),
// and nothing here logs it. The nonce is not a credential on its own; it is
// kept in localStorage because /welcome is a fresh page load after checkout.

/** Same host and key shape as the server's (supabase/functions/_shared/handoff.ts). */
export const HANDOFF_LINK_RE = /^https:\/\/open\.kinderwell\.app\/k\/[A-Za-z0-9_-]{43}$/;
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;

const PROOF_KEY = 'kw_handoff';

export type HandoffProof = { sessionId: string; nonce: string };

/** 32 random bytes, base64url without padding: the same shape as a handoff key. */
function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** The proof /welcome will present, if this browser kept one. */
export function readProof(): HandoffProof | null {
  try {
    const raw = localStorage.getItem(PROOF_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<HandoffProof>;
    return typeof p.sessionId === 'string' && typeof p.nonce === 'string' && KEY_RE.test(p.nonce)
      ? { sessionId: p.sessionId, nonce: p.nonce }
      : null;
  } catch {
    return null;
  }
}

/**
 * The nonce to send with create-checkout: one per funnel session, so a second
 * tap (or the reused checkout) sends the same one. It is deliberately NOT
 * cleared by resetSession() — /welcome needs it after the funnel session is
 * gone, including on a refresh. Null when storage is blocked: /welcome
 * couldn't present it after the redirect anyway, and the email link still works.
 */
export function nonceForCheckout(sessionId: string): string | null {
  const stored = readProof();
  if (stored?.sessionId === sessionId) return stored.nonce;
  const proof: HandoffProof = { sessionId, nonce: randomKey() };
  try {
    localStorage.setItem(PROOF_KEY, JSON.stringify(proof));
  } catch {
    return null;
  }
  return readProof()?.nonce === proof.nonce ? proof.nonce : null;
}

export type MintResult = { link: string } | { error: string };

/**
 * Pauses between tries while the webhook lands (it writes the purchase the
 * page proves itself against). About a minute in all; after that the buyer
 * still has the email's link and the email code.
 */
export const RETRY_DELAYS_MS = [1500, 2000, 3000, 4000, 5000, 6000, 8000, 10_000, 10_000, 10_000];

/**
 * Asks mint-handoff for a sign-in link, retrying only "not yet" (409) and
 * server or network failures. Every other refusal is final.
 */
export async function fetchHandoffLink(
  proof: HandoffProof,
  deps: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}
): Promise<MintResult> {
  const doFetch = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    let error: string;
    let retry: boolean;
    try {
      const res = await doFetch('/api/mint-handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proof),
        cache: 'no-store',
        signal: AbortSignal.timeout(25_000),
      });
      const body = (await res.json().catch(() => ({}))) as { link?: unknown; error?: unknown };
      if (res.ok) {
        // Anything else on the clipboard would only confuse the app's paste screen.
        return typeof body.link === 'string' && HANDOFF_LINK_RE.test(body.link)
          ? { link: body.link }
          : { error: 'bad_link' };
      }
      error = typeof body.error === 'string' ? body.error : `http_${res.status}`;
      retry = res.status === 409 || res.status >= 500;
    } catch {
      error = 'network';
      retry = true;
    }
    if (!retry || attempt >= RETRY_DELAYS_MS.length) return { error };
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
}

/**
 * Starts writing the sign-in link to the clipboard. MUST be called
 * synchronously inside the tap handler: iOS lets a page write the clipboard
 * only during the user's gesture, so nothing may be awaited before this.
 *
 * With the link still on its way, a ClipboardItem whose content is a promise
 * starts the write inside the gesture and fills it in when the link arrives
 * (WebKit's documented pattern for exactly this). Resolves to whether the
 * link was copied; never rejects.
 */
export function startCopy(
  link: string | Promise<string | null>,
  clipboard: Clipboard | undefined = typeof navigator === 'undefined' ? undefined : navigator.clipboard
): Promise<boolean> {
  try {
    if (!clipboard) return Promise.resolve(false);
    if (typeof link === 'string') return clipboard.writeText(link).then(() => true, () => false);
    if (typeof ClipboardItem === 'undefined' || !clipboard.write) return Promise.resolve(false);
    const blob = link.then((l) => {
      if (!l) throw new Error('no link');
      return new Blob([l], { type: 'text/plain' });
    });
    return clipboard.write([new ClipboardItem({ 'text/plain': blob })]).then(() => true, () => false);
  } catch {
    return Promise.resolve(false);
  }
}

/** `promise`, or `fallback` once `ms` have passed — whichever comes first. */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}
