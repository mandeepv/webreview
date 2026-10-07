import { NextRequest, NextResponse } from 'next/server';
import { callFunction } from '@/lib/proxy';
import { RESUME_COOKIE } from '@/lib/resume-cookie';

export const maxDuration = 30;

// kinderwell.app/r/<token> — the link in win-back emails and the "open in
// Safari" link on /offer (review P1-5, P1-6). The token is resolved HERE, on
// the server, and the session handed to the browser in a 5-minute cookie that
// lib/session.ts consumes. The token never sits in a page URL, so the Meta
// pixel and PostHog (which send the full URL) never see it.
const DESTINATIONS = { plan: '/plan', offer: '/offer' } as const;
/** Room for the name and attributes inside the 4096-byte cookie limit. */
const MAX_COOKIE_VALUE = 3500;

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { status, json } = await callFunction(req, 'resume', { action: 'resolve', token });

  if (status !== 200 || typeof json.sessionId !== 'string') {
    // Expired or tampered link: the quiz is two minutes — start fresh.
    return NextResponse.redirect(new URL('/start', req.url), 307);
  }

  const to = req.nextUrl.searchParams.get('to');
  const path = json.subscribed ? '/welcome' : (DESTINATIONS[to as keyof typeof DESTINATIONS] ?? '/plan');
  const res = NextResponse.redirect(new URL(path, req.url), 307);
  // Browsers drop a cookie over 4 KB whole, and long answers can get there
  // (review P3). Then hand over the session without its answers: the plan
  // and offer pages fall back to generic copy, but the purchase still lands
  // on the right session and account (the server keeps the answers).
  let value = Buffer.from(JSON.stringify(json)).toString('base64url');
  if (value.length > MAX_COOKIE_VALUE) {
    value = Buffer.from(JSON.stringify({ ...json, answers: {} })).toString('base64url');
  }
  res.cookies.set(RESUME_COOKIE, value, {
    maxAge: 300,
    path: '/',
    sameSite: 'lax',
    secure: req.nextUrl.protocol === 'https:',
  });
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  res.headers.set('Referrer-Policy', 'no-referrer');
  return res;
}
