import { LegalFooter, PrimaryButton, RichHeadline, Shell } from '@/components/ui';

// A mistyped ad URL or an old link: one clear way back into the funnel.
export default function NotFound() {
  return (
    <Shell>
      <div className="flex flex-1 flex-col justify-center py-10">
        <RichHeadline>{'This page *doesn’t exist*.'}</RichHeadline>
        <p className="mt-4 text-[16px] leading-[1.6] text-ink/70">
          The link may be old or mistyped. Your plan starts with a few quick questions.
        </p>
        <div className="mt-8">
          <PrimaryButton href="/start">Start over</PrimaryButton>
        </div>
      </div>
      <LegalFooter />
    </Shell>
  );
}
