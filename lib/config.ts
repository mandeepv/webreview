// Every externally-configured value flows through here. Pages never read
// process.env directly — one place to see what the funnel depends on.

function required(name: string, value: string | undefined): string {
  // NEXT_PUBLIC_ vars are inlined at build time; failing loudly at build/boot
  // beats silently rendering "$undefined/year" to a paying customer. But only
  // in PRODUCTION — in dev the whole funnel must be browsable with zero env
  // vars (backend calls just fail visibly), so we warn and stub instead.
  if (!value) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Missing required env var: ${name}`);
    }
    console.warn(`[config] ${name} not set — using dev placeholder (backend calls will fail)`);
    return `missing-${name.toLowerCase()}`;
  }
  return value;
}

/**
 * Where /manage sends subscribers. The TEST portal only when the build says
 * so explicitly (NEXT_PUBLIC_DODO_ENV=test, as CI and local dev do); anything
 * else — including the variable never being set — is the live portal. It
 * used to be the other way round, so setting the business id at go-live and
 * forgetting NEXT_PUBLIC_DODO_ENV=live sent paying customers to Dodo's test
 * portal from every "cancel at kinderwell.app/manage" we print (review
 * 2026-10-07, B-10). The go-live check: `curl -sI https://kinderwell.app/manage`
 * → Location on customer.dodopayments.com, not test.customer….
 */
export function portalUrlFrom(env: { portalUrl?: string; businessId?: string; dodoEnv?: string }): string {
  if (env.portalUrl) return env.portalUrl;
  if (!env.businessId) return 'https://customer.dodopayments.com';
  const host = env.dodoEnv === 'test' ? 'test.customer.dodopayments.com' : 'customer.dodopayments.com';
  return `https://${host}/login/${encodeURIComponent(env.businessId)}`;
}

export const config = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  // The live listing (OPS_RUNBOOK §1b.6). Public and stable, so it defaults
  // here rather than leaving the homepage badge and /welcome button dead
  // until someone remembers the Vercel env var.
  appStoreUrl:
    process.env.NEXT_PUBLIC_APP_STORE_URL || 'https://apps.apple.com/us/app/kinderwell/id6758403231',

  // Display prices. The CHARGED price lives on the Dodo product — if these
  // drift from the dashboard, the offer page lies. MANUAL_STEPS.md pins the
  // three places that must agree (here, Dodo, App Store).
  priceAnnual: Number(process.env.NEXT_PUBLIC_PRICE_ANNUAL ?? '59.99'),
  priceMonthly: Number(process.env.NEXT_PUBLIC_PRICE_MONTHLY ?? '12.99'),

  supabaseUrl: required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: required('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),

  // Where /manage sends subscribers to cancel or update payment. Preference:
  // an explicit URL; else Dodo's business-specific login (documented as
  // customer.dodopayments.com/login/<business_id>, test.customer… only with
  // NEXT_PUBLIC_DODO_ENV=test); else Dodo's Unified Customer Portal, which
  // also works but lists every Dodo merchant the buyer uses (review P1-1).
  dodoPortalUrl: portalUrlFrom({
    portalUrl: process.env.NEXT_PUBLIC_DODO_PORTAL_URL,
    businessId: process.env.NEXT_PUBLIC_DODO_BUSINESS_ID,
    dodoEnv: process.env.NEXT_PUBLIC_DODO_ENV,
  }),

  // Preview-only "skip" buttons on /email and /offer. On in local dev; on a
  // deployed build only while NEXT_PUBLIC_DEV_SKIP=1 AND checkout is in test
  // mode — so forgetting to delete the var can never expose a free path
  // around a live checkout.
  devSkip:
    process.env.NODE_ENV !== 'production' ||
    (process.env.NEXT_PUBLIC_DEV_SKIP === '1' && process.env.NEXT_PUBLIC_DODO_ENV !== 'live'),

  posthogKey: process.env.NEXT_PUBLIC_POSTHOG_KEY ?? '',
  posthogHost: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
  metaPixelId: process.env.NEXT_PUBLIC_META_PIXEL_ID ?? '',
} as const;

/**
 * 'dev' | 'prod' | 'unknown', from the Supabase project the build talks to —
 * the same rule as the app's src/lib/env.ts, so web and app events carry the
 * same `environment` (lib/analytics.ts, XR-7).
 */
export function environmentFor(supabaseUrl: string): 'dev' | 'prod' | 'unknown' {
  if (supabaseUrl.includes('<PROD_PROJECT_REF>')) return 'prod';
  if (supabaseUrl.includes('<DEV_PROJECT_REF>')) return 'dev';
  return 'unknown';
}
export const supabaseEnvironment = environmentFor(config.supabaseUrl);

export const perWeekAnnual = (config.priceAnnual / 52).toFixed(2);
// Per-day is the primary price display on the offer page — the consistently
// best-performing framing in web2app paywall tests (~+25% vs monthly-first).
export const perDayAnnual = (config.priceAnnual / 365).toFixed(2);
export const perDayMonthly = (config.priceMonthly / 30).toFixed(2);
