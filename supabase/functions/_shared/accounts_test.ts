// deno test --allow-env
import { assertEquals } from 'jsr:@std/assert@1';
import { ACCOUNT_SLACK_MS, accountPredatesSession } from './accounts.ts';

const SESSION = '2026-10-07T12:00:00.000Z';
const before = (ms: number) => new Date(new Date(SESSION).getTime() - ms).toISOString();

Deno.test('an account the funnel created for this session does not predate it', () => {
  // createUser runs just before the session row is inserted.
  assertEquals(accountPredatesSession(before(300), SESSION), false);
  assertEquals(accountPredatesSession(before(ACCOUNT_SLACK_MS - 1000), SESSION), false);
  // Later than the session (clock skew between auth and the table): ours.
  assertEquals(accountPredatesSession(before(-5000), SESSION), false);
});

Deno.test('an account older than the session (an app user, someone else’s address, an earlier lead) predates it', () => {
  assertEquals(accountPredatesSession(before(ACCOUNT_SLACK_MS + 1000), SESSION), true);
  assertEquals(accountPredatesSession(before(30 * 24 * 3600 * 1000), SESSION), true);
});

Deno.test('a missing or unreadable date counts as predating: no proof, no credential', () => {
  assertEquals(accountPredatesSession(null, SESSION), true);
  assertEquals(accountPredatesSession(before(300), null), true);
  assertEquals(accountPredatesSession(undefined, undefined), true);
  assertEquals(accountPredatesSession('not a date', SESSION), true);
});
