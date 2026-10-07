// B1: the whole funnel on an iPhone, ad landing → quiz → email → plan → offer
// → checkout. The backend and third parties are stubbed, so this checks the
// site's own flow; the edge functions have their own integration tests.
import { expect, test, type Page } from '@playwright/test';
import { ACT3_START, QUIZ_STEPS } from '../lib/quiz/questions';
import { livePosthog, outboundText } from './outbound';

/**
 * Set by the weekly workflow: run against a deployed preview and its REAL
 * test-mode backend (dev Supabase + Dodo test mode), stopping once Dodo's
 * checkout opens. Never pays.
 */
const REAL_BACKEND = !!process.env.E2E_BASE_URL;

async function stubOutside(page: Page) {
  await page.route(/facebook\.(com|net)|posthog\.com/, (r) => r.fulfill({ status: 204, body: '' }));
  await page.route(/checkout\.dodopayments\.com/, (r) =>
    r.fulfill({ contentType: 'text/html', body: '<html><body>Dodo checkout (stub)</body></html>' })
  );
}

// A name no analytics payload contains by accident ("Sam" is inside "SameSite").
const NAME = 'Zephyrine';

test('B1: an iPhone visitor goes from the ad landing to an open checkout; no answer, name or email reaches PostHog or Meta', async ({ page }) => {
  const captured: Array<Record<string, unknown>> = [];
  const checkouts: Array<Record<string, unknown>> = [];
  // Everything sent to PostHog, decoded (review 2026-10-07, test gap #5:
  // "answers never reach PostHog" had no automated check).
  const toPosthog: string[] = [];
  // The labels of the options this run picks: what autocapture's $el_text
  // or the pixel's automatic button events would leak. Short ones ("Yes")
  // could turn up by chance, so only distinctive ones are checked.
  const pickedLabels: string[] = [];
  page.on('request', (r) => {
    if (/posthog\.com/.test(r.url())) toPosthog.push(outboundText(r));
    if (r.method() !== 'POST') return;
    if (r.url().endsWith('/api/capture-email')) captured.push(r.postDataJSON());
    if (r.url().endsWith('/api/create-checkout')) checkouts.push(r.postDataJSON());
  });
  if (!REAL_BACKEND) {
    await stubOutside(page);
    await livePosthog(page);
    await page.route('**/api/capture-email', (r) => r.fulfill({ json: { userId: 'user-e2e' } }));
    await page.route('**/api/create-checkout', (r) =>
      r.fulfill({ json: { checkoutUrl: 'https://test.checkout.dodopayments.com/session/cks_e2e', eventId: 'evt_e2e' } })
    );
  }

  await page.goto('/start?a=tantrums&fbclid=CLICK_E2E');
  await page.getByRole('link', { name: 'Let’s begin' }).click();

  for (const [i, step] of QUIZ_STEPS.entries()) {
    await expect(page, step.id).toHaveURL(new RegExp(`/quiz/${i + 1}$`));
    if (step.type === 'name') {
      await page.getByPlaceholder('Your first name').fill(NAME);
      await page.getByRole('button', { name: 'Continue' }).click();
    } else if (step.type === 'single') {
      const option = step.options!.find((o) => !o.disqualifies)!;
      pickedLabels.push(option.label);
      await page.getByRole('radio', { name: option.label, exact: true }).click(); // advances on its own
    } else if (step.type === 'multi') {
      pickedLabels.push(step.options![0].label);
      await page.getByRole('checkbox', { name: step.options![0].label, exact: true }).click();
      await page.getByRole('button', { name: 'Continue' }).click();
    } else {
      await page.getByRole('button', { name: step.cta ?? 'Continue' }).click();
    }

    if (step.next === 'email') {
      await expect(page).toHaveURL(/\/email$/);
      await page.getByPlaceholder('you@example.com').fill(REAL_BACKEND ? `e2e-${Date.now()}@example.com` : 'e2e@example.com');
      await page.getByRole('button', { name: 'See my plan' }).click();
      await expect(page).toHaveURL(/\/plan$/, { timeout: 20_000 }); // via the ~9 s /building screen
      await page.getByRole('link', { name: 'This is me' }).click();
      await expect(page).toHaveURL(new RegExp(`/quiz/${ACT3_START}$`));
    }
  }

  await expect(page).toHaveURL(/\/offer$/);
  await expect(page.getByText(new RegExp(`${NAME}, your plan is`))).toBeVisible();

  // What the site sent to capture-email: the answers and the ad click.
  expect(captured).toHaveLength(1);
  expect(String(captured[0].email)).toMatch(/^e2e(-\d+)?@example\.com$/);
  expect((captured[0].answers as Record<string, unknown>).name).toBe(NAME);
  expect((captured[0].utm as Record<string, unknown>).fbclid).toBe('CLICK_E2E');
  expect(captured[0].landingVariant).toBe('tantrums');

  // PostHog sends in batches every few seconds, and the checkout tap may
  // leave the page: wait here until the offer page's event has gone out. A
  // build without NEXT_PUBLIC_POSTHOG_KEY would make the checks below
  // vacuous, so this fails instead (CI's e2e job sets a placeholder key).
  if (!REAL_BACKEND) {
    await expect
      .poll(() => toPosthog.join('\n').includes('web_funnel_offer_viewed'), {
        timeout: 15_000,
        message: 'PostHog sent no funnel events: build with NEXT_PUBLIC_POSTHOG_KEY set',
      })
      .toBe(true);
  }
  // Meta: with its script stubbed, every pixel call so far is still in
  // fbq.queue — exactly what the real pixel would have sent. Read it before
  // the checkout tap can take the page away.
  const toMeta = REAL_BACKEND
    ? ''
    : await page.evaluate(() => JSON.stringify((window as unknown as { fbq?: { queue?: unknown[] } }).fbq?.queue ?? []));

  await page.getByRole('button', { name: 'Get my plan' }).first().click();
  await expect.poll(() => checkouts.length).toBe(1);
  expect(checkouts[0]).toMatchObject({ plan: 'annual', displayedPrice: 59.99 });
  expect(checkouts[0].sessionId).toEqual(expect.any(String));
  // SPEC-21: the browser-only nonce /welcome later proves itself with.
  expect(checkouts[0].handoffNonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
  // Dodo's overlay opens on the checkout URL the server returned — or, if the
  // SDK can't load, the page falls back to Dodo's hosted page. Either is a
  // working checkout; a dead button is not.
  await expect
    .poll(async () => (await page.locator('iframe[src*="checkout.dodopayments.com"]').count()) > 0 || page.url().includes('checkout.dodopayments.com'), { timeout: 15_000 })
    .toBe(true);

  // ── What reached analytics ──────────────────────────────────────────────
  const email = String(captured[0].email);
  const secrets = [NAME, email, ...pickedLabels.filter((l) => l.length >= 8)];

  const sentToPosthog = toPosthog.join('\n');
  if (!REAL_BACKEND) expect(sentToPosthog).toContain('web_funnel_quiz_step');
  for (const secret of secrets) {
    expect(sentToPosthog.includes(secret), `PostHog received "${secret}"`).toBe(false);
  }

  // Meta (read above). The email IS in there, by design: advanced matching
  // hands it to the pixel, which hashes it before sending. The name and the
  // answers never are.
  if (!REAL_BACKEND) {
    expect(toMeta).toContain('Lead');
    for (const secret of [NAME, ...pickedLabels.filter((l) => l.length >= 8)]) {
      expect(toMeta.includes(secret), `the Meta pixel received "${secret}"`).toBe(false);
    }
  }
});

test('B1b: an Android answer goes to the waitlist, not the paywall', async ({ page }) => {
  test.skip(REAL_BACKEND, 'covered locally; the weekly run is only B1');
  await stubOutside(page);
  await page.goto('/quiz/1');
  for (const [i, step] of QUIZ_STEPS.entries()) {
    if (step.id === 'phone') {
      await expect(page).toHaveURL(new RegExp(`/quiz/${i + 1}$`));
      await page.getByRole('radio', { name: 'Android', exact: true }).click();
      await expect(page).toHaveURL(/\/waitlist\?reason=android/);
      await expect(page.getByText('iPhone-only')).toBeVisible();
      return;
    }
    if (step.type === 'name') {
      await page.getByPlaceholder('Your first name').fill('Sam');
      await page.getByRole('button', { name: 'Continue' }).click();
    } else if (step.type === 'single') {
      await page.getByRole('radio', { name: step.options![0].label, exact: true }).click();
    } else {
      await page.getByRole('button', { name: step.cta ?? 'Continue' }).click();
    }
  }
  throw new Error('no phone question in the quiz');
});

test('B1c: the quiz Back button steps back through history instead of piling up entries (P3-25)', async ({ page }) => {
  test.skip(REAL_BACKEND, 'covered locally; the weekly run is only B1');
  await stubOutside(page);
  await page.goto('/start');
  await page.getByRole('link', { name: 'Let’s begin' }).click();
  await expect(page).toHaveURL(/\/quiz\/1$/);

  // Forward through the first statement and the name step to step 3.
  const first = QUIZ_STEPS[0];
  await page.getByRole('button', { name: first.cta ?? 'Continue' }).click();
  await expect(page).toHaveURL(/\/quiz\/2$/);
  await page.getByPlaceholder('Your first name').fill('Sam');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/quiz\/3$/);
  const historyBefore = await page.evaluate(() => history.length);

  // Two in-app Back taps walk back, without adding history entries…
  await page.getByRole('button', { name: /back/i }).first().click();
  await expect(page).toHaveURL(/\/quiz\/2$/);
  await page.getByRole('button', { name: /back/i }).first().click();
  await expect(page).toHaveURL(/\/quiz\/1$/);
  expect(await page.evaluate(() => history.length)).toBe(historyBefore);

  // …so the browser's own Back now leaves the quiz instead of walking forward again.
  await page.goBack();
  await expect(page).toHaveURL(/\/start$/);
});
