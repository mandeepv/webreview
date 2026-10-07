// deno test --allow-env (tokens read UNSUBSCRIBE_SECRET)
import { assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import { resumeToken, signingConfigured, unsubscribeToken, verifyResumeToken, verifyUnsubscribeToken } from './email.ts';

Deno.env.set('UNSUBSCRIBE_SECRET', 'test-secret');
const SESSION = '0b6f5a3e-1d2c-4e5f-8a9b-0c1d2e3f4a5b';

Deno.test('resume token round-trips to its session id', async () => {
  assertEquals(await verifyResumeToken(await resumeToken(SESSION)), SESSION);
});

Deno.test('B-3: a resume token is opaque — the session id is not in it', async () => {
  const token = await resumeToken(SESSION);
  assertEquals(token.startsWith('r2.'), true);
  assertEquals(token.includes(SESSION), false);
  assertEquals(token.includes(SESSION.replace(/-/g, '')), false);
  assertEquals(/^r2\.[A-Za-z0-9_-]+$/.test(token), true); // URL-safe as it stands
  // Two tokens for one session differ (random IV), so a link says nothing about another.
  assertNotEquals(await resumeToken(SESSION), token);
});

Deno.test('a tampered, truncated, foreign or old-format resume token is rejected', async () => {
  const token = await resumeToken(SESSION);
  const flip = (i: number) => token.slice(0, i) + (token[i] === 'A' ? 'B' : 'A') + token.slice(i + 1);
  assertEquals(await verifyResumeToken(flip(10)), null); // in the IV
  assertEquals(await verifyResumeToken(flip(60)), null); // in the ciphertext
  assertEquals(await verifyResumeToken(flip(token.length - 2)), null); // in the tag
  assertEquals(await verifyResumeToken(token.slice(0, -4)), null);
  assertEquals(await verifyResumeToken('r2.'), null);
  assertEquals(await verifyResumeToken('r2.!!!'), null);
  assertEquals(await verifyResumeToken('garbage'), null);
  // The old `<sessionId>.<exp>.<sig>` format is no longer accepted.
  assertEquals(await verifyResumeToken(`${SESSION}.${Math.floor(Date.now() / 1000) + 3600}.c2ln`), null);

  // Sealed under another secret: refused.
  Deno.env.set('UNSUBSCRIBE_SECRET', 'another-secret');
  try {
    assertEquals(await verifyResumeToken(token), null);
  } finally {
    Deno.env.set('UNSUBSCRIBE_SECRET', 'test-secret');
  }
});

Deno.test('expired resume token is rejected', async () => {
  const realNow = Date.now;
  const token = await resumeToken(SESSION);
  try {
    Date.now = () => realNow() + 31 * 24 * 3600 * 1000;
    assertEquals(await verifyResumeToken(token), null);
  } finally {
    Date.now = realNow;
  }
});

Deno.test('unsubscribe token is bound to the user and unchanged in format', async () => {
  const t = await unsubscribeToken('user-a');
  assertEquals(await verifyUnsubscribeToken('user-a', t), true);
  assertEquals(await verifyUnsubscribeToken('user-b', t), false);
  assertEquals(/^[A-Za-z0-9_-]+$/.test(t), true); // base64url, no padding — old links keep working
  assertNotEquals(t, await resumeToken('user-a'));
});

Deno.test('P3-1: signing needs UNSUBSCRIBE_SECRET itself — SWEEP_SECRET is no longer a fallback', async () => {
  const saved = Deno.env.get('UNSUBSCRIBE_SECRET');
  Deno.env.delete('UNSUBSCRIBE_SECRET');
  Deno.env.set('SWEEP_SECRET', 'sweep-secret');
  try {
    assertEquals(signingConfigured(), false);
    let threw = false;
    await unsubscribeToken('user').catch(() => (threw = true));
    assertEquals(threw, true);
  } finally {
    Deno.env.set('UNSUBSCRIBE_SECRET', saved!);
    Deno.env.delete('SWEEP_SECRET');
  }
  assertEquals(signingConfigured(), true);
});
