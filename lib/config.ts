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

  // Where /manage sends subscribers to cancel or update payment: Dodo's
  // customer portal (email sign-in, lists their Kinderwell subscription).
  // Override only if Dodo gives us a business-specific portal URL.
  dodoPortalUrl: process.env.NEXT_PUBLIC_DODO_PORTAL_URL || 'https://customer.dodopayments.com',

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

export const perWeekAnnual = (config.priceAnnual / 52).toFixed(2);
// Per-day is the primary price display on the offer page — the consistently
// best-performing framing in web2app paywall tests (~+25% vs monthly-first).
export const perDayAnnual = (config.priceAnnual / 365).toFixed(2);
export const perDayMonthly = (config.priceMonthly / 30).toFixed(2);
