import { LegalFooter, Shell } from '@/components/ui';

// Mirrors the app's legal/ docs (same support address, entity, and California
// governing law). Keep the two in sync — a customer can read both.
export default function Terms() {
  return (
    <Shell>
      <article className="flex-1 py-8 text-[15px] leading-[1.65] text-ink/75">
        <h1 className="font-serif text-[28px] text-ink">Terms of Service</h1>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-wide text-ink/45">Last updated: September 19, 2026</p>

        <h2 className="mt-6 font-serif text-[19px] text-ink">The service</h2>
        <p className="mt-2 leading-relaxed">
          Kinderwell provides parenting-education lessons through its iPhone app. Kinderwell is
          educational content, not medical, psychological, or therapeutic advice, and does not
          diagnose or treat any condition.
        </p>

        <h2 className="mt-6 font-serif text-[19px] text-ink">Subscriptions purchased on this site</h2>
        <p className="mt-2 leading-relaxed">
          Subscriptions bought here are sold by Dodo Payments as merchant of record and renew
          automatically (annually or monthly, as chosen at checkout) until canceled. You can
          cancel anytime from your account page — the link is in every receipt and renewal
          email — and cancellation stops the next renewal while keeping access through the paid
          period. Renewal pricing is disclosed at checkout.
        </p>

        <h2 className="mt-6 font-serif text-[19px] text-ink">Refunds</h2>
        <p className="mt-2 leading-relaxed">
          See our <a className="text-forest underline" href="/legal/refunds">refund policy</a>.
          Subscriptions purchased inside the iPhone app via Apple are governed by Apple’s terms
          and refunded through Apple.
        </p>

        <h2 className="mt-6 font-serif text-[19px] text-ink">Accounts</h2>
        <p className="mt-2 leading-relaxed">
          Your email creates a Kinderwell account used to deliver your subscription in the app.
          Keep access to that email; it is how your purchase is recognized.
        </p>

        <h2 className="mt-6 font-serif text-[19px] text-ink">Governing law</h2>
        <p className="mt-2 leading-relaxed">
          These Terms are governed by the laws of the State of California, United States,
          without regard to conflict of law principles. Before filing a legal claim, please
          contact us at kinderwellteam@gmail.com to attempt informal resolution.
        </p>

        <p className="mt-6 leading-relaxed">Contact: kinderwellteam@gmail.com · Kinderwell</p>
      </article>
      <LegalFooter />
    </Shell>
  );
}
