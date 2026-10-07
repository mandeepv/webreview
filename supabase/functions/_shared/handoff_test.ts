// deno test --allow-env
import { assert, assertEquals, assertMatch, assertNotEquals } from 'jsr:@std/assert@1';
import { decideMint, handoffLink, KEY_RE, MINT_WINDOW_MS, newHandoffKey, sha256Hex } from './handoff.ts';

const NOW = new Date('2026-10-06T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const HASH = 'a'.repeat(64);
// The funnel created the account moments before the session row, half an hour ago.
const PAID = {
  user_id: 'u1',
  handoff_nonce_hash: HASH,
  purchased_at: ago(60_000),
  created_at: ago(30 * 60_000),
  account_created_at: ago(30 * 60_000 + 500),
};
const ACTIVE = { status: 'active', current_period_end: '2027-10-06T12:00:00.000Z' };

Deno.test('a key is 43 base64url characters from 32 random bytes, and never repeats', () => {
  const keys = new Set(Array.from({ length: 200 }, newHandoffKey));
  assertEquals(keys.size, 200);
  for (const key of keys) assertMatch(key, KEY_RE);
});

Deno.test('the stored hash is the lowercase hex sha256 of the key string (the app redeems by this)', async () => {
  // sha256("abc"), the FIPS 180-2 test vector.
  assertEquals(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const key = newHandoffKey();
  assertMatch(await sha256Hex(key), /^[0-9a-f]{64}$/);
});

Deno.test('the link is the universal link on open.kinderwell.app', () => {
  assertEquals(handoffLink('K'.repeat(43)), `https://open.kinderwell.app/k/${'K'.repeat(43)}`);
});

Deno.test('KEY_RE refuses anything that is not exactly a key', () => {
  for (const bad of ['', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}=`, `${'a'.repeat(42)}/`, `${'a'.repeat(42)}+`]) {
    assert(!KEY_RE.test(bad), bad);
  }
});

Deno.test('decideMint: a paid, entitled session with the right nonce gets a key', () => {
  assertEquals(decideMint(PAID, HASH, ACTIVE, NOW), 'ok');
  // past_due and cancelled keep access until the period ends, as in the app.
  assertEquals(decideMint(PAID, HASH, { ...ACTIVE, status: 'cancelled' }, NOW), 'ok');
});

Deno.test('decideMint: no session, no nonce on file, or the wrong nonce all look the same', () => {
  assertEquals(decideMint(null, HASH, ACTIVE, NOW), 'not_found');
  assertEquals(decideMint({ ...PAID, user_id: null }, HASH, ACTIVE, NOW), 'not_found');
  assertEquals(decideMint({ ...PAID, handoff_nonce_hash: null }, HASH, ACTIVE, NOW), 'not_found');
  assertEquals(decideMint(PAID, 'b'.repeat(64), ACTIVE, NOW), 'not_found');
  assertEquals(decideMint(PAID, '', ACTIVE, NOW), 'not_found');
});

Deno.test('decideMint: before the webhook has recorded the purchase, the page should retry', () => {
  assertEquals(decideMint({ ...PAID, purchased_at: null }, HASH, null, NOW), 'not_ready');
  // B-3: the paid checkout's nonce hash reaches the session WITH the
  // purchase, so before it there is none yet — still "retry", not "no".
  assertEquals(decideMint({ ...PAID, purchased_at: null, handoff_nonce_hash: null }, HASH, null, NOW), 'not_ready');
});

Deno.test('decideMint: a purchase on an account that predates the session never mints (B-1)', () => {
  // Someone typed an existing customer's email and paid: they must not get a
  // sign-in key for that customer's account.
  const existing = { ...PAID, account_created_at: ago(30 * 24 * 3600 * 1000) };
  assertEquals(decideMint(existing, HASH, ACTIVE, NOW), 'not_found');
  // Unknown account age: no proof, no key.
  assertEquals(decideMint({ ...PAID, account_created_at: null }, HASH, ACTIVE, NOW), 'not_found');
  assertEquals(decideMint({ ...PAID, created_at: null }, HASH, ACTIVE, NOW), 'not_found');
  // Before the purchase lands the answer is still "retry", whoever's account it is.
  assertEquals(decideMint({ ...existing, purchased_at: null }, HASH, null, NOW), 'not_ready');
});

Deno.test('decideMint: more than 24 hours after the purchase, no more welcome-page keys', () => {
  assertEquals(decideMint({ ...PAID, purchased_at: ago(MINT_WINDOW_MS - 1000) }, HASH, ACTIVE, NOW), 'ok');
  assertEquals(decideMint({ ...PAID, purchased_at: ago(MINT_WINDOW_MS + 1000) }, HASH, ACTIVE, NOW), 'expired');
});

Deno.test('decideMint: a refunded, expired or missing entitlement gets no key', () => {
  assertEquals(decideMint(PAID, HASH, { ...ACTIVE, status: 'revoked' }, NOW), 'not_entitled');
  assertEquals(decideMint(PAID, HASH, { ...ACTIVE, status: 'expired' }, NOW), 'not_entitled');
  // Past the period AND the late-renewal grace (an active row keeps 6 days, as in the app).
  assertEquals(decideMint(PAID, HASH, { ...ACTIVE, current_period_end: ago(7 * 24 * 3600 * 1000) }, NOW), 'not_entitled');
  assertEquals(decideMint(PAID, HASH, { status: 'cancelled', current_period_end: ago(1000) }, NOW), 'not_entitled');
  assertEquals(decideMint(PAID, HASH, null, NOW), 'not_entitled');
});

Deno.test('two keys minted back to back differ, and so do their hashes', async () => {
  const [a, b] = [newHandoffKey(), newHandoffKey()];
  assertNotEquals(a, b);
  assertNotEquals(await sha256Hex(a), await sha256Hex(b));
});
