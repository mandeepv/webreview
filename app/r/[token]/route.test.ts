// @vitest-environment node
// kinderwell.app/r/<token> — win-back and "open in Safari" links (P3).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { RESUME_COOKIE } from '@/lib/resume-cookie';

const SESSION = {
  sessionId: '0b6f5a3e-1d2c-4e5f-8a9b-0c1d2e3f4a5b',
  userId: 'user-1',
  email: 'buyer@example.com',
  answers: { name: 'Sam' },
  utm: {},
  landingVariant: 'default',
  subscribed: false,
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function open(token: string, query = '', origin = 'https://kinderwell.app') {
  const { GET } = await import('./route');
  return GET(new NextRequest(`${origin}/r/${token}${query}`), { params: Promise.resolve({ token }) });
}

const resolved = (body: object, status = 200) => fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('/r/[token]', () => {
  it('an expired or tampered link starts the quiz fresh', async () => {
    resolved({ error: 'invalid_token' }, 401);
    const res = await open('bad-token');
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/start');
    expect(res.cookies.get(RESUME_COOKIE)).toBeUndefined();
  });

  it('a lead lands on their plan, with the session handed over in a short-lived cookie', async () => {
    resolved(SESSION);
    const res = await open('tok.123.sig');
    expect(new URL(res.headers.get('location')!).pathname).toBe('/plan');
    const cookie = res.cookies.get(RESUME_COOKIE)!;
    expect(cookie.maxAge).toBe(300);
    expect(cookie.secure).toBe(true);
    expect(JSON.parse(Buffer.from(cookie.value, 'base64url').toString())).toEqual(SESSION);
  });

  it('?to=offer goes to the offer; an unknown destination falls back to the plan', async () => {
    resolved(SESSION);
    expect(new URL((await open('t', '?to=offer')).headers.get('location')!).pathname).toBe('/offer');
    resolved(SESSION);
    expect(new URL((await open('t', '?to=https://evil.example')).headers.get('location')!).pathname).toBe('/plan');
  });

  it('someone who already pays goes to /welcome, wherever the link pointed', async () => {
    resolved({ ...SESSION, subscribed: true });
    expect(new URL((await open('t', '?to=offer')).headers.get('location')!).pathname).toBe('/welcome');
  });

  it('the token never appears in the URL the browser lands on (the pixel would send it to Meta)', async () => {
    resolved(SESSION);
    const res = await open('secret-token-value', '?to=offer');
    expect(res.headers.get('location')).not.toContain('secret-token-value');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
  });

  it('the cookie is only marked secure on https (local dev keeps working)', async () => {
    resolved(SESSION);
    const res = await open('t', '', 'http://localhost:3000');
    expect(res.cookies.get(RESUME_COOKIE)!.secure).toBe(false);
  });

  it('answers too long for a cookie are left out rather than losing the whole hand-over (P3)', async () => {
    const answers = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`q${i}`, 'x'.repeat(80)]));
    resolved({ ...SESSION, answers });
    const res = await open('good-token');
    const value = res.cookies.get(RESUME_COOKIE)!.value;
    expect(value.length).toBeLessThanOrEqual(3500);
    const handed = JSON.parse(Buffer.from(value, 'base64url').toString());
    expect(handed).toMatchObject({ sessionId: SESSION.sessionId, userId: SESSION.userId, email: SESSION.email, answers: {} });
  });
});
