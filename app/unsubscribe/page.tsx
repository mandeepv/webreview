'use client';

import { useEffect, useState } from 'react';
import { RichHeadline, Shell } from '@/components/ui';

// The link in every marketing email's footer. The opt-out is recorded on
// arrival — "unsubscribe in one tap" is promised at email capture, so no
// second confirmation screen.
export default function UnsubscribePage() {
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');

  useEffect(() => {
    fetch(`/api/unsubscribe${window.location.search}`, { method: 'POST' })
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
              Reply to any of our emails, or write to hello@kinderwell.app, and we’ll remove you
              by hand.
            </p>
          </>
        )}
      </div>
    </Shell>
  );
}
