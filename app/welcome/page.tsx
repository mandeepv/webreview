'use client';

// The purchase → app bridge. One job: get the paying user signed into the
// app with the SAME email. Best-practice beats, in order:
//   1. explicit payment confirmation FIRST (buyer anxiety kills activation)
//   2. device-aware handoff — App Store button on iPhone, QR code on
//      desktop/iPad ("scan with your iPhone camera")
//   3. friction removed from the sign-in step: email shown + one-tap copy
//   4. expectation setting (receipt from Dodo, email with the same steps)
//   5. momentum while the download runs (teaser lessons)
//   6. support escape hatch
// The receipt email repeats steps 1–2 verbatim — it's the durable fallback;
// we deliberately don't rely on deferred deep linking.
//
// Payment state comes from the query string Dodo appends to return_url
// (?subscription_id=…&status=…&email=…), never from the fact that someone
// reached this URL. Only status=active|succeeded is a confirmed payment and
// only that fires the browser Purchase — a failed card or a direct visit must
// never tell Meta a sale happened. The webhook's CAPI Purchase is the source
// of truth either way; the browser event is the dedup twin.

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Eyebrow, LegalFooter, PrimaryButton, RichHeadline, Shell } from '@/components/ui';
import { config } from '@/lib/config';
import { getSession, resetSession } from '@/lib/session';
import { track } from '@/lib/analytics';
import { pixel } from '@/lib/meta';

type PaymentState = 'confirmed' | 'processing' | 'failed' | 'unknown';

function paymentStateFrom(status: string | null): PaymentState {
  if (!status) return 'unknown';
  if (status === 'active' || status === 'succeeded') return 'confirmed';
  if (status === 'pending' || status === 'processing' || status === 'requires_customer_action') {
    return 'processing';
  }
  return 'failed';
}

