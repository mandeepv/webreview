// @vitest-environment node
// kinderwell.app/u — the unsubscribe link: the pair goes into a cookie, the
// browser lands on a clean /unsubscribe the pixel can't leak (P3).
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { UNSUBSCRIBE_COOKIE } from '@/lib/unsubscribe-cookie';

const USER = '0b6f5a3e-1d2c-4e5f-8a9b-0c1d2e3f4a5b';
const TOKEN = 'abcDEF123_-abcDEF123_-abcDEF123_-abcDEF1234';

describe('/u', () => {
  it('moves u/t into a short-lived cookie scoped to /unsubscribe and redirects to a clean URL', () => {
    const res = GET(new NextRequest(`https://kinderwell.app/u?u=${USER}&t=${TOKEN}`));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://kinderwell.app/unsubscribe');
    const cookie = res.cookies.get(UNSUBSCRIBE_COOKIE);
    expect(cookie?.value).toBe(`${USER}.${TOKEN}`);
    expect(cookie?.path).toBe('/unsubscribe');
    expect(cookie?.maxAge).toBe(300);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('a malformed link sets no cookie, so the page says the link didn’t work', () => {
    for (const qs of ['', `u=not-a-user&t=${TOKEN}`, `u=${USER}&t=short`, `u=${USER}&t=${TOKEN}%3Cscript%3E`]) {
      const res = GET(new NextRequest(`https://kinderwell.app/u?${qs}`));
      expect(res.headers.get('location')).toBe('https://kinderwell.app/unsubscribe');
      expect(res.cookies.get(UNSUBSCRIBE_COOKIE), qs).toBeUndefined();
    }
  });
});
