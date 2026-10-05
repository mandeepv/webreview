// What the built site sends before any browser runs a script (spec item 6,
// "HTTP checks"): redirects that keep emails out of URLs, server-rendered ad
// copy, and the headers that keep mid-funnel pages out of search.
import { expect, test } from '@playwright/test';
import { VARIANTS } from '../app/start/variants';

test('/welcome redirects away from Dodo’s ?email= on the server, before any page script runs (P1-9b)', async ({ request }) => {
  const res = await request.get('/welcome?email=buyer%40example.com&status=active&subscription_id=sub_1&payment_id=pay_1', {
    maxRedirects: 0,
  });
  expect(res.status()).toBe(307);
  const location = res.headers()['location'];
  expect(location).toBe('/welcome?status=active&subscription_id=sub_1&payment_id=pay_1');
  expect(location).not.toContain('example.com');
  // Note: Next's redirect() response BODY still carries the original params
  // in its internal router data. Browsers follow a 307 without rendering or
  // running that body, so no script (pixel, PostHog) ever sees it; the
  // landed URL is what they read, and B2 checks that. Asserting on the body
  // would test Next's internals, not a leak.
});

test('a clean /welcome URL is served as is', async ({ request }) => {
  const res = await request.get('/welcome?status=active&subscription_id=sub_1', { maxRedirects: 0 });
  expect(res.status()).toBe(200);
});

test('each ad variant’s headline is in the first HTML response of /start (P1-13)', async ({ request }) => {
  for (const [key, variant] of Object.entries(VARIANTS)) {
    const html = await (await request.get(`/start?a=${key}`)).text();
    const emphasised = variant.headline.split('*')[1]; // RichHeadline wraps this part in its own element
    expect(html, key).toContain(emphasised);
  }
});

test('ad clicks that land on / are sent to /start with their parameters', async ({ request }) => {
  const res = await request.get('/?fbclid=CLICK123&a=tantrums', { maxRedirects: 0 });
  expect([307, 308]).toContain(res.status());
  expect(res.headers()['location']).toContain('/start?');
  expect(res.headers()['location']).toContain('fbclid=CLICK123');
});

test('mid-funnel pages are noindex; the homepage, ad landing and legal pages are not', async ({ request }) => {
  for (const path of ['/quiz/1', '/email', '/plan', '/offer', '/welcome', '/waitlist']) {
    expect((await request.get(path)).headers()['x-robots-tag'], path).toContain('noindex');
  }
  for (const path of ['/', '/start', '/legal/privacy', '/legal/terms', '/legal/refunds']) {
    expect((await request.get(path)).headers()['x-robots-tag'], path).toBeUndefined();
  }
});

test('every page sends the baseline security headers and hides the framework', async ({ request }) => {
  for (const path of ['/', '/start', '/offer', '/welcome']) {
    const h = (await request.get(path)).headers();
    expect(h['x-content-type-options'], path).toBe('nosniff');
    expect(h['x-frame-options'], path).toBe('DENY');
    expect(h['referrer-policy'], path).toBe('strict-origin-when-cross-origin');
    expect(h['strict-transport-security'], path).toContain('max-age=');
    expect(h['x-powered-by'], path).toBeUndefined();
  }
});

test('robots.txt is served', async ({ request }) => {
  const res = await request.get('/robots.txt');
  expect(res.status()).toBe(200);
});

test('every page carries the report-only CSP, with reports going to our endpoint (P3-6)', async ({ request }) => {
  const csp = (await request.get('/start')).headers()['content-security-policy-report-only'];
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain('https://*.dodopayments.com'); // the checkout overlay must stay allowed
  expect(csp).toContain('report-uri /api/csp-report');
  expect((await request.post('/api/csp-report', { data: { 'csp-report': {} } })).status()).toBe(204);
});

test('shared links get a 1200×630 preview image (P2-5)', async ({ request }) => {
  const html = await (await request.get('/start')).text();
  const og = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
  expect(og).toBeTruthy();
  const img = await request.get(new URL(og!).pathname + new URL(og!).search);
  expect(img.status()).toBe(200);
  expect(img.headers()['content-type']).toContain('image/png');
  expect(html).toContain('summary_large_image');
});
