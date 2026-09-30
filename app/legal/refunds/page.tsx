import { LegalFooter, Shell } from '@/components/ui';

// Mirrors the app's legal/ docs (same support address, entity, and California
// governing law). Keep the two in sync — a customer can read both. This page is
// linked from checkout and doubles as the /offer page's guarantee, so the
// 14-day promise here and there must always match.
export default function Refunds() {
  return (
    <Shell>
      <article className="flex-1 py-8 text-[15px] leading-[1.65] text-ink/75">
        <h1 className="font-serif text-[28px] text-ink">Refund Policy</h1>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-wide text-ink/45">Last updated: September 19, 2026</p>

        <h2 className="mt-6 font-serif text-[19px] text-ink">14-day money-back guarantee</h2>
        <p className="mt-2 leading-relaxed">
          If Kinderwell isn’t for you, email kinderwellteam@gmail.com within 14 days of your first
          purchase on this site and we’ll refund it in full — no questions asked. Refunds are
          processed by Dodo Payments to your original payment method, typically within 5–10
          business days.
        </p>

        <h2 className="mt-6 font-serif text-[19px] text-ink">Renewals</h2>
        <p className="mt-2 leading-relaxed">
          We send a reminder before annual renewals. If a renewal charged and you meant to
          cancel, contact us within 14 days of the renewal and we’ll refund it.
        </p>

        <h2 className="mt-6 font-serif text-[19px] text-ink">Purchases made in the iPhone app</h2>
        <p className="mt-2 leading-relaxed">
          Subscriptions purchased inside the app via Apple are billed by Apple and refunded
          through Apple at{' '}
          <a className="text-forest underline" href="https://reportaproblem.apple.com">
            reportaproblem.apple.com
          </a>
          . We can’t process those directly.
        </p>

        <p className="mt-6 leading-relaxed">Contact: kinderwellteam@gmail.com</p>
      </article>
      <LegalFooter />
    </Shell>
  );
}
