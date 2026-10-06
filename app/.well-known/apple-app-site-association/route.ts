import { AASA } from '@/lib/aasa';

// Must be JSON at exactly this path with no redirect: next.config.mjs keeps
// /.well-known/ out of the open.kinderwell.app → kinderwell.app redirect.
// What it says, and why: lib/aasa.ts.

export const dynamic = 'force-static';

export function GET() {
  return Response.json(AASA, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
