// @vitest-environment node
// The /api/* routes: thin proxies into the edge functions (P2).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('FUNNEL_PROXY_SECRET', 'secret');
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const post = (path: string, body: string) =>
  new NextRequest(`https://kinderwell.app${path}`, { method: 'POST', body, headers: { 'content-type': 'application/json' } });

const ROUTES = [
  ['capture-email', () => import('./capture-email/route')],
  ['create-checkout', () => import('./create-checkout/route')],
  ['resume', () => import('./resume/route')],
  ['mint-handoff', () => import('./mint-handoff/route')],
] as const;

describe.each(ROUTES)('/api/%s', (fn, load) => {
  it('refuses a body that is not a JSON object without calling the backend', async () => {
    const { POST } = await load();
    for (const bad of ['{nope', '[1,2]', 'null']) {
      const res = await POST(post(`/api/${fn}`, bad));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad_json' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards to its own function and passes the reply through', async () => {
    const { POST } = await load();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 }));
    const res = await POST(post(`/api/${fn}`, '{"sessionId":"s"}'));
    expect(fetchMock.mock.calls[0][0]).toBe(`https://project.supabase.test/functions/v1/${fn}`);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).sessionId).toBe('s');
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
  });

  it('gives the function time to answer before the platform kills it', async () => {
    const mod = await load();
    expect(mod.maxDuration).toBeGreaterThan(20); // the proxy itself gives up at 20s
  });
});

describe('/api/mint-handoff', () => {
  it('passes the sign-in link through and tells every cache to keep it', async () => {
    const { POST } = await import('./mint-handoff/route');
    const link = `https://open.kinderwell.app/k/${'k'.repeat(43)}`;
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ link }), { status: 200 }));
    const res = await POST(post('/api/mint-handoff', '{"sessionId":"s","nonce":"n"}'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ link });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('/api/unsubscribe', () => {
  it('takes u and t from the query, for both the page link and Gmail/Yahoo one-click POSTs', async () => {
    const { POST } = await import('./unsubscribe/route');
    const req = new NextRequest('https://kinderwell.app/api/unsubscribe?u=user-1&t=tok', {
      method: 'POST',
      body: 'List-Unsubscribe=One-Click',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.u).toBe('user-1');
    expect(sent.t).toBe('tok');
  });
});
