import type { ReactNode } from 'react';
import { LegalFooter, Shell } from '@/components/ui';

// Mirrors the app's legal/ docs (same support address, entity, and California
// governing law). Keep the two in sync — a customer can read both. Only what
// the law, Meta (pixel disclosure) and Apple require; keep it that short.
// When the code changes what it collects, sends or keeps, change this page.

const SUPPORT = 'kinderwellteam@gmail.com';

function H2({ children }: { children: ReactNode }) {
  return <h2 className="mt-6 font-serif text-[19px] text-ink">{children}</h2>;
}
function P({ children }: { children: ReactNode }) {
  return <p className="mt-2 leading-relaxed">{children}</p>;
}

export default function Privacy() {
  return (
    <Shell>
      <article className="flex-1 py-8 text-[15px] leading-[1.65] text-ink/75">
        <h1 className="font-serif text-[28px] text-ink">Privacy Policy</h1>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-wide text-ink/45">Last updated: October 7, 2026</p>

        <H2>What we collect</H2>
        <P>
          Your quiz answers (multiple-choice, plus the first name you give us, if any), your email
          address if you provide it, your subscription status, and technical data: IP address, browser
          and device type, and ad-click identifiers. Card details go to our payment provider, not to us.
        </P>

        <H2>How we use it</H2>
        <P>
          To build your plan, create your account, deliver your subscription in the app, process
          payment, send you emails about your plan and subscription, measure our advertising, and keep
          the service secure.
        </P>

        <H2>Who receives it</H2>
        <P>
          Supabase (our database), Vercel (website hosting), Resend (email delivery), Dodo Payments
          (payment processing, as merchant of record; receives your email and payment details), PostHog
          (analytics; identified by an account ID, never your email or answers) and Meta (advertising
          measurement through the Meta Pixel and Conversions API; receives event data, a hashed email
          address and account ID, purchase amount, IP address, browser type and Meta cookie
          identifiers). Your quiz answers are not shared with advertisers. We do not sell your personal
          information.
        </P>

        <H2>Cookies</H2>
        <P>
          Meta (<code>_fbp</code>, <code>_fbc</code>) and PostHog set cookies, and the site stores your
          quiz progress and email in your browser so you can continue where you left off. You can block
          or clear them in your browser settings. The site does not respond to Do Not Track signals.
        </P>

        <H2>How long we keep it</H2>
        <P>
          IP address, browser type and Meta identifiers: 30 days. Quiz answers not linked to an account:
          90 days. Your account and subscription data: until you delete your account.
        </P>

        <H2>Your choices</H2>
        <P>
          Every marketing email has an unsubscribe link. To access, correct or delete your data, email{' '}
          {SUPPORT}, or delete your account in the app.
        </P>

        <H2>Children</H2>
        <P>
          Kinderwell is for parents aged 18 or over. We do not knowingly collect personal information
          from children under 13. The quiz asks a parent about their child (such as an age range), never
          for the child’s name.
        </P>

        <H2>Changes</H2>
        <P>We will post changes here and update the date above.</P>

        <p className="mt-6 leading-relaxed">Contact: {SUPPORT} · Kinderwell</p>
      </article>
      <LegalFooter />
    </Shell>
  );
}
