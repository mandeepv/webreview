'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Eyebrow, LegalFooter, PrimaryButton, RichHeadline, Shell } from '@/components/ui';
import { captureAttribution, getSession, save } from '@/lib/session';
import { track } from '@/lib/analytics';
import { pixel } from '@/lib/meta';

// Message-match variants: the headline the user clicked is the headline they
// land on. Default = the VBWelcome cold-open. *stars* mark the italic phrase.
const VARIANTS: Record<string, { headline: string; sub: string }> = {
  default: {
    headline: 'The most important job you’ll ever do. And *nobody trained you* for it.',
    sub: 'You learn on the fly, running on no sleep, hoping today goes better than yesterday. Answer a few questions and we’ll build a plan around your child. Two minutes, tops.',
  },
  tantrums: {
    headline: 'Tantrums aren’t a discipline problem. They’re a *skills gap* — yours to close.',
    sub: '10 minutes a day of science-based lessons that show you exactly what to do mid-meltdown.',
  },
  listening: {
    headline: '“How many times do I have to say it?” There’s a *reason* they don’t listen.',
    sub: 'Learn the communication shifts that end the repeat-yourself loop, in 10 minutes a day.',
  },
  yelling: {
    headline: 'You don’t want to be the parent who yells. You need a *plan* for that moment.',
    sub: 'Science-based lessons that give you the words before you lose them.',
  },
};

export default function Landing() {
  const params = useSearchParams();
  const variantKey = params.get('a') && VARIANTS[params.get('a')!] ? params.get('a')! : 'default';
  const v = VARIANTS[variantKey];

  useEffect(() => {
    captureAttribution(new URLSearchParams(params.toString()));
    const s = getSession();
    s.landingVariant = variantKey;
    save(s);
    track('web_funnel_landing_viewed', { variant: variantKey });
    pixel('ViewContent', { content_name: `landing_${variantKey}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Shell>
      <div className="flex flex-1 flex-col justify-center py-10">
        <Eyebrow>Kinderwell</Eyebrow>
        <div className="mt-5">
          <RichHeadline className="font-serif text-[34px] leading-[1.14] text-ink">
            {v.headline}
          </RichHeadline>
        </div>
        <p className="mt-5 text-[17px] leading-[1.6] text-ink/70">{v.sub}</p>

        <div className="mt-9">
          <PrimaryButton href="/quiz/1">Let’s begin</PrimaryButton>
          <p className="mt-3 text-center text-[14px] text-ink/55">
            A plan built for your child’s age and your hardest moments. Two minutes.
          </p>
        </div>

        <div className="mt-10 rounded-card bg-wash p-5">
          <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-clay-deep">
            From a Kinderwell parent
          </p>
          <p className="mt-3 font-serif text-[19px] leading-[1.5] text-ink/85">
            “Three weeks in, the tantrums stopped running our house. I finally know what to do
            instead of guessing.”
          </p>
          <p className="mt-3 text-[14px] text-ink/55">Sarah — mom of two, ages 3 and 6</p>
        </div>

        <ul className="mt-8 space-y-3 text-[16px] text-ink/75">
          <li className="flex gap-3">
            <span className="text-forest">✓</span> 5–10 minute lessons made for exhausted parents
          </li>
          <li className="flex gap-3">
            <span className="text-forest">✓</span> Grounded in child-development research
          </li>
          <li className="flex gap-3">
            <span className="text-forest">✓</span> A sequenced path — not another feed of tips
          </li>
        </ul>
      </div>
      <LegalFooter />
    </Shell>
  );
}
