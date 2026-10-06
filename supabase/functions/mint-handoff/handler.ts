// mint-handoff — gives the buyer's own browser a one-time handoff link on
// /welcome (SPEC-21 §4.2). The page puts it on the clipboard as it opens the
// App Store, and the app redeems it on first launch, so the buyer opens the
// app already signed in.
//
// What proves the caller is the buyer's browser: the funnel sessionId AND a
// browser-only nonce whose sha256 create-checkout stored. The sessionId alone
// is not enough: processors see it (Dodo's checkout metadata, the resume
// links in win-back emails). It no longer reaches Meta: the Lead event id is
// a hash of it (_shared/meta.ts leadEventId). The nonce never leaves the
// browser except to our own functions.
//
// A key is issued only when the nonce matches, the purchase landed less than
// 24 h ago (funnel_sessions.purchased_at, written by dodo-webhook at first
// activation) and the web entitlement is active. At most 5 per session a day.
//
// Answers (the page retries only not_ready and 5xx):
//   200 { link } · 400 bad_request · 403 not_entitled · 404 not_found ·
//   409 not_ready · 410 expired · 429 rate_limited · 500 error
//
// The response carries a login credential: it is never logged, here or in
// the proxy. Requires migration 20261006000000_handoff_keys.sql.
// Deploy: supabase functions deploy mint-handoff --no-verify-jwt
// Called ONLY by the Next.js proxy (/api/mint-handoff) — see isFromProxy.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { isFromProxy } from '../_shared/email.ts';
import { decideMint, KEY_RE, mintHandoffKey, sha256Hex } from '../_shared/handoff.ts';
import { isRateLimited } from '../_shared/ratelimit.ts';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS = { not_found: 404, not_ready: 409, expired: 410, not_entitled: 403 } as const;

/** The whole function. index.ts serves it; the integration tests call it directly. */
export async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!isFromProxy(req)) return json({ error: 'forbidden' }, 403);

  let body: { sessionId?: unknown; nonce?: unknown; client_ip?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  const nonce = typeof body.nonce === 'string' ? body.nonce : '';
  if (!UUID_RE.test(sessionId) || !KEY_RE.test(nonce)) return json({ error: 'bad_request' }, 400);

  // Attempts. The page polls while the webhook lands (about 11 tries in a
  // minute), so these are loose; the mint cap below is the real limit.
  if (
    await isRateLimited(admin, [
      { key: `mh:ip:${body.client_ip ?? ''}`, windowSeconds: 600, max: 60 },
      { key: `mh:session:${sessionId}`, windowSeconds: 600, max: 30 },
    ])
  ) {
    return json({ error: 'rate_limited' }, 429);
  }

  const { data: session, error: sessionError } = await admin
    .from('funnel_sessions')
    .select('user_id, handoff_nonce_hash, purchased_at')
    .eq('id', sessionId)
    .maybeSingle();
  if (sessionError) {
    console.error('mint-handoff session read failed', sessionError.message);
    return json({ error: 'error' }, 500);
  }

  // A failed read is an error, never "not entitled" and never "entitled".
  let entitlement = null;
  if (session?.user_id && session.purchased_at) {
    const { data, error } = await admin
      .from('entitlements')
      .select('status, current_period_end')
      .eq('user_id', session.user_id)
      .eq('source', 'dodo')
      .maybeSingle();
    if (error) {
      console.error('mint-handoff entitlement read failed', error.message);
      return json({ error: 'error' }, 500);
    }
    entitlement = data;
  }

  const decision = decideMint(session, await sha256Hex(nonce), entitlement, new Date());
  if (decision !== 'ok') return json({ error: decision }, STATUS[decision]);

  // Counted only when a key would really be issued, so polling doesn't use it up.
  if (await isRateLimited(admin, [{ key: `mh:mint:${sessionId}`, windowSeconds: 86_400, max: 5 }])) {
    return json({ error: 'rate_limited' }, 429);
  }

  const link = await mintHandoffKey(admin, session!.user_id!, 'welcome');
  if (!link) return json({ error: 'error' }, 500);
  return json({ link });
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    // The 200 carries a login credential: nothing may cache it.
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
