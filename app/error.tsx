'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { LegalFooter, PrimaryButton, RichHeadline, Shell } from '@/components/ui';
import { track } from '@/lib/analytics';

// Any render error inside a page lands here instead of Next's bare
// "Application error" screen, which has no way back.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    track('web_funnel_error', { where: 'render', digest: error.digest ?? '' });
  }, [error]);

  return (
    <Shell>
      <div className="flex flex-1 flex-col justify-center py-10">
        <RichHeadline>{'Something *went wrong*.'}</RichHeadline>
        <p className="mt-4 text-[16px] leading-[1.6] text-ink/70">
          Sorry about that. Try again — your answers are saved on this device.
        </p>
        <div className="mt-8">
          <PrimaryButton onClick={reset}>Try again</PrimaryButton>
          <p className="mt-4 text-center text-[15px]">
            <Link href="/start" className="text-forest underline underline-offset-4">
              Start over
            </Link>
          </p>
        </div>
      </div>
      <LegalFooter />
    </Shell>
  );
}
