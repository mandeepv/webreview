import { LegalFooter, Shell } from '@/components/ui';

// Mirrors the app's legal/ docs (same support address, entity, and California
// governing law). Keep the two in sync — a customer can read both. This page must be
// accurate: Meta requires a privacy policy link on ad landing pages, and the
// hashed-email sharing with Meta below is a required disclosure.
export default function Privacy() {
  return (
    <Shell>
      <article className="flex-1 py-8 text-[15px] leading-[1.65] text-ink/75">
        <h1 className="font-serif text-[28px] text-ink">Privacy Policy</h1>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-wide text-ink/45">Last updated: October 5, 2026</p>

        <h2 className="mt-6 font-serif text-[19px] text-ink">What we collect on this site</h2>
        <p className="mt-2 leading-relaxed">
          When you take the Kinderwell quiz we collect your answers (multiple-choice, plus the
          first name you give us, if any) and, if you provide it, your email address. We use
          these to build your plan, create your Kinderwell account, and email you about it.
          Every reminder email has an unsubscribe link; account and receipt emails continue
          while you have a subscription.
        </p>

        <h2 className="mt-6 font-serif text-[19px] text-ink">Payments</h2>
        <p className="mt-2 leading-relaxed">
          Purchases are processed by Dodo Payments as merchant of record. We do not see or store
          your card details.
        </p>

        <h2 className="mt-6 font-serif text-[19px] text-ink">Analytics and advertising</h2>
        <p className="mt-2 leading-relaxed">
          We use PostHog for product analytics. We use the Meta Pixel and Meta Conversions API to
          measure advertising, which includes sharing event data and a hashed (irreversibly
          encoded) version of your email address with Meta to match conversions to ads. For that
          matching we also record your IP address, browser type and Meta cookie identifiers when
          you give your email and when you open checkout. We do not share your quiz answers with
          advertisers as personal information.
        </p>

        <h2 className="mt-6 font-serif text-[19px] text-ink">How long we keep it</h2>
        <p className="mt-2 leading-relaxed">
          The IP address, browser type and Meta cookie identifiers are deleted 30 days after you
          start the quiz. Quiz answers that are not linked to an account (you never gave an email,
          or you deleted your account) are deleted after 90 days. Your account data is kept while
          you have an account.
        </p>

        <h2 className="mt-6 font-serif text-[19px] text-ink">Your choices</h2>
        <p className="mt-2 leading-relaxed">
          You can request access to or deletion of your data at any time by emailing
          kinderwellteam@gmail.com. Deleting your account in the app deletes your data per the in-app
          policy.
        </p>

        <p className="mt-6 leading-relaxed">
          Contact: kinderwellteam@gmail.com · Kinderwell
        </p>
      </article>
      <LegalFooter />
    </Shell>
  );
}
