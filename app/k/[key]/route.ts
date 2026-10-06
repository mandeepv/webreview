import { NextRequest } from 'next/server';
import QRCode from 'qrcode';
import { config } from '@/lib/config';
import { KEY_RE, LINK_BASE, LINK_PAGE_CSP, renderLinkPage } from '@/lib/link-page';

// open.kinderwell.app/k/<key> — what a SPEC-21 sign-in link opens when the
// app ISN'T installed: from the welcome email, from the desktop QR code, or
// a link pasted into Safari. When the app is installed, iOS hands the link
// straight to it (the AASA file at /.well-known claims /k/*) and this never
// loads. kinderwell.app's own links to it are on another host on purpose:
// a universal link tapped on its own domain opens Safari, not the app. For
// the same reason this page's "Open Kinderwell" points at the same key on
// kinderwell.app (lib/link-page.ts), where this route also answers.
//
// The key in this URL is a LOGIN CREDENTIAL (app INVARIANTS #29). So:
//   * a route handler, not a page: app/layout.tsx and its Meta pixel and
//     PostHog never load here, and the HTML loads nothing from anywhere;
//   * Referrer-Policy: no-referrer, so the App Store never sees this URL;
//   * no-store and noindex, so no cache or search engine keeps it;
//   * an enforced CSP that allows only this page's own script and style;
//   * the key is never looked up: valid, used or expired is for the app's
//     redeem-handoff to say, and a page that answered would be an oracle
//     for guessing keys.
// Vercel's request log does record the path; the key is single use and
// lasts 7 days at most, and the log is only readable by the owner.

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key: raw } = await params;
  const key = KEY_RE.test(raw) ? raw : null;
  const ua = req.headers.get('user-agent') ?? '';
  const phone = /iPhone|iPad|iPod/.test(ua);

  let qrSvg: string | undefined;
  if (key && !phone) {
    qrSvg = await QRCode.toString(LINK_BASE + key, {
      type: 'svg',
      margin: 1,
      color: { dark: '#23211e', light: '#fbf7ef' },
    }).catch(() => undefined);
  }

  return new Response(renderLinkPage({ key, phone, appStoreUrl: config.appStoreUrl, qrSvg }), {
    status: key ? 200 : 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Content-Security-Policy': LINK_PAGE_CSP,
      Vary: 'User-Agent',
    },
  });
}
