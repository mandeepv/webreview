import { NextRequest } from 'next/server';
import { forwardToFunction } from '@/lib/proxy';

export const maxDuration = 30; // seconds; the proxy gives up at 20

// Two callers, one endpoint:
//   * the /unsubscribe page (link in the email body) — u/t in the query
//   * Gmail/Yahoo one-click (RFC 8058) — a POST to the List-Unsubscribe URL,
//     also u/t in the query, with a form body we don't need to read
export async function POST(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  return forwardToFunction(req, 'unsubscribe', {
    u: params.get('u') ?? '',
    t: params.get('t') ?? '',
  });
}
