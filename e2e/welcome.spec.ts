// B2: the purchase page. Meta's pixel script is replaced by a recorder so the
// test sees exactly what the page asks the pixel to send, with no network.
import { ANALYTICS_HOSTS, livePosthog, outboundText } from './outbound';
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
  // PostHog really captures (to a stub), so B3's "the link reaches no
  // analytics" checks what PostHog would send, not an empty list.
  await livePosthog(page);
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

// ── B3: the SPEC-21 handoff — "Get Kinderwell" copies the sign-in link, then
// opens the App Store. The clipboard is replaced by a recorder (a test
// browser can't be asked to grant it). The App Store navigation never
// happens in the test: macOS WebKit hands apps.apple.com links to the App
// Store app, but Linux WebKit (CI) really loads them, and either a load or a
// blocked request (an error page) would replace this page and its
// recorders. So the recorder notes whether the page let the tap through,
// then cancels it itself; location.assign() calls are blocked by the route. What the test checks is that the tap was left to follow the App
// Store link (not cancelled) and what was on the clipboard by then.

const PROOF = { sessionId: SESSION.id, nonce: 'n'.repeat(43) };
const LINK = `https://open.kinderwell.app/k/${'K'.repeat(43)}`;

const CLIPBOARD_RECORDER = `
  window.__copied = [];
  window.__clicks = [];
  // On window, so it runs after React's handler (on document) has had its say.
  window.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a');
    if (!a) return;
    window.__clicks.push({ href: a.href, followed: !e.defaultPrevented, copiedBefore: window.__copied.length });
    // Recorded whether THE PAGE let the tap through; now keep the test on
    // this page (see the note above).
    if (a.hostname === 'apps.apple.com') e.preventDefault();
  });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: function (t) { window.__copied.push(t); return Promise.resolve(); },
    write: function (items) {
      return items[0].getType('text/plain').then(function (b) { return b.text(); })
        .then(function (t) { window.__copied.push(t); });
    },
  } });
`;

async function seedHandoff(page: import('@playwright/test').Page) {
  await page.addInitScript((proof) => localStorage.setItem('kw_handoff', JSON.stringify(proof)), PROOF);
  await page.addInitScript(CLIPBOARD_RECORDER);
  await page.route(/apps\.apple\.com/, (r) => r.abort());
}

const copied = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).__copied ?? []); // eslint-disable-line @typescript-eslint/no-explicit-any
const clicks = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).__clicks ?? []); // eslint-disable-line @typescript-eslint/no-explicit-any

test('B3: Get Kinderwell copies the sign-in link, then opens the App Store; the link reaches no analytics', async ({ page }) => {
  await seedHandoff(page);
  const minted: unknown[] = [];
  const outside: string[] = [];
  page.on('request', (r) => {
    // Decoded: PostHog gzips its batches, so raw text would see nothing.
    if (ANALYTICS_HOSTS.test(r.url())) outside.push(outboundText(r));
  });
  await page.route('**/api/mint-handoff', (r) => {
    minted.push(r.request().postDataJSON());
    return r.fulfill({ json: { link: LINK } });
  });

  await page.goto('/welcome?status=active&subscription_id=sub_e2e');
  await expect(page.getByRole('link', { name: 'Open Kinderwell' })).toHaveAttribute('href', LINK);
  expect(minted).toEqual([PROOF]);

  await page.getByRole('link', { name: 'Get Kinderwell' }).click();
  // Copied inside the tap, and the tap then follows the App Store link.
  expect(await clicks(page)).toEqual([
    { href: expect.stringMatching(/^https:\/\/apps\.apple\.com\//), followed: true, copiedBefore: 1 },
  ]);
  expect(await copied(page)).toEqual([LINK]);
  expect(outside.filter((u) => u.includes('K'.repeat(43)))).toEqual([]);
  // Nor any pixel call (the recorder keeps them all).
  expect(JSON.stringify(await page.evaluate(() => (window as any).__fbqCalls ?? []))).not.toContain('K'.repeat(43)); // eslint-disable-line @typescript-eslint/no-explicit-any
});

test('B3b: a tap before the link is back waits for it, copies it, then opens the App Store', async ({ page }) => {
  await seedHandoff(page);
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/api/mint-handoff', async (r) => {
    await held;
    await r.fulfill({ json: { link: LINK } });
  });

  await page.goto('/welcome?status=active&subscription_id=sub_e2e');
  await page.getByRole('link', { name: 'Get Kinderwell' }).click();
  await expect(page.getByRole('link', { name: 'One moment…' })).toBeVisible();
  // Held back until the copy can be filled in; the page opens the App Store itself.
  expect(await clicks(page)).toEqual([{ href: expect.stringMatching(/apps\.apple\.com/), followed: false, copiedBefore: 0 }]);
  expect(await copied(page)).toEqual([]);
  release();
  await expect.poll(() => copied(page)).toEqual([LINK]);
  // The wait ends (and location.assign(App Store) runs) once the link is copied.
  await expect(page.getByRole('link', { name: 'Get Kinderwell' })).toBeVisible();
});

test('B3c: without a sign-in link the page keeps today’s steps: App Store button and email sign-in', async ({ page }) => {
  await page.addInitScript(CLIPBOARD_RECORDER);
  let mints = 0;
  await page.route('**/api/mint-handoff', (r) => {
    mints++;
    return r.fulfill({ status: 404, json: { error: 'not_found' } });
  });

  // No proof in this browser (paid elsewhere): no request at all.
  await page.goto('/welcome?status=active&subscription_id=sub_e2e');
  await expect(page.getByRole('link', { name: 'Download on the App Store' })).toBeVisible();
  await expect(page.getByText('Sign in with this email')).toBeVisible();
  expect(mints).toBe(0);

  // A proof the server refuses: back to the same steps, nothing copied.
  await page.evaluate((proof) => localStorage.setItem('kw_handoff', JSON.stringify(proof)), PROOF);
  await page.reload();
  await expect(page.getByRole('link', { name: 'Download on the App Store' })).toBeVisible();
  expect(mints).toBe(1);
  await expect(page.getByRole('link', { name: 'Open Kinderwell' })).toHaveCount(0);
  expect(await copied(page)).toEqual([]);
});
