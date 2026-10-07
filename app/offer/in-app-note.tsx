'use client';

import { useEffect, useRef, useState } from 'react';
import { getSession } from '@/lib/session';
import { track } from '@/lib/analytics';
import { isInAppBrowser } from '@/lib/browser';
import { startCopy } from '@/lib/handoff';

// Instagram / Facebook open ad links in their own in-app browser, where
// Apple Pay on the web doesn't exist (Apple only allows it in Safari and
// SFSafariViewController). Most iPhone ad clicks land there, so: be honest
// that it's card-only here, and offer a link that reopens THIS checkout in
// Safari with the session intact (/r/<token>?to=offer — review P1-5).
//
// The clipboard (review 2026-10-07, B-6): WebKit lets a page write the
// clipboard only inside the user's tap, and every iOS in-app browser is
// WebKit. The link used to be fetched first and copied after the await, so
// the copy was always refused, and the failure message then contradicted
// the link shown beneath it. Now the link is minted as soon as the note
// appears, and the tap starts the copy before awaiting anything (a link
// still on its way goes through WebKit's promise-ClipboardItem pattern,
// lib/handoff.ts startCopy). When the copy is refused anyway, the link is
// shown with "press and hold" and, where the browser has one, a Share button.

type State = 'idle' | 'copied' | 'manual' | 'failed';

/** A /r/<token> link for this session, or null when it can't be made. */
async function mintSafariLink(): Promise<string | null> {
  try {
    const s = getSession();
    const res = await fetch('/api/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The email proves this device holds the session (resume's mint
      // refuses a bare session id).
      body: JSON.stringify({ action: 'mint', sessionId: s.id, email: s.email }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const { token } = (await res.json()) as { token?: unknown };
    return typeof token === 'string' && token
      ? `${window.location.origin}/r/${encodeURIComponent(token)}?to=offer`
      : null;
  } catch {
    return null;
  }
}

export function PayMethodsLine() {
  const [inApp, setInApp] = useState(false);
  const [state, setState] = useState<State>('idle');
  const [link, setLink] = useState<string | null>(null);
  const pending = useRef<Promise<string | null> | null>(null);

  useEffect(() => {
    const yes = isInAppBrowser(navigator.userAgent) && /iPhone|iPad/.test(navigator.userAgent);
    setInApp(yes);
    if (!yes) return;
    let live = true;
    pending.current = mintSafariLink().then((url) => {
      if (live) setLink(url);
      return url;
    });
    return () => {
      live = false;
    };
  }, []);

  if (!inApp) {
    return (
      <p className="mt-2.5 text-center text-[13px] text-ink/55">
         Pay with Apple Pay, Google Pay, or card
      </p>
    );
  }

  const copyLink = () => {
    track('web_funnel_open_in_safari_clicked');
    // Nothing is awaited before startCopy: the write must begin inside the tap.
    const copying = startCopy(link ?? pending.current ?? Promise.resolve(null));
    void copying.then(async (copied) => {
      if (copied) return setState('copied');
      const url = link ?? (await pending.current);
      setState(url ? 'manual' : 'failed');
    });
  };

  const share = () => {
    if (!link || typeof navigator.share !== 'function') return;
    // The share sheet's own "Copy" works where the page's clipboard doesn't.
    navigator.share({ url: link }).catch(() => {});
  };

  return (
    <div className="mt-2.5 text-center text-[13px] leading-relaxed text-ink/55">
      <p>Pay by card here. Apple Pay only works in Safari.</p>
      {state === 'copied' ? (
        <p className="mt-1 text-forest">
          Link copied — open Safari and paste it in the address bar. Your plan comes with you.
        </p>
      ) : state === 'manual' ? (
        <p className="mt-1 text-ink/70">
          Press and hold the link below to copy it, then paste it into Safari’s address bar. Your
          plan comes with you.
        </p>
      ) : state === 'failed' ? (
        <p className="mt-1 text-clay-deep">Couldn’t make the link. Card checkout works right here.</p>
      ) : (
        <button onClick={copyLink} className="mt-1 text-forest underline underline-offset-2">
          Prefer Apple Pay? Copy a link for Safari
        </button>
      )}
      {link && (state === 'copied' || state === 'manual') ? (
        <p className="mt-1 break-all font-mono text-[11px] text-ink/45 select-all">{link}</p>
      ) : null}
      {link && state === 'manual' && typeof navigator.share === 'function' ? (
        <button onClick={share} className="mt-1 text-forest underline underline-offset-2">
          Share the link instead
        </button>
      ) : null}
    </div>
  );
}
