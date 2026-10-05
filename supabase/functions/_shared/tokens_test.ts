// deno test --allow-env (tokens read UNSUBSCRIBE_SECRET)
import { assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import { resumeToken, signingConfigured, unsubscribeToken, verifyResumeToken, verifyUnsubscribeToken } from './email.ts';

Deno.env.set('UNSUBSCRIBE_SECRET', 'test-secret');
const SESSION = '0b6f5a3e-1d2c-4e5f-8a9b-0c1d2e3f4a5b';

Deno.test('resume token round-trips to its session id', async () => {
  assertEquals(await verifyResumeToken(await resumeToken(SESSION)), SESSION);
});

Deno.test('resume token for another session or with a tampered signature is rejected', async () => {
  const [, exp, sig] = (await resumeToken(SESSION)).split('.');
  assertEquals(await verifyResumeToken(`0b6f5a3e-1d2c-4e5f-8a9b-000000000000.${exp}.${sig}`), null);
  assertEquals(await verifyResumeToken(`${SESSION}.${exp}.${sig}x`), null);
  assertEquals(await verifyResumeToken(`${SESSION}.${Number(exp) + 1}.${sig}`), null);
  assertEquals(await verifyResumeToken('garbage'), null);
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
