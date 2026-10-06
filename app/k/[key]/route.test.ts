// @vitest-environment node
// The sign-in link page (SPEC-21): its URL holds a login credential, so it
// must load nothing third-party, leak no Referer, and never be cached or
// indexed. And it must still get the buyer into the app.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

const KEY = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

async function open(key: string, ua = IPHONE) {
  const req = new NextRequest(`https://open.kinderwell.app/k/${key}`, { headers: { 'user-agent': ua } });
  const res = await GET(req, { params: Promise.resolve({ key }) });
  return { res, html: await res.text() };
}

describe('/k/<key>', () => {
  it('on an iPhone: Get Kinderwell (copy, then App Store), Open Kinderwell on the main site’s host, and the email steps', async () => {
    expect(KEY).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const { res, html } = await open(KEY);
    expect(res.status).toBe(200);
    expect(html).toContain('id="get" class="button" href="https://apps.apple.com/');
    // Another host than this page's, so iOS opens the app without Safari's prompt.
    expect(html).toContain(`href="https://kinderwell.app/k/${KEY}"`);
    expect(html).not.toContain('kinderwell://');
    expect(html).toContain('Continue with Email');
    expect(html).toContain('<strong>Sign in</strong>');
    // The copied link is the universal link, built from the page's own path.
    expect(html).toContain("navigator.clipboard.writeText('https://open.kinderwell.app/k/' + key)");
  });

  it('on a computer: a QR code of the universal link for the phone camera', async () => {
    const { html } = await open(KEY, MAC);
    expect(html).toContain('<svg');
    expect(html).not.toContain('id="get"');
    expect(html).not.toContain('href="https://kinderwell.app/k/');
  });

  it('loads nothing from anywhere: no analytics, no pixel, no fonts, no external script or style', async () => {
    for (const ua of [IPHONE, MAC]) {
      const { html } = await open(KEY, ua);
      expect(html).not.toMatch(/posthog|facebook|fbq|fbevents|googleapis|gstatic|_next\//i);
      expect(html).not.toMatch(/<script[^>]+src=/i);
      expect(html).not.toMatch(/<link[^>]+(stylesheet|preload|preconnect)/i);
      expect(html).not.toMatch(/<img /i);
    }
  });

  it('sends no Referer, is never cached or indexed, and enforces a CSP that allows only its own script and style', async () => {
    const { res, html } = await open(KEY);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    expect(html).toContain('<meta name="referrer" content="no-referrer">');

    const csp = res.headers.get('content-security-policy')!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('unsafe-inline');
    const hash = (s: string) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)![1];
    expect(csp).toContain(`script-src ${hash(script)}`);
    expect(csp).toContain(`style-src ${hash(style)}`);
  });

  it('a malformed key gets a 404 with the email steps, and is never echoed into the page', async () => {
    for (const bad of ['tooShortKey123', `${KEY}x`, '<script>alert(1)</script>AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', `${KEY.slice(1)}"`]) {
      const { res, html } = await open(bad);
      expect(res.status, bad).toBe(404);
      expect(html, bad).toContain('Continue with Email');
      expect(html, bad).not.toContain(bad);
      expect(html, bad).not.toContain('href="https://kinderwell.app/k/');
    }
  });
});
