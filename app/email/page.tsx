'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  LegalFooter,
  PrimaryButton,
  ProgressRail,
  RichHeadline,
  Shell,
} from '@/components/ui';
import { config } from '@/lib/config';
import { getSession, save } from '@/lib/session';
import { identify, track } from '@/lib/analytics';
import { pixel, setPixelUserData } from '@/lib/meta';
import { JOURNEY_LENGTH, TOTAL_STEPS } from '@/lib/quiz/questions';

// The recoverability watershed: this step creates the Supabase account the
// purchase will belong to, BEFORE payment (see 02-payments-entitlements.md).
//
// Messaging follows the researched best practice (Lasta/Fastic pattern):
// the email is framed as UNLOCKING the plan the quiz just built — "your plan
// is ready, enter your email to see it" — never as a signup. A privacy
// microline and a small social-proof beat sit at the ask to lower the cost
// of handing over the address.
export default function EmailPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    const n = getSession().answers['name'];
    setName(typeof n === 'string' && n.trim() ? n.trim() : null);
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const s = getSession();
    try {
      const res = await fetch('/api/capture-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          sessionId: s.id,
          answers: s.answers,
          utm: s.utm,
          landingVariant: s.landingVariant,
        }),
      });
      if (!res.ok) throw new Error(`capture-email ${res.status}`);
      const { userId } = (await res.json()) as { userId: string };
      s.emailCaptured = true;
      s.userId = userId;
      s.email = email;
      save(s);
      identify(userId);
      track('web_funnel_email_captured');
      // User data BEFORE the Lead so this event (and every later one) carries it.
      await setPixelUserData(email, userId);
      pixel('Lead');
      router.push('/building');
    } catch {
      track('web_funnel_error', { where: 'capture_email' });
      setError('Something went wrong saving your plan. Please try again.');
      setBusy(false);
    }
  };

  return (
    <Shell>
      <ProgressRail
        fraction={(TOTAL_STEPS + 1) / JOURNEY_LENGTH}
        onBack={() => router.back()}
      />
      <div className="flex flex-1 flex-col justify-center py-8">
        <RichHeadline>
          {name ? `${name}, your plan is *ready*.` : 'Your plan is *ready*.'}
        </RichHeadline>
        <p className="mt-4 text-[16px] leading-[1.6] text-ink/70">
          Enter your email to see it. It also becomes your sign-in for the app, so your plan is
          never lost.
        </p>
        <div className="mt-8 space-y-3">
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && /.+@.+\..+/.test(email) && submit()}
            className="w-full rounded-row border border-ink/15 bg-cream px-5 py-4 text-[17px] text-ink outline-none placeholder:text-ink/35 focus:border-forest"
          />
          {error ? <p className="text-[14px] text-clay-deep">{error}</p> : null}
          <PrimaryButton onClick={submit} disabled={busy || !/.+@.+\..+/.test(email)}>
            {busy ? 'Unlocking…' : 'See my plan'}
          </PrimaryButton>
          <p className="text-center text-[13px] text-ink/50">
            No spam, ever. Unsubscribe in one tap.{' '}
            <a href="/legal/privacy" className="underline hover:text-ink/70">
              Privacy
            </a>
          </p>
          {config.devSkip ? (
            // Preview skip — see config.devSkip for when it can appear.
            <button
              onClick={() => {
                const s = getSession();
                s.emailCaptured = true;
                s.userId = 'dev-preview-user';
                s.email = email || 'dev@example.com';
                save(s);
                router.push('/building');
              }}
              className="mx-auto block text-[12px] text-ink/40 underline"
            >
              Dev: skip backend →
            </button>
          ) : null}
        </div>

        {/* Comfort at the ask — one short review, the Lasta pattern. */}
        <div className="mt-9 rounded-card bg-wash p-5">
          <p className="text-[13px] tracking-wide text-clay">★★★★★</p>
          <p className="mt-2 font-serif text-[17px] italic leading-[1.55] text-ink/85">
            “The plan actually matched what we’re going through. First thing that has.”
          </p>
          <p className="mt-2 text-[13px] text-ink/55">Megan — mom of a 3-year-old</p>
        </div>
      </div>
      <LegalFooter />
    </Shell>
  );
}
