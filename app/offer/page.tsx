'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Eyebrow,
  LegalFooter,
  PrimaryButton,
  RichHeadline,
  Shell,
} from '@/components/ui';
import { config, perDayAnnual, perDayMonthly } from '@/lib/config';
import { offerEcho } from '@/lib/quiz/scoring';
import { getSession, readMetaCookies, save } from '@/lib/session';
import { track } from '@/lib/analytics';
import { openOverlayCheckout } from '@/lib/checkout';
import { pixel } from '@/lib/meta';

// Paywall structure per the web2app research (botsi/funnelfox teardowns of
// Lasta, Fastic, Babbel, Noom):
//   outcome-confirmation headline with personalization echoes →
//   today→after projection from their answers → plan picker with PER-DAY
//   price primary (best-tested framing) → outcome CTA + express-pay signal →
//   FTC renewal line → guarantee adjacent → value stack → reviews → FAQ → CTA.
// No timers or coupons: price parity is locked, and a fake deadline poisons
// every other claim on the page.

const FAQS = [
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Go to kinderwell.app/manage, sign in with your email, and cancel there — the link is in your welcome email too. Canceling stops the next renewal; you keep access through the period you paid for.',
  },
  {
    q: 'How do I get the app?',
    a: 'Right after checkout you’ll get the App Store link and sign in with this same email. Your plan will be waiting.',
  },
  {
    q: 'What if it’s not for me?',
    a: 'There’s a 14-day money-back guarantee. Email us within 14 days of purchase and we’ll refund you, no questions asked.',
  },
  {
    q: 'Is this therapy or medical advice?',
    a: 'No. Kinderwell is parent education based on child-development research. It doesn’t diagnose or treat any condition.',
  },
];

