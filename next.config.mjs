/** @type {import('next').NextConfig} */
const nextConfig = {
  // The funnel is tiny and copy-driven; no image CDN needed in v1 — local
  // assets only, so `next/image` optimization stays default.
  reactStrictMode: true,

  // Baseline security headers. Deliberately NO Content-Security-Policy yet:
  // the Dodo overlay, Meta pixel and PostHog each load scripts/frames from
  // their own origins, and a wrong CSP silently breaks checkout. Add one in
  // Report-Only mode first if we ever want it.
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
    ];
  },
};

export default nextConfig;
