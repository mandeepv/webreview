'use client';

// The web port of the app's onboarding components (OnboardingScreen /
// OptionRow / ProgressRail — design/onboarding-lesson-revamp branch). Values
// come from the canvas tokens in tailwind.config.ts; the anatomy notes below
// mirror the app components' own comments so the two stay recognizable twins.

import Link from 'next/link';
import { MouseEvent, ReactNode } from 'react';

/**
 * Serif text where *starred* spans render italic — the design's emphasis move
 * ("Tell us about your *kids*."). One string at the call site, not nested tags.
 */
export function RichHeadline({ children, className }: { children: string; className?: string }) {
  const parts = children.split('*');
  return (
    <h1 className={className ?? 'font-serif text-[30px] font-normal leading-[1.18] text-ink'}>
      {parts.map((part, i) => (i % 2 === 1 ? <em key={i}>{part}</em> : <span key={i}>{part}</span>))}
    </h1>
  );
}

/** Body copy where highlighted segments render in forest — the app's HighlightText. */
export function Rich({ body }: { body: (string | { text: string; hl: true })[] }) {
  return (
    <>
      {body.map((seg, i) =>
        typeof seg === 'string' ? (
          <span key={i} className="whitespace-pre-line">
            {seg}
          </span>
        ) : (
          <span key={i} className="font-semibold text-forest">
            {seg.text}
          </span>
        )
      )}
    </>
  );
}

/** The canvas eyebrow label: mono, uppercase, clay-deep. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[12px] font-medium uppercase tracking-[0.14em] text-clay-deep">
      {children}
    </p>
  );
}

/** The 58px forest pill — every primary action. */
export function PrimaryButton({
  children,
  onClick,
  href,
  disabled,
  full = true,
}: {
  children: ReactNode;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  href?: string;
  disabled?: boolean;
  full?: boolean;
}) {
  const cls = `${full ? 'w-full' : 'px-12'} flex h-[58px] items-center justify-center rounded-full bg-forest text-[17px] font-semibold text-cream transition active:scale-[0.99] hover:bg-forest-deep disabled:opacity-40`;
  if (href) {
    // Off-site (the App Store): a plain link that the browser follows as a
    // real tap, with the page's handler run first. next/link is for our routes.
    if (/^https?:\/\//.test(href)) {
      return (
        <a href={href} onClick={onClick} className={cls}>
          {children}
        </a>
      );
    }
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  );
}

/**
 * The option row — the single most-repeated element. States from the canvas:
 * unselected = wash bg + hairline indicator; selected = forest bg + cream
 * text. Single vs multi is carried by the INDICATOR SHAPE (circle vs rounded
 * square), never by colour — a parent should never have to guess whether
 * more than one answer is allowed.
 */
export function OptionRow({
  label,
  selected = false,
  mode = 'single',
  onClick,
}: {
  label: string;
  selected?: boolean;
  mode?: 'single' | 'multi';
  onClick: () => void;
}) {
  const indicatorShape = mode === 'multi' ? 'rounded-[7px]' : 'rounded-full';
  return (
    <button
      onClick={onClick}
      role={mode === 'multi' ? 'checkbox' : 'radio'}
      aria-checked={selected}
      className={`flex w-full items-center gap-3.5 rounded-row px-4 py-[15px] text-left transition active:opacity-90 ${
        selected ? 'bg-forest' : 'bg-wash hover:bg-wash/70'
      }`}
    >
      <span
        className={`flex h-[23px] w-[23px] shrink-0 items-center justify-center border-[1.5px] ${indicatorShape} ${
          selected ? 'border-cream bg-cream/15' : 'border-ink/30'
        }`}
      >
        {selected ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path
              d="M20 6L9 17l-5-5"
              stroke="#fbf7ef"
              strokeWidth="3.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </span>
      <span className={`text-[17px] font-medium ${selected ? 'text-cream' : 'text-ink/85'}`}>
        {label}
      </span>
    </button>
  );
}

/**
 * One row: back chevron in a 44px hit target + a single continuous progress
 * track filled to the current step. The chevron lives INSIDE this row so it
 * never appears and disappears between screens.
 */
export function ProgressRail({
  fraction,
  onBack,
}: {
  fraction: number;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onBack}
        aria-label="Back"
        className="flex h-11 w-11 shrink-0 items-center justify-center"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path
            d="M15 18l-6-6 6-6"
            stroke="#23211e"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div className="h-[4px] flex-1 overflow-hidden rounded-full bg-ink/10">
        <div
          className="h-full rounded-full bg-forest transition-all duration-300"
          style={{ width: `${Math.min(100, Math.round(fraction * 100))}%` }}
        />
      </div>
    </div>
  );
}

/**
 * The screen frame: 30px gutters, phone-width column on every viewport
 * (desktop buyers are legit; the paper canvas fills the rest).
 */
export function Shell({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <div className={dark ? 'min-h-dvh bg-forest-deep' : 'min-h-dvh bg-paper'}>
      <main className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col px-[30px] pb-8 pt-5">
        {children}
      </main>
    </div>
  );
}

// Present only at compliance moments (landing, email capture, offer,
// welcome) — never on quiz steps or transition screens, which top funnels
// keep clean. Quiet by design: it must be findable, not read.
export function LegalFooter() {
  return (
    <footer className="mt-10 flex justify-center gap-5 pb-2 text-[12px] text-ink/40">
      <Link href="/legal/privacy" className="hover:text-ink/70">
        Privacy
      </Link>
      <span aria-hidden>·</span>
      <Link href="/legal/terms" className="hover:text-ink/70">
        Terms
      </Link>
      <span aria-hidden>·</span>
      <Link href="/legal/refunds" className="hover:text-ink/70">
        Refund policy
      </Link>
      <span aria-hidden>·</span>
      {/* Plain <a>: /manage is a redirect route, not a page to prefetch. */}
      <a href="/manage" className="hover:text-ink/70">
        Manage subscription
      </a>
    </footer>
  );
}
