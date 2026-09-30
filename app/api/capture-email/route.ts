import { NextRequest, NextResponse } from 'next/server';
import { forwardToFunction, readJson } from '@/lib/proxy';

// Proxy to the capture-email edge function (see lib/proxy.ts for why the
// proxy exists).
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  return forwardToFunction(req, 'capture-email', body);
}
