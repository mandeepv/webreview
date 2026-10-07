// resume — rebuilds a funnel session in a browser that never saw the quiz
// (review P1-6). Two actions, both via the Next.js proxy (/api/resume):
//
//   mint    { sessionId, email } → { token }   the device holding the session
//                                        (and its email) asks for a link to
//                                        continue elsewhere ("open in Safari
//                                        for Apple Pay")
//   resolve { token }      → the session: id, user, email, answers, utm,
//                                        variant, and whether they already pay
//
// Links are kinderwell.app/r/<token> (app/r/[token]/route.ts resolves them
// server-side, so the token never reaches a page URL the pixel can see).
// Win-back emails carry a token minted by winback-sweep. Tokens are opaque
// (encrypted and authenticated, so the session id is not in the link) and
// expire after 30 days (_shared/email.ts).
//
// Deploy: supabase functions deploy resume --no-verify-jwt
// Secrets: UNSUBSCRIBE_SECRET (required, no fallback), FUNNEL_PROXY_SECRET

import { createClient } from 'npm:@supabase/supabase-js@2';
import { isFromProxy, resumeToken, signingConfigured, timingSafeEqual, verifyResumeToken } from '../_shared/email.ts';
import { hasAccess } from '../_shared/entitlement.ts';
import { ipBucket, isRateLimited } from '../_shared/ratelimit.ts';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The whole function. index.ts serves it; the integration tests call it directly. */
export async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!isFromProxy(req)) return json({ error: 'forbidden' }, 403);

  let body: { action?: string; sessionId?: string; email?: string; token?: string; client_ip?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  if (await isRateLimited(admin, [{ key: `resume:ip:${ipBucket(body.client_ip)}`, windowSeconds: 60, max: 20 }])) {
    return json({ error: 'rate_limited' }, 429);
  }

  if (!signingConfigured()) {
    console.error('UNSUBSCRIBE_SECRET is not set — resume links unavailable');
    return json({ error: 'not_configured' }, 503);
  }

  if (body.action === 'mint') {
    if (!body.sessionId || !UUID_RE.test(body.sessionId)) return json({ error: 'missing_session' }, 400);
    const { data: session } = await admin
      .from('funnel_sessions')
      .select('id, user_id')
      .eq('id', body.sessionId)
      .maybeSingle();
    if (!session?.user_id) return json({ error: 'session_not_found' }, 404);
    // The device asking holds the session AND its email (both in its
    // storage). A bare session id is not enough: a link resolves to the
    // email and quiz answers, and session ids have travelled further than
    // the device — Dodo's checkout metadata, older email links (IN-2).
    // Wrong email looks exactly like no session.
    const { data: userData } = await admin.auth.admin.getUserById(session.user_id);
    const accountEmail = userData?.user?.email?.toLowerCase() ?? '';
    const claimed = (body.email ?? '').trim().toLowerCase();
    if (!accountEmail || !claimed || !timingSafeEqual(claimed, accountEmail)) {
      return json({ error: 'session_not_found' }, 404);
    }
    return json({ token: await resumeToken(session.id) });
  }

  if (body.action === 'resolve') {
    const sessionId = body.token ? await verifyResumeToken(body.token) : null;
    if (!sessionId) return json({ error: 'invalid_token' }, 401);

    const { data: session, error } = await admin
      .from('funnel_sessions')
      .select('id, user_id, answers, utm, landing_variant')
      .eq('id', sessionId)
      .maybeSingle();
    if (error) return json({ error: 'lookup_failed' }, 500);
    if (!session?.user_id) return json({ error: 'session_not_found' }, 404);

    const [{ data: userData }, { data: entitlement }] = await Promise.all([
      admin.auth.admin.getUserById(session.user_id),
      admin
        .from('entitlements')
        .select('status, current_period_end')
        .eq('user_id', session.user_id)
        .eq('source', 'dodo')
        .maybeSingle(),
    ]);
    const email = userData?.user?.email;
    if (!email) return json({ error: 'user_not_found' }, 404);

    const subscribed = hasAccess(entitlement, new Date());

    return json({
      sessionId: session.id,
      userId: session.user_id,
      email,
      answers: session.answers ?? {},
      utm: session.utm ?? {},
      landingVariant: session.landing_variant ?? 'default',
      subscribed,
    });
  }

  return json({ error: 'unknown_action' }, 400);
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
