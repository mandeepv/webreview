import type { Metadata, Viewport } from 'next';
import { Newsreader, Figtree, IBM_Plex_Mono } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import { config } from '@/lib/config';
import AnalyticsBoot from './analytics-boot';

// The app's onboarding faces, same trio: Newsreader carries every headline
// (with one italic phrase — the signature move), Figtree does UI, IBM Plex
// Mono is reserved for step/eyebrow labels.
const serif = Newsreader({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  weight: ['300', '400', '500'],
  variable: '--font-serif',
});
const sans = Figtree({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-sans' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Kinderwell — Calmer hard moments, closer kids',
  description:
    'Short, science-based lessons that teach you exactly what to say and do in the parenting moments that keep going wrong.',
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#eee9dc',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        {/* Meta Pixel base — inert until NEXT_PUBLIC_META_PIXEL_ID is set.
            autoConfig OFF: otherwise the pixel auto-sends button text as
            "SubscribedButtonClick" events, which here means quiz answers
            about a parent's stress and their child's behavior going to Meta
            — sensitive data we promise not to share, and the kind of signal
            that gets an ad account's events restricted. We send only the
            events we name. The first PageView fires here; client-side route
            changes fire theirs from AnalyticsBoot. */}
        {config.metaPixelId ? (
          <Script id="meta-pixel" strategy="afterInteractive">
            {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('set', 'autoConfig', false, '${config.metaPixelId}');
fbq('init', '${config.metaPixelId}');
fbq('track', 'PageView');`}
          </Script>
        ) : null}
        <AnalyticsBoot />
        {children}
      </body>
    </html>
  );
}
