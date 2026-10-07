import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AD_PARAMS = ['a', 'fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

// SPEC-21: the host of the app's sign-in links. It serves only the link page
// (/k/<key>) and Apple's association file; everything else goes to the main
// site, so the funnel never runs on a second origin (its own localStorage,
// its own pixel cookies). Must match lib/link-page.ts and the app's
// associatedDomains.
const HANDOFF_HOST = 'open.kinderwell.app';
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://kinderwell.app';

const NOINDEX = [
  '/quiz/:path*',
  '/email',
  '/building',
  '/plan',
  '/offer',
  '/welcome',
  '/waitlist',
  '/unsubscribe',
  '/u',
  '/manage',
  '/r/:path*',
  '/api/:path*',
];

// Allowlist for the report-only CSP (see headers() below).
const CSP = [
  "default-src 'self'",
  // 'unsafe-inline': the Meta pixel snippet and Next's inline bootstrap.
  // *.dodopayments.com: the checkout SDK injects its wallet script (Apple
  // Pay, from sdk-v2.hs.dodopayments.com) into THIS page, not its iframe —
  // without it every checkout logs a violation, and enforcing the policy
  // would break Apple Pay (review 2026-10-07, FE-6).
  "script-src 'self' 'unsafe-inline' https://connect.facebook.net https://*.posthog.com https://*.dodopayments.com",
  "connect-src 'self' https://*.posthog.com https://www.facebook.com https://connect.facebook.net https://*.dodopayments.com",
  'frame-src https://*.dodopayments.com https://www.facebook.com',
  "img-src 'self' data: blob: https://www.facebook.com https://*.posthog.com https://*.dodopayments.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "base-uri 'self'",
  "form-action 'self' https://*.dodopayments.com",
  "frame-ancestors 'none'",
  'report-uri /api/csp-report',
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The funnel is tiny and copy-driven; no image CDN needed in v1 — local
  // assets only, so `next/image` optimization stays default.
  reactStrictMode: true,
  poweredByHeader: false,
  // Pin tracing to this repo; a stray lockfile higher up the tree otherwise
  // makes Next guess the workspace root (P3-9).
  outputFileTracingRoot: path.dirname(fileURLToPath(import.meta.url)),

  // Ad parameters that land on the brand homepage belong on /start, the
  // message-matched ad landing. Doing it here (query string is carried over)
  // keeps / static and edge-cached instead of a server render per hit.
  async redirects() {
    return [
      {
        source: '/:path((?!k/|\\.well-known/).*)',
        has: [{ type: 'host', value: HANDOFF_HOST }],
        destination: `${SITE_URL}/:path`,
        permanent: false,
      },
      ...AD_PARAMS.map((key) => ({
        source: '/',
        has: [{ type: 'query', key }],
        destination: '/start',
        permanent: false,
      })),
    ];
  },

  // Baseline security headers. The Content-Security-Policy is REPORT-ONLY
  // (review P3-6): the Dodo overlay, Meta pixel and PostHog each load
  // scripts/frames from their own origins, and an enforced CSP that missed
  // one would silently break checkout. Browsers report would-be violations
  // to /api/csp-report (Vercel logs, "[csp-report]"); once a few weeks of
  // real traffic show none from our own pages, switch the header name to
  // Content-Security-Policy.
  // Permissions-Policy leaves `payment` alone — Apple Pay inside the Dodo
  // overlay iframe depends on it.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      // Every page except the sign-in link page (/k/<key>), which enforces a
      // strict policy of its own and must never report: a report carries the
      // page's URL, and that URL holds a login credential (SPEC-21).
      {
        source: '/:path((?!k/).*)',
        headers: [{ key: 'Content-Security-Policy-Report-Only', value: CSP }],
      },
      // Mid-funnel pages mean nothing out of context ("Payment confirmed" to
      // someone from Google). Only /, /start and /legal/* are indexable.
      ...NOINDEX.map((source) => ({
        source,
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      })),
      // The link page's URL holds a sign-in key: it must never be sent on as
      // a Referer, and no search engine may keep it. Listed after the
      // baseline so these replace its values (a rule listed later wins); the
      // route sends the same, with its own CSP and no-store. Not in NOINDEX:
      // that rule's value would drop noarchive.
      {
        source: '/k/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      },
    ];
  },
};

export default nextConfig;
