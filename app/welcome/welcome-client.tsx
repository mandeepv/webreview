'use client';

// The purchase → app bridge. One job: get the paying user into the app,
// signed in to the account that paid. Best-practice beats, in order:
//   1. explicit payment confirmation FIRST (buyer anxiety kills activation)
//   2. device-aware handoff — the "Get Kinderwell" button on iPhone, a QR
//      code on desktop/iPad ("scan with your iPhone camera")
//   3. the sign-in step removed where we can (SPEC-21, below), made easy
//      where we can't: email shown + one-tap copy
//   4. expectation setting (receipt from Dodo, email with the same steps)
//   5. momentum while the download runs (teaser lessons)
//   6. support escape hatch
//
// SPEC-21 handoff (~/mamalearn/docs/specs/SPEC-21-purchase-handoff.md): this
// browser proves it opened the checkout (lib/handoff.ts) and gets a one-time
// sign-in link. "Get Kinderwell" copies it, then opens the App Store; on first
// launch the app offers to paste it and opens signed in, without the buyer
// choosing a sign-in method. The link is a LOGIN CREDENTIAL: it stays in
// memory, goes into no analytics event, and only ever sits in this page's
// DOM as the href of "Open Kinderwell" (autocapture, the pixel's automatic
// events and session replay are all off on this site; see lib/analytics.ts
// and app/layout.tsx). The email-code steps stay on the page as the fallback,
// and the receipt email carries its own link plus the same steps.
//
// Payment state comes from the query string Dodo appends to return_url
// (?subscription_id=…&status=…; page.tsx has already stripped Dodo's
// ?email= server-side so it never reaches Meta/PostHog), never from the fact that someone
// reached this URL. Only status=active|succeeded is a confirmed payment and
// only that fires the browser Purchase — a failed card or a direct visit must
// never tell Meta a sale happened. The webhook's CAPI Purchase is the source
// of truth either way; the browser event is the dedup twin.

import { MouseEvent, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Eyebrow, LegalFooter, PrimaryButton, RichHeadline, Shell } from '@/components/ui';
import { config } from '@/lib/config';
import { getSession, resetSession } from '@/lib/session';
import { track } from '@/lib/analytics';
import { pixel, setPixelUserData } from '@/lib/meta';
import { PaymentState, paymentStateFrom } from '@/lib/browser';
import { fetchHandoffLink, type HandoffProof, type MintResult, readProof, startCopy, withTimeout } from '@/lib/handoff';


const EMAIL_KEY = 'kw_welcome_email';

/** How long a tap made before the link arrived waits for it before opening the App Store anyway. */
const TAP_WAIT_MS = 8000;

// One mint per page load. React's dev StrictMode runs effects twice, and
// every mint uses one of the session's 5.
let minting: { sessionId: string; result: Promise<MintResult> } | null = null;
function mintOnce(proof: HandoffProof): Promise<MintResult> {
  if (minting?.sessionId !== proof.sessionId) {
    minting = { sessionId: proof.sessionId, result: fetchHandoffLink(proof) };
  }
  return minting.result;
}

type Handoff = 'off' | 'pending' | 'ready';

