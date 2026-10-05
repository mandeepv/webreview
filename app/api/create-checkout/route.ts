import { NextRequest, NextResponse } from 'next/server';
import { forwardToFunction, readJson } from '@/lib/proxy';

export const maxDuration = 30; // seconds; the proxy gives up at 20

// Proxy to the create-checkout edge function: returns { checkoutUrl, eventId }.
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  if (!body) return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  return forwardToFunction(req, 'create-checkout', body);
}
