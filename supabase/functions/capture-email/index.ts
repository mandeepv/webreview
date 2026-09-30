// capture-email — creates (or finds) the Supabase user for the funnel email
// and stores the funnel session. Runs BEFORE payment on purpose: the user id
// this returns rides through Dodo checkout metadata, which is what makes app
// unlock deterministic instead of email-string matching.
//
// Deploy: supabase functions deploy capture-email --no-verify-jwt
// Called ONLY by the Next.js proxy (/api/capture-email) — see isFromProxy.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { isFromProxy } from '../_shared/email.ts';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Quiz answers are a few hundred bytes. Anything near this is not a person.
const MAX_BODY_BYTES = 16_000;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!isFromProxy(req)) return json({ error: 'forbidden' }, 403);

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413);

  let body: {
    email?: string;
    sessionId?: string;
    answers?: Record<string, unknown>;
    utm?: Record<string, string>;
    landingVariant?: string;
    waitlist?: string;
    client_ip?: string;
    client_ua?: string;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  const email = (body.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: 'invalid_email' }, 400);
  const answers =
    body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)
      ? body.answers
      : {};

  // Waitlist (Android / out-of-range age): store and stop. Deliberately no
  // auth user — these are not customers yet.
  if (body.waitlist) {
    const { error } = await admin.from('waitlist').upsert({
      email,
      reason: String(body.waitlist).slice(0, 40),
      answers,
    });
    if (error) console.error('waitlist upsert failed', error.message);
    return json({ ok: true });
  }

  if (!body.sessionId || !UUID_RE.test(body.sessionId)) return json({ error: 'missing_session' }, 400);

  // Find-or-create the user. RPC first (reliable email lookup), create on miss.
  let userId: string | null = null;
  const { data: existingId, error: rpcError } = await admin.rpc('get_user_id_by_email', {
    p_email: email,
  });
  if (rpcError) {
    console.error('get_user_id_by_email failed', rpcError.message);
    return json({ error: 'lookup_failed' }, 500);
  }
  userId = (existingId as string | null) ?? null;

  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      // Confirmed at creation: the user proves ownership later via the OTP
      // they must complete to sign in — there is no password to protect.
      email_confirm: true,
    });
    if (error || !data?.user) {
      console.error('createUser failed', error?.message);
      return json({ error: 'create_failed' }, 500);
    }
    userId = data.user.id;
  }

  const { error: upsertError } = await admin.from('funnel_sessions').upsert({
    id: body.sessionId,
    user_id: userId,
    answers,
    utm: body.utm ?? {},
    landing_variant: String(body.landingVariant ?? 'default').slice(0, 40),
    capi: { ip: body.client_ip ?? '', ua: body.client_ua ?? '' },
    updated_at: new Date().toISOString(),
  });
  if (upsertError) {
    console.error('funnel_sessions upsert failed', upsertError.message);
    return json({ error: 'session_save_failed' }, 500);
  }

  return json({ userId });
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