export default function WelcomeClient() {
  const [email, setEmail] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentState>('unknown');
  // null until the browser says — so desktop never flashes the App Store
  // button before swapping to the QR code (P3-26).
  const [isIphone, setIsIphone] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const [handoff, setHandoff] = useState<Handoff>('off');
  // The sign-in link: memory only, never storage (see the header).
  const [link, setLink] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const pendingLink = useRef<Promise<string | null> | null>(null);
  const waitingRef = useRef(false);
  const qrRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const state = paymentStateFrom(params.get('status'));
    setPayment(state);
    const s = getSession();
    // The email captured on /email is the account the entitlement is on, so
    // it's the one to sign in with (checkout can't change it — P1-2). Kept in
    // sessionStorage so a refresh after the session reset below still shows it.
    let accountEmail = s.email;
    try {
      if (accountEmail) sessionStorage.setItem(EMAIL_KEY, accountEmail);
      else accountEmail = sessionStorage.getItem(EMAIL_KEY);
    } catch {
      /* storage blocked — fall back to the generic label */
    }
    setEmail(accountEmail);
    track('web_funnel_welcome_viewed', { payment: state });

    // Device-aware handoff: iPhones get the button; everything else gets a
    // QR code to scan with the phone camera.
    const iphone = /iPhone/.test(navigator.userAgent);
    setIsIphone(iphone);

    // Browser-side Purchase with the event_id generated at checkout creation;
    // the webhook's CAPI Purchase carries the same id → Meta counts one.
    const eventId = localStorage.getItem('kw_purchase_event_id');
    const plan = localStorage.getItem('kw_purchase_plan');
    const userId = s.userId;
    const email = s.email;
    void (async () => {
      if (state === 'confirmed' && eventId) {
        // Attach advanced matching BEFORE the Purchase: Meta keeps whichever
        // twin of the deduped pair arrives first, usually this one (P2-2b).
        if (email && userId && userId !== 'dev-preview-user') await setPixelUserData(email, userId);
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
      // The handoff proof is kept separately (lib/handoff.ts), so this reset
      // doesn't stop a refresh from asking for the sign-in link again.
      if (state === 'confirmed') resetSession();
    })();
  }, []);

  // SPEC-21: ask for the sign-in link. Only a browser that opened the
  // checkout has a proof; mint-handoff decides the rest (paid, within 24 h,
  // still entitled) and is retried while the webhook lands.
  useEffect(() => {
    const status = paymentStateFrom(new URLSearchParams(window.location.search).get('status'));
    const proof = readProof();
    if (!proof || status === 'failed') return;
    let live = true;
    setHandoff('pending');
    const result = mintOnce(proof);
    pendingLink.current = result.then((r) => ('link' in r ? r.link : null));
    void result.then((r) => {
      if (!live) return;
      if ('link' in r) {
        setLink(r.link);
        setHandoff('ready');
        track('web_funnel_handoff_link', { result: 'ready' });
      } else {
        setHandoff('off');
        track('web_funnel_handoff_link', { result: r.error });
      }
    });
    return () => {
      live = false;
    };
  }, []);

  // Render the QR after we know we need it (canvas mounts on !isIphone). It
  // holds the sign-in link once there is one: the phone's camera opens it,
  // and the link page there gets the app and keeps the link for it.
  useEffect(() => {
    const target = link ?? config.appStoreUrl;
    if (isIphone === false && qrRef.current && target) {
      QRCode.toCanvas(qrRef.current, target, {
        width: 168,
        margin: 1,
        color: { dark: '#23211e', light: '#fbf7ef' },
      }).catch(() => {
        // QR failing must never break the page; the link below still works.
      });
    }
  }, [isIphone, link]);

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

  // "Get Kinderwell": the sign-in link onto the clipboard, THEN the App
  // Store. The copy must start inside the tap (iOS refuses it later), so
  // nothing is awaited before startCopy.
  const getApp = (e: MouseEvent<HTMLElement>) => {
    if (link) {
      // Ready: copy, then let the browser follow the App Store link as the
      // real tap it is — the most reliable way into the App Store.
      void startCopy(link).then((ok) => track('web_funnel_get_app_tapped', { link: 'ready', copied: ok }));
      return;
    }
    if (handoff === 'pending' && pendingLink.current) {
      // Tapped before the link is back: the write starts now and is filled
      // in when it arrives; the App Store opens when it has (or after 8 s).
      e.preventDefault();
      if (waitingRef.current) return;
      waitingRef.current = true;
      setWaiting(true);
      void withTimeout(startCopy(pendingLink.current), TAP_WAIT_MS, false).then((ok) => {
        track('web_funnel_get_app_tapped', { link: 'pending', copied: ok });
        waitingRef.current = false;
        setWaiting(false);
        window.location.assign(config.appStoreUrl);
      });
      return;
    }
    track('web_funnel_get_app_tapped', { link: 'none', copied: false });
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

  const handoffOn = handoff !== 'off';

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
            {isIphone === null ? (
              <div className="mt-4 h-[58px]" aria-hidden="true" />
            ) : isIphone ? (
              <div className="mt-4">
                <PrimaryButton href={config.appStoreUrl || '#'} onClick={getApp}>
                  {waiting ? 'One moment…' : handoffOn ? 'Get Kinderwell' : 'Download on the App Store'}
                </PrimaryButton>
                {link ? (
                  // The universal link, so iOS opens the installed app on
                  // tap. ph-no-capture: belt and braces, autocapture is off.
                  <p className="mt-3 text-center text-[15px] text-ink/70">
                    Already have the app?{' '}
                    <a
                      href={link}
                      className="ph-no-capture font-semibold text-forest underline"
                      onClick={() => track('web_funnel_open_app_tapped')}
                    >
                      Open Kinderwell
                    </a>
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="mt-4 flex items-center gap-5">
                <canvas ref={qrRef} className="rounded-row bg-cream p-1" />
                <p className="text-[15px] leading-[1.6] text-ink/70">
                  {link
                    ? 'Point your iPhone camera here and open the link. It gets Kinderwell and signs you in.'
                    : 'Point your iPhone camera here — the App Store opens straight to Kinderwell.'}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-card bg-wash p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-clay-deep">
              Step 2
            </p>
            {handoffOn ? (
              <>
                <p className="mt-1.5 font-serif text-[19px] text-ink/90">Open it and tap Paste</p>
                <p className="mt-2 text-[15px] leading-[1.6] text-ink/70">
                  Kinderwell asks to paste your sign-in. Tap <strong>Paste</strong> and you’re in —
                  no password, no code.
                </p>
                <p className="mt-4 text-[15px] font-medium text-ink/80">
                  No Paste button? Sign in with this email:
                </p>
              </>
            ) : (
              <p className="mt-1.5 font-serif text-[19px] text-ink/90">Sign in with this email</p>
            )}
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
