// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

const post = (body: string) => POST(new NextRequest('https://kinderwell.app/api/csp-report', { method: 'POST', body }));
afterEach(() => vi.restoreAllMocks());

describe('/api/csp-report', () => {
  it('logs the legacy report format without the page query string', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await post(
      JSON.stringify({
        'csp-report': {
          'document-uri': 'https://kinderwell.app/welcome?email=a%40b.co',
          'effective-directive': 'script-src',
          'blocked-uri': 'https://evil.example/x.js',
        },
      })
    );
    expect(res.status).toBe(204);
    const line = warn.mock.calls[0].join(' ');
    expect(line).toContain('script-src');
    expect(line).toContain('https://evil.example/x.js');
    expect(line).toContain('https://kinderwell.app/welcome');
    expect(line).not.toContain('a%40b.co');
  });

  it('logs the Reporting API format', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await post(JSON.stringify([{ type: 'csp-violation', body: { effectiveDirective: 'frame-src', blockedURL: 'https://x.example', documentURL: 'https://kinderwell.app/offer' } }]));
    expect(warn.mock.calls[0].join(' ')).toContain('frame-src');
  });

  it('never writes a sign-in key to the logs, from the page or the blocked address (SPEC-21)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const key = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE';
    await post(JSON.stringify({ 'csp-report': { 'document-uri': `https://open.kinderwell.app/k/${key}`, 'effective-directive': 'script-src', 'blocked-uri': `kinderwell://k/${key}` } }));
    await post(JSON.stringify([{ type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'https://x.example/a.png', documentURL: `https://open.kinderwell.app/k/${key}?x=1` } }]));
    const lines = warn.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(lines).not.toContain(key);
    expect(lines).toContain('https://open.kinderwell.app/k/[redacted]');
    expect(lines).toContain('kinderwell://k/[redacted]');
  });

  it('never errors on junk', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await post('not json')).status).toBe(204);
    expect((await post('')).status).toBe(204);
  });
});
