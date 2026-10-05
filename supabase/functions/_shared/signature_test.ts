import { assertEquals } from 'jsr:@std/assert@1';
import { verifyStandardWebhook } from './signature.ts';

const NOW = 1_790_000_000;
const BODY = '{"type":"subscription.active","data":{}}';
const SECRET_BYTES = new TextEncoder().encode('super-secret-key-bytes');
const WHSEC = `whsec_${btoa(String.fromCharCode(...SECRET_BYTES))}`;

async function sign(secretBytes: Uint8Array, id: string, ts: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', secretBytes as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function input(overrides: Partial<Parameters<typeof verifyStandardWebhook>[0]> = {}) {
  return {
    id: 'msg_1',
    timestamp: String(NOW),
    signatureHeader: `v1,${await sign(SECRET_BYTES, 'msg_1', NOW, BODY)}`,
    secret: WHSEC,
    rawBody: BODY,
    nowSeconds: NOW,
    ...overrides,
  };
}

Deno.test('valid whsec_ base64 secret passes', async () => {
  assertEquals(await verifyStandardWebhook(await input()), true);
});

Deno.test('raw (non-base64) secret passes', async () => {
  const raw = 'plain secret!';
  const sig = await sign(new TextEncoder().encode(raw), 'msg_1', NOW, BODY);
  assertEquals(await verifyStandardWebhook(await input({ secret: raw, signatureHeader: `v1,${sig}` })), true);
});

Deno.test('any of several space-separated signatures may match', async () => {
  const good = await sign(SECRET_BYTES, 'msg_1', NOW, BODY);
  assertEquals(await verifyStandardWebhook(await input({ signatureHeader: `v1,AAAA v1,${good}` })), true);
});

Deno.test('tampered body fails', async () => {
  assertEquals(await verifyStandardWebhook(await input({ rawBody: BODY.replace('active', 'renewed') })), false);
});

Deno.test('wrong secret fails', async () => {
  assertEquals(await verifyStandardWebhook(await input({ secret: 'whsec_' + btoa('other') })), false);
});

Deno.test('timestamp older or newer than 5 minutes fails', async () => {
  assertEquals(await verifyStandardWebhook(await input({ nowSeconds: NOW + 301 })), false);
  assertEquals(await verifyStandardWebhook(await input({ nowSeconds: NOW - 301 })), false);
});

Deno.test('missing header or secret fails', async () => {
  assertEquals(await verifyStandardWebhook(await input({ signatureHeader: null })), false);
  assertEquals(await verifyStandardWebhook(await input({ secret: undefined })), false);
  assertEquals(await verifyStandardWebhook(await input({ id: null })), false);
});
