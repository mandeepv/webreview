import 'server-only'; // FUNNEL_PROXY_SECRET must never be pulled into a client bundle
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

const FUNCTION_TIMEOUT_MS = 20_000;

type FunctionName = 'capture-email' | 'create-checkout' | 'unsubscribe' | 'resume' | 'mint-handoff';

/** Calls an edge function through the proxy path; returns its status and parsed body. */
export async function callFunction(
  req: NextRequest,
  fn: FunctionName,
  body: object
): Promise<{ status: number; json: Record<string, unknown> }> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const ua = req.headers.get('user-agent') ?? '';

  let res: Response;
  try {
    res = await fetch(`${config.supabaseUrl}/functions/v1/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.supabaseAnonKey}`,
        apikey: config.supabaseAnonKey,
        'x-funnel-proxy-key': process.env.FUNNEL_PROXY_SECRET ?? '',
      },
      body: JSON.stringify({ ...body, client_ip: ip, client_ua: ua }),
      // Under the routes' maxDuration, so a slow Dodo call becomes a clean
      // 504 the page can explain rather than Vercel killing the function.
      signal: AbortSignal.timeout(FUNCTION_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    return { status: 504, json: { error: timedOut ? 'timeout' : 'upstream_unreachable' } };
  }

  const json = ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  return { status: res.status, json };
}

export async function forwardToFunction(
  req: NextRequest,
  fn: FunctionName,
  body: object
): Promise<NextResponse> {
  const { status, json } = await callFunction(req, fn, body);
  return NextResponse.json(json, { status });
}

export async function readJson(req: NextRequest): Promise<object | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}
