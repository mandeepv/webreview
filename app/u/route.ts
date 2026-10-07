import { NextRequest, NextResponse } from 'next/server';
import { UNSUBSCRIBE_COOKIE } from '@/lib/unsubscribe-cookie';

// kinderwell.app/u?u=<user>&t=<token> — the unsubscribe link in every
// marketing email (supabase/functions/_shared/email.ts unsubscribeParts).
//
// It used to be /unsubscribe?u=…&t=…, a page that loads the Meta pixel, and
// the pixel sends the full page URL: every opt-out handed Meta the user id
// and its opt-out token (review 2026-10-07, P3). The pair now goes from the
// link into a 5-minute cookie scoped to /unsubscribe, server-side, and the
// browser lands on a clean /unsubscribe, which reads the cookie, clears it,
// and records the opt-out — the same as /r/<token> does for resume links.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

export function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get('u') ?? '';
  const t = req.nextUrl.searchParams.get('t') ?? '';
  const res = NextResponse.redirect(new URL('/unsubscribe', req.url), 307);
  // A malformed pair lands on the page without a cookie: "that link didn't work".
  if (UUID_RE.test(u) && TOKEN_RE.test(t)) {
    res.cookies.set(UNSUBSCRIBE_COOKIE, `${u}.${t}`, {
      maxAge: 300,
      path: '/unsubscribe',
      sameSite: 'lax',
      secure: req.nextUrl.protocol === 'https:',
    });
  }
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  res.headers.set('Referrer-Policy', 'no-referrer');
  return res;
}
