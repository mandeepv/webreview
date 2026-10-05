// @vitest-environment node
// lib/proxy.ts — the only way from the site into the edge functions (P1).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const SECRET = 'proxy-secret-for-tests';

async function loadProxy() {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('FUNNEL_PROXY_SECRET', SECRET);
  return import('./proxy');
}

function request(headers: Record<string, string> = {}) {
  return new NextRequest('https://kinderwell.app/api/capture-email', {
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'Mozilla/5.0 (iPhone) test', ...headers },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('callFunction', () => {
  it('calls the named function with the proxy secret and the caller’s real IP and user agent', async () => {
    const { callFunction } = await loadProxy();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ userId: 'u1' }), { status: 200 }));

    const out = await callFunction(request(), 'capture-email', { email: 'a@b.co' });

    expect(out).toEqual({ status: 200, json: { userId: 'u1' } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://project.supabase.test/functions/v1/capture-email');
    expect(init.headers['x-funnel-proxy-key']).toBe(SECRET);
    expect(init.headers.apikey).toBe('anon-key');
    expect(JSON.parse(init.body)).toEqual({
      email: 'a@b.co',
      client_ip: '203.0.113.7', // first hop only
      client_ua: 'Mozilla/5.0 (iPhone) test',
    });
  });

  it('a body cannot override the IP the proxy attaches', async () => {
    const { callFunction } = await loadProxy();
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    await callFunction(request(), 'capture-email', { client_ip: '1.2.3.4' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).client_ip).toBe('203.0.113.7');
  });

  it('passes the function’s status and body through, including errors', async () => {
    const { callFunction } = await loadProxy();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'already_subscribed' }), { status: 409 }));
    expect(await callFunction(request(), 'create-checkout', {})).toEqual({
      status: 409,
      json: { error: 'already_subscribed' },
    });
  });

  it('a non-JSON reply becomes an empty body, not a crash', async () => {
    const { callFunction } = await loadProxy();
    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }));
    expect(await callFunction(request(), 'resume', {})).toEqual({ status: 502, json: {} });
  });

  it('a timeout becomes a clean 504 the page can explain', async () => {
    const { callFunction } = await loadProxy();
    fetchMock.mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    expect(await callFunction(request(), 'create-checkout', {})).toEqual({ status: 504, json: { error: 'timeout' } });
  });

  it('an unreachable backend becomes a 504 too', async () => {
    const { callFunction } = await loadProxy();
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    expect(await callFunction(request(), 'create-checkout', {})).toEqual({
      status: 504,
      json: { error: 'upstream_unreachable' },
    });
  });

  it('never puts the proxy secret in what it returns to the browser', async () => {
    const { forwardToFunction } = await loadProxy();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const res = await forwardToFunction(request(), 'unsubscribe', {});
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    expect([...res.headers.values()].join(' ')).not.toContain(SECRET);
  });
});

describe('readJson', () => {
  it('accepts only a JSON object', async () => {
    const { readJson } = await loadProxy();
    const body = (b: string) => new NextRequest('https://kinderwell.app/api/x', { method: 'POST', body: b });
    expect(await readJson(body('{"a":1}'))).toEqual({ a: 1 });
    expect(await readJson(body('[1,2]'))).toBeNull();
    expect(await readJson(body('null'))).toBeNull();
    expect(await readJson(body('{nope'))).toBeNull();
  });
});
