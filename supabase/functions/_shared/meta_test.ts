// deno test --allow-env
import { assertEquals } from 'jsr:@std/assert@1';
import { leadEventId } from './meta.ts';

// The same vector is pinned in lib/meta.test.ts: the browser pixel and this
// server twin must produce the identical id, or Meta counts every Lead twice.
Deno.test('the Lead event id is "lead-" + the sha256 of the session id, never the id itself', async () => {
  const sessionId = '0b6f5a3e-1d2c-4e5f-8a9b-0c1d2e3f4a5b';
  const id = await leadEventId(sessionId);
  assertEquals(id, 'lead-1129de95b35538debaff2294377bffd8b1e5bb25b8b6cb843ccdbbb9a50377c4');
  assertEquals(id.includes(sessionId), false);
});
