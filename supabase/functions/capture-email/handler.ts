// capture-email — creates (or finds) the Supabase user for the funnel email
// and stores the funnel session. Runs BEFORE payment on purpose: the user id
// this returns rides through Dodo checkout metadata, which is what makes app
// unlock deterministic instead of email-string matching.
//
// Deploy: supabase functions deploy capture-email --no-verify-jwt
// Called ONLY by the Next.js proxy (/api/capture-email) — see isFromProxy.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { isFromProxy } from '../_shared/email.ts';
import { afterResponse, leadEventId, sendCapiEvent } from '../_shared/meta.ts';
import { ipBucket, isRateLimited } from '../_shared/ratelimit.ts';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Quiz answers are a few hundred bytes. Anything near this is not a person.
const MAX_BODY_BYTES = 16_000;
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'a'];

/**
 * Answers are option values (short slugs), multi-select arrays of them, and
 * one free-text first name. Anything else — long strings, nested objects,
 * unknown shapes — is dropped rather than stored (P3-19).
 */
function cleanAnswers(input: unknown): Record<string, string | string[] | number> {
  const out: Record<string, string | string[] | number> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input).slice(0, 40)) {
    if (!/^[a-z0-9-]{1,40}$/.test(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'string') out[key] = value.slice(0, key === 'name' ? 40 : 80);
    else if (Array.isArray(value)) {
      out[key] = value.filter((v): v is string => typeof v === 'string').slice(0, 12).map((v) => v.slice(0, 80));
    }
  }
  return out;
}

function cleanUtm(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const key of UTM_KEYS) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === 'string' && value) out[key] = value.slice(0, 500);
  }
  return out;
}

/** The whole function. index.ts serves it; the integration tests call it directly. */
export async function handler(req: Request): Promise<Response> {
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
    hp?: string; // honeypot — a hidden field no person fills in
    meta?: { fbp?: string; fbc?: string };
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
  const answers = cleanAnswers(body.answers);

  // A filled honeypot is a form-filling bot. Answer like a success so it
  // moves on, but create no account and queue no email (P1-7). BEFORE the
  // rate limits (IN-5): five bot posts used to use up a real person's
  // per-address allowance and lock them out of the funnel for an hour.
  if (body.hp) return json({ userId: crypto.randomUUID() });

  // Each capture can create an account and queue marketing email, so a
  // script posting harvested addresses is the abuse case: cap per IP and per
  // address (P1-7). The answer says which, so the page can say how long.
  const ip = ipBucket(body.client_ip);
  if (
    await isRateLimited(admin, [
      { key: `ce:ip:${ip}`, windowSeconds: 60, max: 10 },
      { key: `ce:ip-hour:${ip}`, windowSeconds: 3600, max: 40 },
    ])
  ) {
    return json({ error: 'rate_limited', retry: 'minute' }, 429);
  }
  if (await isRateLimited(admin, [{ key: `ce:email:${email}`, windowSeconds: 3600, max: 5 }])) {
    return json({ error: 'rate_limited', retry: 'hour' }, 429);
  }

  // Waitlist (Android / out-of-range age): store and stop. Deliberately no
  // auth user — these are not customers yet. Only the fields needed to
  // follow up (P3-10), and first write wins so nobody can overwrite another
  // person's row (P3-17).
  if (body.waitlist) {
    const childAge = answers['child-age'];
    const { error } = await admin.from('waitlist').upsert(
      {
        email,
        reason: String(body.waitlist).slice(0, 40),
        answers: childAge ? { 'child-age': childAge } : {},
      },
      { onConflict: 'email', ignoreDuplicates: true }
    );
    if (error) console.error('waitlist insert failed', error.message);
    return json({ ok: true });
  }

  if (!body.sessionId || !UUID_RE.test(body.sessionId)) return json({ error: 'missing_session' }, 400);

  // Find-or-create the user. RPC first (reliable email lookup), create on miss.
  let userId: string | null = null;
  const [{ data: existingId, error: rpcError }, { data: priorSession, error: sessionError }] = await Promise.all([
    admin.rpc('get_user_id_by_email', { p_email: email }),
    admin.from('funnel_sessions').select('user_id').eq('id', body.sessionId).maybeSingle(),
  ]);
  if (rpcError || sessionError) {
    console.error('capture lookup failed', (rpcError ?? sessionError)!.message);
    return json({ error: 'lookup_failed' }, 500);
  }
  userId = (existingId as string | null) ?? null;

  // A session that already belongs to one account is never moved to another
  // (review 2026-10-07, B-3). The upsert below used to re-point user_id to
  // whoever posted the session id with a different email, so a session id
  // seen in a link or in Dodo's metadata let someone steer the buyer's
  // purchase onto their own account. Checked before any account is created.
  // The browser answers 409 by carrying on under a fresh session id.
  if (priorSession?.user_id && priorSession.user_id !== userId) {
    return json({ error: 'session_taken' }, 409);
  }

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
    utm: cleanUtm(body.utm),
    landing_variant: String(body.landingVariant ?? 'default').slice(0, 40),
    capi: {
      ip: body.client_ip ?? '',
      ua: body.client_ua ?? '',
      fbp: String(body.meta?.fbp ?? '').slice(0, 200),
      fbc: String(body.meta?.fbc ?? '').slice(0, 300),
    },
    updated_at: new Date().toISOString(),
  });
  if (upsertError) {
    console.error('funnel_sessions upsert failed', upsertError.message);
    return json({ error: 'session_save_failed' }, 500);
  }

  // Server twin of the browser's Lead pixel (same event id → Meta keeps one),
  // so ad blockers and ITP can't erase the funnel's main optimisation
  // signal (P2-2). Sent after the response; the buyer never waits on Meta.
  await afterResponse(
    sendCapiEvent({
      eventName: 'Lead',
      eventId: await leadEventId(body.sessionId),
      sourcePath: '/email',
      user: { email, userId, fbp: body.meta?.fbp, fbc: body.meta?.fbc, ip: body.client_ip, ua: body.client_ua },
    })
  );

  return json({ userId });
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
