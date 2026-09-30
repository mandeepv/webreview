// unsubscribe — records a marketing opt-out. Reached only through the
// Next.js proxy (/api/unsubscribe), which serves both the link in the email
// body (via the /unsubscribe page) and Gmail/Yahoo one-click unsubscribe
// (RFC 8058 POST to the List-Unsubscribe URL).
//
// Deploy: supabase functions deploy unsubscribe --no-verify-jwt
// Secrets: UNSUBSCRIBE_SECRET (falls back to SWEEP_SECRET), FUNNEL_PROXY_SECRET

import { createClient } from 'npm:@supabase/supabase-js@2';
import { isFromProxy, verifyUnsubscribeToken } from '../_shared/email.ts';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!isFromProxy(req)) return json({ error: 'forbidden' }, 403);

  let body: { u?: string; t?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  const userId = body.u ?? '';
  const token = body.t ?? '';
  if (!UUID_RE.test(userId) || !token || !(await verifyUnsubscribeToken(userId, token))) {
    return json({ error: 'invalid_link' }, 400);
  }

  const { error } = await admin.from('email_opt_outs').upsert({ user_id: userId });
  if (error) {
    console.error('opt-out upsert failed', error.message);
    return json({ error: 'storage_error' }, 500);
  }
  return json({ ok: true });
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