function PlanRow({
  title,
  tag,
  perDay,
  billedLine,
  selected,
  onClick,
}: {
  title: string;
  tag?: string;
  perDay: string;
  billedLine: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      role="radio"
      aria-checked={selected}
      className={`flex w-full items-center gap-3.5 rounded-card px-5 py-[18px] text-left transition ${
        selected ? 'bg-forest' : 'bg-wash hover:bg-wash/70'
      }`}
    >
      <span
        className={`flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-full border-[1.5px] ${
          selected ? 'border-cream bg-cream/15' : 'border-ink/30'
        }`}
      >
        {selected ? <span className="h-[11px] w-[11px] rounded-full bg-cream" /> : null}
      </span>
      <span className="flex-1">
        <span className="flex items-center gap-2">
          <span className={`text-[17px] font-semibold ${selected ? 'text-cream' : 'text-ink/90'}`}>
            {title}
          </span>
          {tag ? (
            <span
              className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
                selected ? 'bg-mint text-forest-deep' : 'bg-clay/15 text-clay-deep'
              }`}
            >
              {tag}
            </span>
          ) : null}
        </span>
        <span className={`mt-0.5 block text-[13px] ${selected ? 'text-cream/75' : 'text-ink/55'}`}>
          {billedLine}
        </span>
      </span>
      {/* Per-day is the PRIMARY number — the researched framing. */}
      <span className="text-right">
        <span className={`font-serif text-[26px] leading-none ${selected ? 'text-cream' : 'text-ink'}`}>
          ${perDay}
        </span>
        <span className={`block text-[12px] ${selected ? 'text-cream/75' : 'text-ink/55'}`}>
          per day
        </span>
      </span>
    </button>
  );
}

export default function OfferPage() {
  const router = useRouter();
  const [plan, setPlan] = useState<'annual' | 'monthly'>('annual');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [echo, setEcho] = useState<{ goal: string; focus: string; age: string } | null>(null);

  useEffect(() => {
    const s = getSession();
    // No quiz session → cold direct hit; the offer means nothing without the
    // plan story. Send them to the start.
    if (!s.emailCaptured) {
      router.replace('/start');
      return;
    }
    const n = s.answers['name'];
    setName(typeof n === 'string' && n.trim() ? n.trim() : null);
    setEcho(offerEcho(s.answers));
    track('web_funnel_offer_viewed');
    pixel('AddToCart');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkout = async () => {
    setBusy(true);
    setError(null);
    const s = getSession();
    try {
      track('web_funnel_checkout_opened', { plan });
      pixel('InitiateCheckout', {
        value: plan === 'monthly' ? config.priceMonthly : config.priceAnnual,
        currency: 'USD',
      });
      const res = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: s.id, plan, meta: readMetaCookies() }),
      });
      if (res.status === 409) {
        // create-checkout's duplicate guard: this email already has an active
        // web subscription. Charging again is the worst possible outcome.
        setError(
          'This email already has an active Kinderwell subscription — no need to pay again. Check your welcome email for how to sign in to the app.'
        );
        setBusy(false);
        return;
      }
      if (!res.ok) throw new Error(`create-checkout ${res.status}`);
      const { checkoutUrl, eventId } = (await res.json()) as {
        checkoutUrl: string;
        eventId: string;
      };
      // Saved so /welcome can fire the browser-side Purchase with the SAME
      // event_id the webhook uses for CAPI — Meta dedups the pair.
      localStorage.setItem('kw_purchase_event_id', eventId);
      localStorage.setItem('kw_purchase_plan', plan);

      // Overlay keeps the buyer on kinderwell.app; the hosted page is the
      // fallback so a blocked/failed SDK never leaves them on a dead button.
      const opened = await openOverlayCheckout(checkoutUrl, () => setBusy(false));
      if (!opened) window.location.href = checkoutUrl;
    } catch {
      track('web_funnel_error', { where: 'create_checkout' });
      setError('Couldn’t open checkout. Please try again.');
      setBusy(false);
    }
  };

  return (
    <Shell>
      <div className="flex-1 py-8">
        <Eyebrow>Your plan is ready</Eyebrow>
        <div className="mt-4">
          <RichHeadline className="font-serif text-[32px] leading-[1.16] text-ink">
            {name ? `${name}, your plan is *ready to start*.` : 'Your plan is *ready to start*.'}
          </RichHeadline>
        </div>
        {echo ? (
          <p className="mt-3 text-[15px] leading-[1.6] text-ink/65">
            Built for your <span className="font-semibold text-ink/85">{echo.age}</span> · focused
            on <span className="font-semibold text-ink/85">{echo.focus}</span> · headed toward{' '}
            <span className="font-semibold text-ink/85">{echo.goal}</span>
          </p>
        ) : null}

        {/* Today → after: the outcome projection, from their own answers. */}
        {echo ? (
          <div className="mt-6 flex items-stretch gap-2">
            <div className="flex-1 rounded-card bg-wash p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink/50">
                Today
              </p>
              <p className="mt-1.5 font-serif text-[16px] leading-snug text-ink/75">
                Guessing in the hard moments
              </p>
            </div>
            <div className="flex items-center text-ink/40">→</div>
            <div className="flex-1 rounded-card bg-forest p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-mint">
                Week 10
              </p>
              <p className="mt-1.5 font-serif text-[16px] capitalize leading-snug text-cream">
                {echo.goal}
              </p>
            </div>
          </div>
        ) : null}

        {/* Plan picker — annual pre-selected, per-day price primary. */}
        <div className="mt-7 space-y-[10px]" role="radiogroup">
          <PlanRow
            title="Annual"
            tag="Best value"
            perDay={perDayAnnual}
            billedLine={`Billed $${config.priceAnnual}/year`}
            selected={plan === 'annual'}
            onClick={() => setPlan('annual')}
          />
          <PlanRow
            title="Monthly"
            perDay={perDayMonthly}
            billedLine={`Billed $${config.priceMonthly}/month`}
            selected={plan === 'monthly'}
            onClick={() => setPlan('monthly')}
          />
        </div>

        {error ? <p className="mt-3 text-[14px] text-clay-deep">{error}</p> : null}

        <div className="mt-6">
          <PrimaryButton onClick={checkout} disabled={busy}>
            {busy ? 'Opening secure checkout…' : 'Get my plan'}
          </PrimaryButton>
          <p className="mt-2.5 text-center text-[13px] text-ink/55">
             Pay with Apple Pay, Google Pay, or card
          </p>
          {/* FTC auto-renewal disclosure — keep adjacent to the CTA. */}
          <p className="mt-2 text-center text-[12px] leading-relaxed text-ink/50">
            {plan === 'annual'
              ? `Renews automatically at $${config.priceAnnual}/year until canceled.`
              : `Renews automatically at $${config.priceMonthly}/month until canceled.`}{' '}
            Cancel anytime at kinderwell.app/manage. Secure checkout by Dodo Payments.
          </p>
          {config.devSkip ? (
            // Preview skip — see config.devSkip for when it can appear.
            <button
              onClick={() => {
                localStorage.setItem('kw_purchase_plan', plan);
                const s = getSession();
                if (!s.email) {
                  s.email = 'dev@example.com';
                  save(s);
                }
                router.push('/welcome?status=active');
              }}
              className="mx-auto mt-2 block text-[12px] text-ink/40 underline"
            >
              Dev: skip checkout →
            </button>
          ) : null}
        </div>

        {/* Guarantee sits adjacent to the ask — researched placement. */}
        <div className="mt-6 rounded-callout border border-clay/30 bg-clay/[0.07] p-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-clay-deep">
            14-day money-back guarantee
          </p>
          <p className="mt-2 text-[15px] leading-[1.6] text-ink/80">
            Try the full program. If it’s not for you, email us within 14 days for a complete
            refund — no questions asked.
          </p>
        </div>

        <div className="mt-9">
          <p className="font-serif text-[22px] text-ink">What you get</p>
          <ul className="mt-4 space-y-3 text-[16px] text-ink/75">
            <li className="flex gap-3"><span className="text-forest">✓</span> Your personalized 10-week path</li>
            <li className="flex gap-3"><span className="text-forest">✓</span> Every Kinderwell lesson — sequenced, not a tip feed</li>
            <li className="flex gap-3"><span className="text-forest">✓</span> 5–10 minute lessons built for tired evenings</li>
            <li className="flex gap-3"><span className="text-forest">✓</span> The words to say in the moments that keep going wrong</li>
          </ul>
        </div>

        <div className="mt-9 space-y-[10px]">
          {[
            ['The first program that didn’t make me feel judged. It just told me what to do.', 'Megan, mom of a 3-year-old'],
            ['My wife and I do the lessons together after bedtime. Ten minutes. It’s changed our whole tone.', 'Daniel, dad of two'],
            ['I was skeptical it could help with a strong-willed 6-year-old. Week two changed my mind.', 'Aisha, mom of a 6-year-old'],
          ].map(([text, author]) => (
            <div key={author} className="rounded-card bg-wash p-5">
              <p className="text-[13px] tracking-wide text-clay">★★★★★</p>
              <p className="mt-2 font-serif text-[17px] italic leading-[1.55] text-ink/85">
                “{text}”
              </p>
              <p className="mt-2.5 text-[13px] text-ink/55">{author}</p>
            </div>
          ))}
        </div>

        <div className="mt-9">
          <p className="font-serif text-[22px] text-ink">Questions</p>
          <div className="mt-4 space-y-5">
            {FAQS.map((f) => (
              <div key={f.q}>
                <p className="text-[16px] font-semibold text-ink/90">{f.q}</p>
                <p className="mt-1 text-[15px] leading-[1.6] text-ink/65">{f.a}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-9">
          <PrimaryButton onClick={checkout} disabled={busy}>
            {busy ? 'Opening secure checkout…' : 'Get my plan'}
          </PrimaryButton>
        </div>
      </div>
      <LegalFooter />
    </Shell>
  );
}
