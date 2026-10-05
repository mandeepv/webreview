// Standard Webhooks signature verification (Dodo signs with it). Pure apart
// from WebCrypto, so signature_test.ts covers it.

export type SignatureInput = {
  id: string | null;
  timestamp: string | null;
  signatureHeader: string | null;
  secret: string | undefined;
  rawBody: string;
  /** Seconds since epoch; injectable for tests. */
  nowSeconds?: number;
};

export async function verifyStandardWebhook(input: SignatureInput): Promise<boolean> {
  const { id, timestamp, signatureHeader, secret, rawBody } = input;
  if (!id || !timestamp || !signatureHeader || !secret) return false;

  // Reject stale timestamps (>5 min) — standard replay protection.
  const now = input.nowSeconds ?? Date.now() / 1000;
  const age = Math.abs(now - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  // Secret encoding: Standard Webhooks specifies a base64 secret after the
  // "whsec_" prefix, but the dashboard can also hand out a raw string. Trying
  // both costs one extra HMAC and removes a whole class of silent 401s that
  // would break entitlements without any obvious cause.
  const rawSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const candidates: Uint8Array[] = [];
  try {
    candidates.push(Uint8Array.from(atob(rawSecret), (c) => c.charCodeAt(0)));
  } catch {
    // Not valid base64 — the raw-bytes candidate below is the only option.
  }
  candidates.push(new TextEncoder().encode(rawSecret));

  const message = new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`);
  const expectedSignatures: string[] = [];
  for (const secretBytes of candidates) {
    const key = await crypto.subtle.importKey(
      'raw',
      secretBytes as BufferSource,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signed = await crypto.subtle.sign('HMAC', key, message as BufferSource);
    expectedSignatures.push(btoa(String.fromCharCode(...new Uint8Array(signed))));
  }

  // Header format: "v1,<base64> v1,<base64> ..." — any match passes.
  return signatureHeader
    .split(' ')
    .map((part) => part.split(',')[1] ?? '')
    .some((candidate) => expectedSignatures.some((expected) => timingSafeEqual(candidate, expected)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
