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
  res.cookies.set(RESUME_COOKIE, Buffer.from(JSON.stringify(json)).toString('base64url'), {
    maxAge: 300,
    path: '/',
    sameSite: 'lax',
    secure: req.nextUrl.protocol === 'https:',
  });
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  res.headers.set('Referrer-Policy', 'no-referrer');
  return res;
}
