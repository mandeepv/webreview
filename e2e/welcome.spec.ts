// B2: the purchase page. Meta's pixel script is replaced by a recorder so the
// test sees exactly what the page asks the pixel to send, with no network.
import { expect, test } from '@playwright/test';

const SESSION = {
  id: '0b6f5a3e-1d2c-4e5f-8a9b-0c1d2e3f4a5b',
  answers: { name: 'Sam' },
  utm: {},
  landingVariant: 'default',
  emailCaptured: true,
  userId: 'user-e2e',
  email: 'buyer@example.com',
  startedAt: Date.now(),
};

const PIXEL_RECORDER = `
  window.__fbqCalls = [];
  window.fbq.callMethod = function () { window.__fbqCalls.push(Array.prototype.slice.call(arguments)); };
  (window.fbq.queue || []).forEach(function (args) { window.fbq.callMethod.apply(null, args); });
  window.fbq.queue = [];
`;

test.beforeEach(async ({ page }) => {
  await page.route(/connect\.facebook\.net/, (r) => r.fulfill({ contentType: 'application/javascript', body: PIXEL_RECORDER }));
  await page.route(/facebook\.com|posthog\.com/, (r) => r.fulfill({ status: 204, body: '' }));
  await page.addInitScript((s) => {
    if (sessionStorage.getItem('e2e-seeded')) return; // seed once; the page then owns storage
    sessionStorage.setItem('e2e-seeded', '1');
    localStorage.setItem('kw_funnel_session', JSON.stringify(s));
    localStorage.setItem('kw_purchase_event_id', 'evt_e2e');
    localStorage.setItem('kw_purchase_plan', 'annual');
  }, SESSION);
});

type Call = unknown[];
const purchases = (calls: Call[]) => calls.filter((c) => c[0] === 'track' && c[1] === 'Purchase');

test('B2: a confirmed payment fires one Purchase with the checkout’s event id, and the URL holds no email', async ({ page }) => {
  await page.goto('/welcome?status=active&subscription_id=sub_e2e&email=buyer%40example.com');
  await expect(page).toHaveURL(/\/welcome\?status=active&subscription_id=sub_e2e$/);
  await expect(page.getByText('buyer@example.com').first()).toBeVisible();

  await expect.poll(async () => purchases(await page.evaluate(() => (window as any).__fbqCalls ?? [])).length).toBe(1); // eslint-disable-line @typescript-eslint/no-explicit-any
  const calls: Call[] = await page.evaluate(() => (window as any).__fbqCalls); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [purchase] = purchases(calls);
  expect(purchase[2]).toEqual({ value: 59.99, currency: 'USD' });
  expect(purchase[3]).toEqual({ eventID: 'evt_e2e' });
  // Advanced matching is attached BEFORE the Purchase (P2-2b).
  const initWithEmail = calls.findIndex((c) => c[0] === 'init' && (c[2] as { em?: string } | undefined)?.em);
  expect(initWithEmail).toBeGreaterThan(-1);
  expect(initWithEmail).toBeLessThan(calls.indexOf(purchase));

  // A refresh must not fire a second Purchase.
  await page.reload();
  await expect(page.getByText('buyer@example.com').first()).toBeVisible();
  await page.waitForTimeout(1000);
  expect(purchases(await page.evaluate(() => (window as any).__fbqCalls ?? []))).toHaveLength(0); // eslint-disable-line @typescript-eslint/no-explicit-any
});

test('B2b: an unconfirmed or direct visit never tells Meta a sale happened', async ({ page }) => {
  for (const query of ['?status=failed&subscription_id=sub_x', '']) {
    await page.goto(`/welcome${query}`);
    await page.waitForTimeout(1500);
    expect(purchases(await page.evaluate(() => (window as any).__fbqCalls ?? [])), query || 'direct').toHaveLength(0); // eslint-disable-line @typescript-eslint/no-explicit-any
  }
});
