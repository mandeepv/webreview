'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { LegalFooter, PrimaryButton, RichHeadline, Shell } from '@/components/ui';

// Soft exit for Android users and out-of-range ages. We never sell to someone
// who can't use the product — that's a guaranteed refund/chargeback.
function Waitlist() {
  const reason = useSearchParams().get('reason');
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);

  const copy =
    reason === 'android'
      ? {
          h: 'Kinderwell is *iPhone-only* right now.',
          p: 'Leave your email and you’ll be the first to know when Android arrives. Your quiz answers will be waiting.',
        }
      : {
          h: 'We don’t cover *that age* yet.',
          p: 'Kinderwell focuses on the ages our lessons serve best. Leave your email and we’ll tell you the moment we cover yours.',
        };

  const submit = async () => {
    // Reuse the capture-email endpoint with a waitlist flag; failures are
    // swallowed — a waitlist form must never show an error wall.
    try {
      const { getSession } = await import('@/lib/session');
      await fetch('/api/capture-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          sessionId: getSession().id,
          answers: getSession().answers,
          utm: getSession().utm,
          landingVariant: getSession().landingVariant,
          waitlist: reason ?? 'other',
        }),
      });
    } catch {
      /* deliberate */
    }
    setDone(true);
  };

  return (
    <Shell>
      <div className="flex flex-1 flex-col justify-center py-10">
        <RichHeadline>{copy.h}</RichHeadline>
        <p className="mt-4 text-[16px] leading-[1.6] text-ink/70">{copy.p}</p>
        {done ? (
          <p className="mt-8 rounded-callout bg-wash p-4 text-center font-serif text-[17px] italic text-ink/85">
            You’re on the list. Thank you.
          </p>
        ) : (
          <div className="mt-8 space-y-3">
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-row border border-ink/15 bg-cream px-5 py-4 text-[17px] text-ink outline-none placeholder:text-ink/35 focus:border-forest"
            />
            <PrimaryButton onClick={submit} disabled={!/.+@.+\..+/.test(email)}>
              Notify me
            </PrimaryButton>
          </div>
        )}
      </div>
      <LegalFooter />
    </Shell>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Waitlist />
    </Suspense>
  );
}
