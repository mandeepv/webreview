// Test environment for the integration tests. Every file in _integration/
// imports this FIRST — handlers read their secrets and build their Supabase
// client when their module loads, so the environment must be in place before
// any handler is imported (they are imported dynamically, after this runs).
//
// Safety: the tests write rows, create auth users and would send email if a
// real key were present. This module refuses to run against anything but a
// local Supabase, and overwrites every secret with a fake value so a developer
// shell holding real keys can never leak into a test run.

const url = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('API_URL') ?? '';
const serviceKey =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  Deno.env.get('SERVICE_ROLE_KEY') ??
  Deno.env.get('SECRET_KEY') ??
  '';

/**
 * True only when explicitly enabled (INTEGRATION_TESTS=1) AND a Supabase is
 * configured — so a shell that happens to hold a SUPABASE_URL never turns a
 * plain `npm test` into a database run.
 */
export const INTEGRATION = Deno.env.get('INTEGRATION_TESTS') === '1' && url !== '' && serviceKey !== '';

if (INTEGRATION) {
  const host = new URL(url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(
      `Refusing to run integration tests against ${host}: SUPABASE_URL must point at a local Supabase.`
    );
  }
}

export const SUPABASE_URL = url;
export const SERVICE_ROLE_KEY = serviceKey;

/** Fake secrets, shared by the fakes and the assertions. */
export const TEST = {
  webhookSecretBytes: new TextEncoder().encode('integration-test-webhook-secret'),
  proxySecret: 'integration-test-proxy-secret',
  sweepSecret: 'integration-test-sweep-secret',
  siteUrl: 'https://kinderwell.test',
  posthogHost: 'https://posthog.test',
  alertEmail: 'owner@example.com',
  supportEmail: 'support@example.com',
  productAnnual: 'pdt_TEST_ANNUAL',
  productMonthly: 'pdt_TEST_MONTHLY',
  pixelId: '1234567890',
} as const;

export const WEBHOOK_SECRET = `whsec_${btoa(String.fromCharCode(...TEST.webhookSecretBytes))}`;

const env: Record<string, string> = {
  SUPABASE_URL: url,
  SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  DODO_ENV: 'test',
  DODO_API_KEY: 'test_fake_dodo_key',
  DODO_WEBHOOK_SECRET: WEBHOOK_SECRET,
  DODO_PRODUCT_ANNUAL: TEST.productAnnual,
  DODO_PRODUCT_MONTHLY: TEST.productMonthly,
  RESEND_API_KEY: 're_fake_key',
  EMAIL_FROM: 'Kinderwell <hello@example.com>',
  SUPPORT_EMAIL: TEST.supportEmail,
  ALERT_EMAIL: TEST.alertEmail,
  SITE_URL: TEST.siteUrl,
  APP_STORE_URL: 'https://apps.apple.com/us/app/kinderwell/id0000000000',
  META_PIXEL_ID: TEST.pixelId,
  META_CAPI_TOKEN: 'fake_capi_token',
  POSTHOG_KEY: 'phc_…_key',
  POSTHOG_HOST: TEST.posthogHost,
  PRICE_ANNUAL: '59.99',
  PRICE_MONTHLY: '12.99',
  FUNNEL_PROXY_SECRET: TEST.proxySecret,
  SWEEP_SECRET: TEST.sweepSecret,
  UNSUBSCRIBE_SECRET: 'integration-test-unsubscribe-secret',
  MAILING_ADDRESS: 'PO Box 1, Testville, CA 90000',
};
if (INTEGRATION) {
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
  for (const k of ['META_TEST_EVENT_CODE', 'ALLOW_UNAUTHENTICATED_FUNNEL']) Deno.env.delete(k);
}

/**
 * Deno.test for integration tests: skipped when no local Supabase is running
 * (so `deno test` on a laptop without Docker still passes), and with the
 * resource sanitizers off — supabase-js keeps connections and timers alive
 * between calls, which the sanitizers would report as leaks.
 */
export function itest(name: string, fn: () => Promise<void>) {
  Deno.test({ name, ignore: !INTEGRATION, sanitizeOps: false, sanitizeResources: false, fn });
}
