// Signs a Dodo event the way Dodo does (Standard Webhooks), so the integration
// tests exercise the real signature check instead of bypassing it.

import { TEST } from './env.ts';

async function sign(secretBytes: Uint8Array, id: string, ts: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export type SignOpts = {
  /** webhook-id; defaults to a fresh one (a new delivery). Reuse it to replay. */
  id?: string;
  /** Seconds since epoch; defaults to now. */
  timestamp?: number;
  secretBytes?: Uint8Array;
  /** Drop a header to test its absence. */
  omit?: Array<'webhook-id' | 'webhook-timestamp' | 'webhook-signature'>;
};

export async function signedRequest(event: unknown, o: SignOpts = {}): Promise<Request> {
  const id = o.id ?? `msg_${crypto.randomUUID()}`;
  const ts = o.timestamp ?? Math.floor(Date.now() / 1000);
  const body = JSON.stringify(event);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'webhook-id': id,
    'webhook-timestamp': String(ts),
    'webhook-signature': `v1,${await sign(o.secretBytes ?? TEST.webhookSecretBytes, id, ts, body)}`,
  };
  for (const h of o.omit ?? []) delete headers[h];
  return new Request('http://localhost/functions/v1/dodo-webhook', { method: 'POST', headers, body });
}
