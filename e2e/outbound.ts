// What the browser sends to analytics, decoded, so a test can check what
// would leave the page. posthog-js gzips its event batches (or base64s them
// in a `data=` form field), so reading the raw request body as text sees
// nothing — a check written that way passes even when the data is there.
import { gunzipSync } from 'node:zlib';
import type { Page, Request } from '@playwright/test';

/** PostHog (events, config) and Meta (pixel script, events). */
export const ANALYTICS_HOSTS = /posthog\.com|facebook\.(com|net)/;

/** The request's URL and body as readable text, whatever encoding the SDK chose. */
export function outboundText(r: Request): string {
  const buf = r.postDataBuffer();
  let body = '';
  if (buf && buf.length > 0) {
    if (buf[0] === 0x1f && buf[1] === 0x8b) {
      body = gunzipSync(buf).toString('utf8');
    } else {
      const text = buf.toString('utf8');
      const data = text.startsWith('data=') ? new URLSearchParams(text).get('data') : null;
      body = data ? Buffer.from(data, 'base64').toString('utf8') : text;
    }
  }
  let url = r.url();
  try {
    url = decodeURIComponent(url);
  } catch {
    // keep it as it is
  }
  return `${url}\n${body}`;
}

/**
 * Makes PostHog really capture during a test, against a local stub:
 *   * posthog-js drops every event when `navigator.webdriver` is true (its
 *     bot filter), and Playwright always sets it — so until 2026-10-07 no
 *     e2e run ever sent a PostHog event, and "nothing sensitive reaches
 *     PostHog" could not be checked (review test gap #5);
 *   * its remote config, flags and event endpoints get valid answers.
 * Needs a build with NEXT_PUBLIC_POSTHOG_KEY set (CI's e2e job sets a
 * placeholder). Call after any broader stub: the last route added wins.
 */
export async function livePosthog(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });
  });
  await page.route(/posthog\.com/, (r) => {
    const url = r.request().url();
    // The project's remote config, as a real PostHog project serves it by
    // default: autocapture ALLOWED server-side. Only the site's own
    // `autocapture: false` keeps it off, which is what the tests check.
    const token = /\/array\/([^/]+)\/config/.exec(url)?.[1] ?? '';
    const remote = { token, supportedCompression: [], autocapture_opt_out: false, hasFeatureFlags: false, siteApps: [] };
    if (/\/config\.js/.test(url)) {
      return r.fulfill({
        contentType: 'application/javascript',
        body: `window._POSTHOG_REMOTE_CONFIG = window._POSTHOG_REMOTE_CONFIG || {}; window._POSTHOG_REMOTE_CONFIG[${JSON.stringify(token)}] = { config: ${JSON.stringify(remote)}, siteApps: [] };`,
      });
    }
    if (/\/config(\?|$)/.test(url)) return r.fulfill({ json: remote });
    if (/\/flags\//.test(url)) {
      return r.fulfill({ json: { flags: {}, featureFlags: {}, featureFlagPayloads: {}, autocapture_opt_out: false } });
    }
    return r.fulfill({ json: { status: 1 } });
  });
}
