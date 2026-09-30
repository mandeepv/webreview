'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PrimaryButton } from '@/components/ui';
import { config } from '@/lib/config';
import { getSession, save } from '@/lib/session';
import { track } from '@/lib/analytics';
import { pixel } from '@/lib/meta';

// The brand homepage — one screen, modeled on prayerlock.com: a headline that
// names the problem, a one-line mechanism, the actions, and the product
// itself on the right. Two actions on purpose: the quiz is primary (a web
// purchase keeps ~95% of revenue), the App Store badge is for people who
// came looking for the app and should never be made to hunt for it.
export default function Home() {
  const router = useRouter();

  useEffect(() => {
    track('web_home_viewed');
    pixel('ViewContent', { content_name: 'home' });
  }, []);

  function startQuiz() {
    track('web_home_cta_clicked', { target: 'quiz' });
    const s = getSession();
    // Tag the entry so a purchase can be traced back to the homepage — but
    // never overwrite a paid first touch that already set the variant.
    if (Object.keys(s.utm).length === 0) {
      s.landingVariant = 'home';
      save(s);
    }
    router.push('/quiz/1');
  }

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <header className="mx-auto flex w-full max-w-6xl items-center gap-2.5 px-6 pt-6 sm:px-10">
        <Image
          src="/kinderwell-icon.png"
          alt=""
          width={34}
          height={34}
          className="rounded-[9px] ring-1 ring-ink/10"
          priority
        />
        <span className="font-serif text-[21px] text-ink">Kinderwell</span>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-14 px-6 py-12 sm:px-10 lg:flex-row lg:gap-20">
        <div className="w-full max-w-2xl">
          <h1 className="font-serif text-[44px] font-normal leading-[1.06] tracking-[-0.01em] text-ink sm:text-[60px] lg:text-[72px]">
            The hardest job you’ll ever do. And{' '}
            <em className="text-forest">nobody trained you</em> for it.
          </h1>
          <p className="mt-5 text-[19px] leading-[1.5] text-ink/65 sm:text-[22px]">
            Learn what to say in the moments that keep going wrong,{' '}
            <span className="font-medium text-forest">ten minutes a day</span>.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:items-center">
            <div className="w-full sm:w-[290px]">
              <PrimaryButton onClick={startQuiz}>
                Take the 2-minute quiz
              </PrimaryButton>
            </div>
            <a
              href={config.appStoreUrl}
              onClick={() => track('web_home_cta_clicked', { target: 'app_store' })}
              className="transition-opacity hover:opacity-85"
            >
              {/* Apple's official badge, unmodified, per their marketing guidelines. */}
              <img
                src="/app-store-badge.svg"
                alt="Download on the App Store"
                width={174}
                height={58}
                className="h-[58px] w-auto"
              />
            </a>
          </div>

          <ul className="mt-9 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[14px] text-ink/55 sm:justify-start">
            <li className="flex items-center gap-2">
              <span className="text-forest">✓</span> 5–10 minute lessons
            </li>
            <li className="flex items-center gap-2">
              <span className="text-forest">✓</span> Grounded in child-development research
            </li>
            <li className="flex items-center gap-2">
              <span className="text-forest">✓</span> A sequenced path, not a feed of tips
            </li>
          </ul>
        </div>

        <PhoneMockup />
      </main>

      <footer className="px-6 pb-6 text-center text-[13px] text-ink/45">
        <nav className="flex flex-wrap justify-center gap-x-2 gap-y-1">
          <Link href="/legal/terms" className="hover:text-ink/75">
            Terms of Service
          </Link>
          <span aria-hidden>·</span>
          <Link href="/legal/privacy" className="hover:text-ink/75">
            Privacy Policy
          </Link>
          <span aria-hidden>·</span>
          <Link href="/legal/refunds" className="hover:text-ink/75">
            Refund Policy
          </Link>
          <span aria-hidden>·</span>
          <a href="mailto:hello@kinderwell.app" className="hover:text-ink/75">
            Contact Us
          </a>
          <span aria-hidden>·</span>
          <a href="/manage" className="hover:text-ink/75">
            Manage Subscription
          </a>
        </nav>
        <p className="mt-2">© {new Date().getFullYear()} Kinderwell. All rights reserved.</p>
      </footer>
    </div>
  );
}

/**
 * A lesson screen drawn in the app's own tokens, standing in for a screen
 * recording. The copy is REAL, verbatim — screen 3 of the Serve & Return
 * lesson (mamalearn src/lessons/content/serveReturn.ts, "Connection" on the
 * path) — so the page never shows a lesson the app doesn't have. If a demo
 * video is recorded later, it replaces this whole component.
 */
function PhoneMockup() {
  const rows = [
    { icon: '🎾', text: 'A serve is an emotional cue' },
    { icon: '🏓', text: 'A return is an attentive response' },
    { icon: '🔄', text: 'The rally continues' },
  ];
  return (
    <div className="relative shrink-0" role="img" aria-label="A Kinderwell lesson in the iPhone app">
      <div aria-hidden className="absolute -inset-10 rounded-full bg-wash/80 blur-2xl" />
      <div className="relative w-[290px] rounded-[48px] bg-ink p-[10px] shadow-[0_30px_60px_-20px_rgba(35,33,30,0.45)] sm:w-[320px]">
        <div className="flex aspect-[9/19.5] flex-col overflow-hidden rounded-[39px] bg-paper px-5 pb-6 pt-3">
          <div className="flex items-center justify-between px-2 text-[12px] font-semibold text-ink">
            <span>9:41</span>
            <span className="h-[22px] w-[80px] rounded-full bg-ink" />
            <span className="tracking-tight">●●●</span>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <span className="text-[18px] leading-none text-ink/70">‹</span>
            <div className="h-[4px] flex-1 overflow-hidden rounded-full bg-ink/10">
              <div className="h-full w-[18%] rounded-full bg-forest" />
            </div>
          </div>

          <p className="mt-7 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-clay-deep">
            Connection
          </p>
          <p className="mt-2 font-serif text-[27px] leading-[1.15] text-ink">
            Think of a <em>Tennis Match</em>
          </p>
          <p className="mt-3 text-[13px] leading-[1.5] text-ink/65">
            Imagine a tennis match instead of a conversation.
          </p>

          <div className="mt-5 space-y-2.5">
            {rows.map((r) => (
              <div key={r.text} className="flex items-center gap-3 rounded-row bg-wash px-3.5 py-3">
                <span className="text-[18px]">{r.icon}</span>
                <span className="text-[13px] font-medium text-ink/85">{r.text}</span>
              </div>
            ))}
          </div>

          <div className="mt-auto flex h-[46px] items-center justify-center rounded-full bg-forest text-[14px] font-semibold text-cream">
            Next
          </div>
        </div>
      </div>
    </div>
  );
}
