'use client';

// The funnel session: quiz answers + attribution, client-side in localStorage.
// It is written to the server exactly once — at email capture — because
// before that moment there is no user to attach it to and nothing to recover.

export type Answers = Record<string, string | string[] | number>;

export interface FunnelSession {
  id: string;
  answers: Answers;
  utm: Record<string, string>;
  landingVariant: string;
  emailCaptured: boolean;
  userId: string | null;
  email: string | null;
  startedAt: number;
  /** When the stored fbclid was captured — the creation time in the fbc value. */
  fbclidAt?: number;
}

const KEY = 'kw_funnel_session';

function newSession(): FunnelSession {
  return {
    id: crypto.randomUUID(),
    answers: {},
    utm: {},
    landingVariant: 'default',
    emailCaptured: false,
    userId: null,
    email: null,
    startedAt: Date.now(),
  };
}

export function getSession(): FunnelSession {
  if (typeof window === 'undefined') return newSession();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as FunnelSession;
  } catch {
    // Corrupt storage → start fresh; losing quiz answers beats a crashed funnel.
  }
  const s = newSession();
  save(s);
  return s;
}

export function save(s: FunnelSession): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private-mode quota errors: session continues in memory for this page.
  }
}

export function setAnswer(key: string, value: string | string[] | number): FunnelSession {
  const s = getSession();
  s.answers[key] = value;
  save(s);
  return s;
}

/**
 * Attribution = the LATEST tagged click. A visit that carries tracking
 * params (a new ad click) replaces what's stored; an untagged revisit never
 * erases it. Last-click matches how Meta itself attributes (7-day click), and
 * a stale fbclid from an older click is one Meta flags and discards — so
 * keeping the first touch forever would hand Meta a dead match key exactly
 * for the people who needed two ads to convert.
 */
export function captureAttribution(searchParams: URLSearchParams): void {
  const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'a'];
  const utm: Record<string, string> = {};
  for (const k of keys) {
    const v = searchParams.get(k);
    if (v) utm[k] = v;
  }
  if (Object.keys(utm).length === 0) return;
  const s = getSession();
  if (utm.fbclid && utm.fbclid !== s.utm.fbclid) s.fbclidAt = Date.now();
  s.utm = utm;
  if (utm.a) s.landingVariant = utm.a;
  save(s);
}

/**
 * Start a fresh funnel session after a purchase. The same phone may run the
 * quiz again (a partner, a second child) — reusing the paid session's id
 * would re-point that purchase's funnel_sessions row at a different user.
 */
export function resetSession(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* same as save() */
  }
}

/** fbp/fbc cookies for Meta CAPI match keys, read at checkout time. */
export function readMetaCookies(): { fbp?: string; fbc?: string } {
  if (typeof document === 'undefined') return {};
  const get = (name: string) =>
    document.cookie
      .split('; ')
      .find((c) => c.startsWith(name + '='))
      ?.split('=')[1];
  const out: { fbp?: string; fbc?: string } = {};
  const fbp = get('_fbp');
  if (fbp) out.fbp = fbp;
  let fbc = get('_fbc');
  // If the pixel didn't set _fbc (blocked, first page), rebuild it from the
  // stored fbclid per Meta's documented format — this is a big match-rate win.
  if (!fbc) {
    const s = getSession();
    if (s.utm.fbclid) fbc = `fb.1.${s.fbclidAt ?? s.startedAt}.${s.utm.fbclid}`;
  }
  if (fbc) out.fbc = fbc;
  return out;
}
