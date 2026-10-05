import { NextRequest } from 'next/server';

// Receives the browser's Content-Security-Policy-Report-Only violations
// (next.config.mjs) and writes one compact line per report to the Vercel
// logs, so the allowlist can be checked against real traffic before the
// policy is enforced (review P3-6). Accepts both report formats; never errors.
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
          blocked: r?.['blocked-uri'] ?? r?.blockedURL,
          page: String(r?.['document-uri'] ?? r?.documentURL ?? '').split('?')[0], // no query: may hold an email
        })
      );
    }
  } catch {
    // Malformed or empty: nothing to log.
  }
  return new Response(null, { status: 204 });
}
