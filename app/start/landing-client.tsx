'use client';

import { useEffect } from 'react';
import { Eyebrow, LegalFooter, PrimaryButton, RichHeadline, Shell } from '@/components/ui';
import { captureAttribution, getSession, save } from '@/lib/session';
import { track } from '@/lib/analytics';
import { pixel } from '@/lib/meta';
import { VARIANTS } from './variants';

// variantKey is resolved on the server (page.tsx) so the landing copy is in
// the first HTML response. Reading it with useSearchParams here would make
// the whole page client-rendered: a blank screen until the JS arrives, on the
// one page every ad dollar lands on (P1-13).
export default function Landing({ variantKey }: { variantKey: string }) {
  const v = VARIANTS[variantKey] ?? VARIANTS.default;

  useEffect(() => {
    captureAttribution(new URLSearchParams(window.location.search));
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
