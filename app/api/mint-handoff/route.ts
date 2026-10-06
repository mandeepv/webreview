import { NextRequest, NextResponse } from 'next/server';
import { forwardToFunction, readJson } from '@/lib/proxy';

export const maxDuration = 30; // seconds; the proxy gives up at 20

// Proxy to the mint-handoff edge function: returns { link }, a one-time
// sign-in link for the app (SPEC-21). That is a login credential: never log
// the body, and nothing may cache the reply.
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  const res = await forwardToFunction(req, 'mint-handoff', body);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
