import { NextRequest, NextResponse } from 'next/server';
import { forwardToFunction, readJson } from '@/lib/proxy';

export const maxDuration = 30; // seconds; the proxy gives up at 20

// Proxy to the resume edge function: mint a resume link for this device's
// session, or resolve one from a win-back email (review P1-6).
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  return forwardToFunction(req, 'resume', body);
}
