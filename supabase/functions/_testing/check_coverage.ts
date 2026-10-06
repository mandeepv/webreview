// CI coverage gate (spec work item 7): the handlers that decide who has paid,
// what they are charged, and who gets a sign-in link (mint-handoff, SPEC-21)
// must keep ≥ 80% line coverage from the integration tests. Everything else
// is reported, not enforced (yet).
//
//   deno run --allow-read supabase/functions/_testing/check_coverage.ts coverage.lcov

const GATED: Record<string, number> = {
  'supabase/functions/dodo-webhook/handler.ts': 80,
  'supabase/functions/create-checkout/handler.ts': 80,
  'supabase/functions/mint-handoff/handler.ts': 80,
};

const lcov = await Deno.readTextFile(Deno.args[0] ?? 'coverage.lcov');
const rows: Array<{ file: string; pct: number; hit: number; found: number }> = [];
for (const record of lcov.split('end_of_record')) {
  const file = /^SF:(.+)$/m.exec(record)?.[1];
  const found = Number(/^LF:(\d+)$/m.exec(record)?.[1] ?? 0);
  const hit = Number(/^LH:(\d+)$/m.exec(record)?.[1] ?? 0);
  if (!file || !found) continue;
  const rel = file.slice(file.indexOf('supabase/functions/'));
  rows.push({ file: rel, hit, found, pct: (100 * hit) / found });
}

let failed = false;
for (const r of rows.sort((a, b) => a.file.localeCompare(b.file))) {
  const min = GATED[r.file];
  const mark = min === undefined ? '  ' : r.pct >= min ? '✓ ' : '✗ ';
  if (min !== undefined && r.pct < min) failed = true;
  console.log(`${mark}${r.pct.toFixed(1).padStart(5)}%  ${r.file}${min ? `  (min ${min}%)` : ''}`);
}
for (const file of Object.keys(GATED)) {
  if (!rows.some((r) => r.file === file)) {
    console.log(`✗ no coverage recorded for ${file}`);
    failed = true;
  }
}
if (failed) {
  console.error('\nCoverage gate failed: a money-path handler fell below its minimum.');
  Deno.exit(1);
}
