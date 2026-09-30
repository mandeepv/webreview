import { NextRequest, NextResponse } from 'next/server';
import { config } from './config';

// Server-only: the /api/* routes are the ONLY way into the funnel's edge
// functions. They attach the caller's real IP + user agent (Meta CAPI match
// keys the browser can't self-report reliably) and the proxy secret the
// functions check, so Vercel's rate limiting can't be skipped by calling
// Supabase directly with the public anon key.
//
// FUNNEL_PROXY_SECRET is a plain server env var in Vercel — never
// NEXT_PUBLIC_, or it ships to every browser and protects nothing.

export async function forwardToFunction(
  req: NextRequest,
  fn: 'capture-email' | 'create-checkout' | 'unsubscribe',
  body: object
): Promise<NextResponse> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const ua = req.headers.get('user-agent') ?? '';

  const res = await fetch(`${config.supabaseUrl}/functions/v1/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.supabaseAnonKey}`,
      apikey: config.supabaseAnonKey,
      'x-funnel-proxy-key': process.env.FUNNEL_PROXY_SECRET ?? '',
    },
    body: JSON.stringify({ ...body, client_ip: ip, client_ua: ua }),
  });

  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}

export async function readJson(req: NextRequest): Promise<object | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}
