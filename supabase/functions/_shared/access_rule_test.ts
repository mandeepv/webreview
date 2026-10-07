// deno test (the table is a static JSON import: no read permission needed)
// The web copy of the access rule against the table both repos share
// (access_rule_cases.json — the app runs isWebEntitled and redeem-handoff's
// hasWebAccess over the same file).
import { assertEquals } from 'jsr:@std/assert@1';
import { hasAccess } from './entitlement.ts';
import table from './access_rule_cases.json' with { type: 'json' };

type Case = { status: string; hours_after_end: number | null; entitled: boolean; why: string };
const cases = table.cases as Case[];
const NOW = new Date('2026-11-01T09:00:00.000Z');

for (const c of cases) {
  Deno.test(`access rule: ${c.status}, ${c.hours_after_end ?? 'no end'} h after the end → ${c.entitled} (${c.why})`, () => {
    const end = c.hours_after_end === null ? null : new Date(NOW.getTime() - c.hours_after_end * 3600 * 1000).toISOString();
    assertEquals(hasAccess({ status: c.status, current_period_end: end }, NOW), c.entitled);
  });
}
