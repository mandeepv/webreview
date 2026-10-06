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
import { getSession, readMetaCookies, save } from '@/lib/session';
import { identify, track } from '@/lib/analytics';
import { leadEventId, pixel, setPixelUserData } from '@/lib/meta';
import { EMAIL_POSITION, JOURNEY_LENGTH } from '@/lib/quiz/questions';

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
  const [hp, setHp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    // Already captured (back button from Act 3): a second capture would
    // re-fire Lead and replay the 9-second build (P2-7c).
    if (s.emailCaptured) {
      router.replace('/plan');
      return;
    }
    const n = s.answers['name'];
    setName(typeof n === 'string' && n.trim() ? n.trim() : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (busy) return; // Enter + tap, or a double tap: one capture only (P2-7d)
    setBusy(true);
    setError(null);
    const s = getSession();
    try {
      const res = await fetch('/api/capture-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          hp,
          sessionId: s.id,
          answers: s.answers,
          utm: s.utm,
          landingVariant: s.landingVariant,
          // Match keys for the server-side Lead (P2-2).
          meta: readMetaCookies(),
        }),
      });
      if (res.status === 429) {
        setError('Too many attempts. Please wait a minute and try again.');
        setBusy(false);
        return;
      }
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
      // Same event id as capture-email's server-side Lead → Meta keeps one (P2-2).
      pixel('Lead', {}, await leadEventId(s.id));
      // replace: back from /plan must not land on the build screen again (P2-7b).
      router.replace('/building');
    } catch {
      track('web_funnel_error', { where: 'capture_email' });
      setError('Something went wrong saving your plan. Please try again.');
      setBusy(false);
    }
  };

  return (
    <Shell>
      <ProgressRail
        fraction={EMAIL_POSITION / JOURNEY_LENGTH}
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
          {/* Honeypot: invisible to people and screen readers, filled by bots. */}
          <input
            type="text"
            name="kw_website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            value={hp}
            onChange={(e) => setHp(e.target.value)}
            className="absolute -left-[9999px] h-0 w-0 opacity-0"
          />
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !busy && /.+@.+\..+/.test(email) && submit()}
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
                router.replace('/building');
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
