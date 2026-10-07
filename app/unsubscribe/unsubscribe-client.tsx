'use client';

import { useEffect, useState } from 'react';
import { RichHeadline, Shell } from '@/components/ui';
import { UNSUBSCRIBE_COOKIE as COOKIE } from '@/lib/unsubscribe-cookie';

/** The u/t pair /u left for this page, read once and cleared. */
function takeLinkCookie(): { u: string; t: string } | null {
  const raw = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  document.cookie = `${COOKIE}=; Max-Age=0; path=/unsubscribe`;
  if (!raw) return null;
  const dot = raw.indexOf('.');
  return dot > 0 ? { u: raw.slice(0, dot), t: raw.slice(dot + 1) } : null;
}

// The link in every marketing email's footer (via /u). The opt-out is
// recorded on arrival — "unsubscribe in one tap" is promised at email
// capture, so no second confirmation screen.
export default function UnsubscribeClient() {
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');

  useEffect(() => {
    const link = takeLinkCookie();
    if (!link) {
      setState('failed');
      return;
    }
    const qs = new URLSearchParams(link).toString();
    fetch(`/api/unsubscribe?${qs}`, { method: 'POST' })
      .then((res) => setState(res.ok ? 'done' : 'failed'))
      .catch(() => setState('failed'));
  }, []);

  return (
    <Shell>
      <div className="flex flex-1 flex-col justify-center py-10">
        {state === 'working' ? (
          <p className="text-[16px] text-ink/60">One moment…</p>
        ) : state === 'done' ? (
          <>
            <RichHeadline>You’re *unsubscribed*.</RichHeadline>
            <p className="mt-4 text-[16px] leading-[1.6] text-ink/70">
              We won’t send you any more reminder emails. If you have a subscription, you’ll still
              get receipts and account messages about it.
            </p>
          </>
        ) : (
          <>
            <RichHeadline>That link *didn’t work*.</RichHeadline>
            <p className="mt-4 text-[16px] leading-[1.6] text-ink/70">
              Reply to any of our emails, or write to kinderwellteam@gmail.com, and we’ll remove you
              by hand.
            </p>
          </>
        )}
      </div>
    </Shell>
  );
}
