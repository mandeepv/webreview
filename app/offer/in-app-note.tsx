'use client';

import { useEffect, useState } from 'react';
import { getSession } from '@/lib/session';
import { track } from '@/lib/analytics';
import { isInAppBrowser } from '@/lib/browser';

// Instagram / Facebook open ad links in their own in-app browser, where
// Apple Pay on the web doesn't exist (Apple only allows it in Safari and
// SFSafariViewController). Most iPhone ad clicks land there, so: be honest
// that it's card-only here, and offer a link that reopens THIS checkout in
// Safari with the session intact (/r/<token>?to=offer — review P1-5).

export function PayMethodsLine() {
  const [inApp, setInApp] = useState(false);
  const [state, setState] = useState<'idle' | 'working' | 'copied' | 'failed'>('idle');
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    setInApp(isInAppBrowser(navigator.userAgent) && /iPhone|iPad/.test(navigator.userAgent));
  }, []);

  if (!inApp) {
    return (
      <p className="mt-2.5 text-center text-[13px] text-ink/55">
         Pay with Apple Pay, Google Pay, or card
      </p>
    );
  }

  const copyLink = async () => {
    setState('working');
    track('web_funnel_open_in_safari_clicked');
    try {
      const res = await fetch('/api/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mint', sessionId: getSession().id }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { token } = (await res.json()) as { token: string };
      const url = `${window.location.origin}/r/${encodeURIComponent(token)}?to=offer`;
      setLink(url);
      await navigator.clipboard.writeText(url);
      setState('copied');
    } catch {
      // Clipboard can be blocked in in-app browsers; the link is shown below
      // to long-press instead.
      setState(link ? 'copied' : 'failed');
    }
  };

  return (
    <div className="mt-2.5 text-center text-[13px] leading-relaxed text-ink/55">
      <p>Pay by card here. Apple Pay only works in Safari.</p>
      {state === 'copied' ? (
        <p className="mt-1 text-forest">
          Link copied — open Safari and paste it in the address bar. Your plan comes with you.
        </p>
      ) : state === 'failed' ? (
        <p className="mt-1 text-clay-deep">Couldn’t make the link. Card checkout works right here.</p>
      ) : (
        <button onClick={copyLink} disabled={state === 'working'} className="mt-1 text-forest underline underline-offset-2">
          {state === 'working' ? 'Making your link…' : 'Prefer Apple Pay? Copy a link for Safari'}
        </button>
      )}
      {link && state !== 'idle' ? (
        <p className="mt-1 break-all font-mono text-[11px] text-ink/45 select-all">{link}</p>
      ) : null}
    </div>
  );
}
