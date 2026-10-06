import { NextRequest } from 'next/server';

// Receives the browser's Content-Security-Policy-Report-Only violations
// (next.config.mjs) and writes one compact line per report to the Vercel
// logs, so the allowlist can be checked against real traffic before the
// policy is enforced (review P3-6). Accepts both report formats; never errors.
//
// SPEC-21 sign-in links (/k/<key>, kinderwell://k/<key>) carry a login
// credential. The link page is left out of the report-only policy
// (next.config.mjs), but a report could still name one, so any key is
// blanked before a line is written.
const SIGN_IN_KEY = /\/k\/[^/?#\s"']+/g;
const redact = (value: unknown) => (value == null ? value : String(value).replace(SIGN_IN_KEY, '/k/[redacted]'));

export async function POST(req: NextRequest) {
  try {
    const text = (await req.text()).slice(0, 8_000);
    const parsed = JSON.parse(text);
    const reports = Array.isArray(parsed) ? parsed.map((r) => r?.body ?? r) : [parsed?.['csp-report'] ?? parsed];
    for (const r of reports.slice(0, 20)) {
      console.warn(
        '[csp-report]',
        JSON.stringify({
          directive: r?.['effective-directive'] ?? r?.effectiveDirective ?? r?.['violated-directive'],
          blocked: redact(r?.['blocked-uri'] ?? r?.blockedURL),
          page: redact(String(r?.['document-uri'] ?? r?.documentURL ?? '').split('?')[0]), // no query: may hold an email
        })
      );
    }
  } catch {
    // Malformed or empty: nothing to log.
  }
  return new Response(null, { status: 204 });
}