export default function WelcomePage() {
  const [email, setEmail] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentState>('unknown');
  const [isIphone, setIsIphone] = useState(true);
  const [copied, setCopied] = useState(false);
  const qrRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const state = paymentStateFrom(params.get('status'));
    setPayment(state);
    const s = getSession();
    // Dodo's echo of the checkout email survives a refresh after the session
    // reset below; the stored one covers the dev-skip preview.
    setEmail(params.get('email') || s.email);
    track('web_funnel_welcome_viewed', { payment: state });

    // Device-aware handoff: iPhones get the button; everything else gets a
    // QR code to scan with the phone camera.
    const iphone = /iPhone/.test(navigator.userAgent);
    setIsIphone(iphone);

    // Browser-side Purchase with the event_id generated at checkout creation;
    // the webhook's CAPI Purchase carries the same id → Meta counts one.
    const eventId = localStorage.getItem('kw_purchase_event_id');
    const plan = localStorage.getItem('kw_purchase_plan');
    if (state === 'confirmed' && eventId) {
      pixel(
        'Purchase',
        {
          value: plan === 'monthly' ? config.priceMonthly : config.priceAnnual,
          currency: 'USD',
        },
        eventId
      );
      // Fire once — a refresh of this page must not double the client event.
      localStorage.removeItem('kw_purchase_event_id');
    }
    if (state === 'confirmed') resetSession();
  }, []);

  // Render the QR after we know we need it (canvas mounts on !isIphone).
  useEffect(() => {
    if (!isIphone && qrRef.current && config.appStoreUrl) {
      QRCode.toCanvas(qrRef.current, config.appStoreUrl, {
        width: 168,
        margin: 1,
        color: { dark: '#23211e', light: '#fbf7ef' },
      }).catch(() => {
        // QR failing must never break the page; the link below still works.
      });
    }
  }, [isIphone]);

  const copyEmail = async () => {
    if (!email) return;
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the address is visible to type */
    }
  };

  if (payment === 'failed') {
    return (
      <Shell>
        <div className="flex flex-1 flex-col justify-center py-10">
          <RichHeadline>{'Your payment *didn’t go through*.'}</RichHeadline>
          <p className="mt-4 text-[16px] leading-[1.6] text-ink/70">
            You haven’t been charged. This usually means the card was declined or the payment was
            cancelled. Your plan is still saved — you can try again with the same or a different
            payment method.
          </p>
          <div className="mt-8">
            <PrimaryButton href="/offer">Try again</PrimaryButton>
          </div>
        </div>
        <LegalFooter />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex-1 py-10">
        {/* 1. Confirmation beat — before any ask. */}
        {payment === 'confirmed' ? (
          <div className="flex items-center gap-2.5">
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-forest">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M20 6L9 17l-5-5"
                stroke="#fbf7ef"
                strokeWidth="3.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <p className="font-mono text-[12px] uppercase tracking-[0.16em] text-forest">
            Payment confirmed
          </p>
        </div>
        ) : payment === 'processing' ? (
          <p className="font-mono text-[12px] uppercase tracking-[0.16em] text-clay-deep">
            Payment processing — we’ll email you when it clears
          </p>
        ) : null}

        <div className="mt-5">
          <RichHeadline className="font-serif text-[32px] leading-[1.16] text-ink">
            {payment === 'unknown' ? 'Get set up in *two steps*.' : 'You’re in. *Two steps* left.'}
          </RichHeadline>
        </div>

        <div className="mt-8 space-y-[10px]">
          <div className="rounded-card bg-wash p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-clay-deep">
              Step 1
            </p>
            <p className="mt-1.5 font-serif text-[19px] text-ink/90">
              {isIphone ? 'Download Kinderwell on your iPhone' : 'Get Kinderwell on your iPhone'}
            </p>
            {isIphone ? (
              <div className="mt-4">
                <PrimaryButton href={config.appStoreUrl || '#'}>
                  Download on the App Store
                </PrimaryButton>
              </div>
            ) : (
              <div className="mt-4 flex items-center gap-5">
                <canvas ref={qrRef} className="rounded-row bg-cream p-1" />
                <p className="text-[15px] leading-[1.6] text-ink/70">
                  Point your iPhone camera here — the App Store opens straight to Kinderwell.
                </p>
              </div>
            )}
          </div>

          <div className="rounded-card bg-wash p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-clay-deep">
              Step 2
            </p>
            <p className="mt-1.5 font-serif text-[19px] text-ink/90">Sign in with this email</p>
            <button
              onClick={copyEmail}
              className="mt-3 flex w-full items-center justify-between rounded-row bg-cream px-4 py-3 text-left"
            >
              <span className="text-[16px] font-medium text-ink">
                {email ?? 'the email you used at checkout'}
              </span>
              {email ? (
                <span className="ml-3 shrink-0 font-mono text-[11px] uppercase tracking-wide text-forest">
                  {copied ? 'Copied ✓' : 'Copy'}
                </span>
              ) : null}
            </button>
            {/* Button labels quoted EXACTLY as the app shows them (mamalearn
                WelcomeScreen + AuthScreen). The big "Get started" button runs
                the whole questionnaire again — buyers must take the small
                sign-in link instead. If the app's labels change, change this,
                the handoff email (dodo-webhook) and the nudge (winback-sweep)
                the same day. */}
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-[15px] leading-[1.6] text-ink/70">
              <li>
                Open Kinderwell. At the bottom of the first screen, tap{' '}
                <strong>Sign in</strong> (next to “Already have an account?”) — not{' '}
                <strong>Get started</strong>, which is for new users.
              </li>
              <li>
                Choose <strong>Continue with Email</strong> and enter this address. We’ll send you a
                6-digit code — no password needed. Your subscription unlocks automatically.
              </li>
            </ol>
          </div>
        </div>

        {/* 4. Expectation setting. */}
        <p className="mt-5 text-center text-[13px] leading-relaxed text-ink/50">
          These steps are in your email too, along with your receipt from Dodo Payments — our
          payment partner; that’s the name your statement will show alongside Kinderwell.
        </p>

        <div className="mt-10">
          <Eyebrow>While it downloads</Eyebrow>
          <p className="mt-2 font-serif text-[22px] text-ink">Your first lessons</p>
          <div className="mt-4 space-y-[10px]">
            {[
              ['Foundations', 'What actually happens in your child’s brain in a hard moment.'],
              ['Understanding', 'Why naming a feeling calms it — the tool you’ll use every day.'],
              ['Bonding', 'The tiny bids for connection most parents miss.'],
            ].map(([name, blurb]) => (
              <div key={name} className="rounded-card border border-ink/10 bg-cream p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-forest">
                  {name}
                </p>
                <p className="mt-1 text-[15px] leading-[1.55] text-ink/75">{blurb}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 6. Support escape hatch. */}
        <p className="mt-8 text-center text-[14px] text-ink/60">
          Stuck on any step? Reply to your welcome email and a human will sort it out.
        </p>
      </div>
      <LegalFooter />
    </Shell>
  );
}
