// deno test --allow-env (isFromProxy reads its secrets from the environment)
import { assertEquals } from 'jsr:@std/assert@1';
import { isFromProxy } from './email.ts';

const KEYS = ['FUNNEL_PROXY_SECRET', 'ALLOW_UNAUTHENTICATED_FUNNEL', 'DODO_ENV'];
function withEnv(env: Record<string, string>, fn: () => void) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, Deno.env.get(k)]));
  for (const k of KEYS) Deno.env.delete(k);
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) (v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v));
  }
}
const req = (key?: string) => new Request('http://x/', { headers: key ? { 'x-funnel-proxy-key': key } : {} });

Deno.test('the proxy secret must match; an unset secret refuses everything (P2-15)', () => {
  withEnv({ FUNNEL_PROXY_SECRET: 's3cret' }, () => {
    assertEquals(isFromProxy(req('s3cret')), true);
    assertEquals(isFromProxy(req('wrong')), false);
    assertEquals(isFromProxy(req()), false);
  });
  withEnv({}, () => assertEquals(isFromProxy(req('anything')), false));
});

Deno.test('ALLOW_UNAUTHENTICATED_FUNNEL opens the door locally, never in live mode (IN-9)', () => {
  withEnv({ ALLOW_UNAUTHENTICATED_FUNNEL: '1', DODO_ENV: 'test' }, () => assertEquals(isFromProxy(req()), true));
  withEnv({ ALLOW_UNAUTHENTICATED_FUNNEL: '1' }, () => assertEquals(isFromProxy(req()), true));
  withEnv({ ALLOW_UNAUTHENTICATED_FUNNEL: '1', DODO_ENV: 'live' }, () => assertEquals(isFromProxy(req()), false));
});
