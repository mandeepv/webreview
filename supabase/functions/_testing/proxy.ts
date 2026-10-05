// Requests as the Next.js proxy (/api/*) sends them to the funnel functions,
// plus a guard against fixed rate-limit windows rolling over mid-test.

import { TEST } from './env.ts';

export type ProxyOpts = {
  /** The x-funnel-proxy-key header; null omits it. Defaults to the right secret. */
  key?: string | null;
  method?: string;
  /** Send this exact body instead of JSON.stringify(body). */
  raw?: string;
};

export function proxyRequest(fn: string, body: unknown, o: ProxyOpts = {}): Request {
  const key = o.key === undefined ? TEST.proxySecret : o.key;
  const method = o.method ?? 'POST';
  return new Request(`http://localhost/functions/v1/${fn}`, {
    method,
    headers: { 'content-type': 'application/json', ...(key === null ? {} : { 'x-funnel-proxy-key': key }) },
    body: method === 'GET' ? undefined : (o.raw ?? JSON.stringify(body)),
  });
}

export async function call(
  handler: (req: Request) => Promise<Response>,
  fn: string,
  body: unknown,
  o: ProxyOpts = {}
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await handler(proxyRequest(fn, body, o));
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { text };
  }
  return { status: res.status, json };
}

/** A random documentation-range IP, so each test has its own rate-limit buckets. */
export const randomIp = () => `198.51.100.${Math.floor(Math.random() * 254) + 1}:${crypto.randomUUID().slice(0, 8)}`;

/**
 * Rate limits use fixed windows aligned to the clock. A test that makes N
 * calls expecting the (N+1)th to be refused would flake if the window rolled
 * over between them — so wait out the last few seconds of a window first.
 */
export async function awayFromWindowEdge(windowSeconds: number, marginSeconds = 8) {
  const intoWindow = (Date.now() / 1000) % windowSeconds;
  if (windowSeconds - intoWindow < marginSeconds) {
    await new Promise((r) => setTimeout(r, (windowSeconds - intoWindow + 0.5) * 1000));
  }
}
