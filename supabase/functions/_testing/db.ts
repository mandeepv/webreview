// Direct database access for arranging and checking integration tests. Uses
// the local service-role key; env.ts has already refused anything non-local.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { SERVICE_ROLE_KEY, SUPABASE_URL } from './env.ts';

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  client ??= createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  return client;
}

/** A fresh, confirmed auth user — every test makes its own so tests never share state. */
export async function createUser(email = `t-${crypto.randomUUID()}@example.com`): Promise<{ id: string; email: string }> {
  const { data, error } = await db().auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  return { id: data.user.id, email };
}

/** A user who has completed a sign-in (sets auth.users.last_sign_in_at), as an app sign-in would. */
export async function createSignedInUser(): Promise<{ id: string; email: string }> {
  const email = `t-${crypto.randomUUID()}@example.com`;
  const password = `pw-${crypto.randomUUID()}`;
  const { data, error } = await db().auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  const session = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { error: signInError } = await session.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`sign-in failed: ${signInError.message}`);
  return { id: data.user.id, email };
}

export async function deleteUser(id: string) {
  const { error } = await db().auth.admin.deleteUser(id);
  if (error) throw new Error(`deleteUser failed: ${error.message}`);
}

export type EntitlementRow = {
  user_id: string;
  status: string;
  product_id: string;
  dodo_subscription_id: string | null;
  dodo_customer_id: string | null;
  current_period_end: string | null;
  cancel_pending: boolean;
  activated_subscription_id: string | null;
  activated_at: string | null;
  nudge_stage: number;
  last_event_at: string | null;
};

export async function entitlement(userId: string): Promise<EntitlementRow | null> {
  const { data, error } = await db()
    .from('entitlements')
    .select('*')
    .eq('user_id', userId)
    .eq('source', 'dodo')
    .maybeSingle();
  if (error) throw new Error(`entitlement read failed: ${error.message}`);
  return data as EntitlementRow | null;
}

export async function putEntitlement(row: Partial<EntitlementRow> & { user_id: string; status: string }) {
  const { error } = await db()
    .from('entitlements')
    .upsert({ source: 'dodo', product_id: 'pdt_TEST_ANNUAL', ...row }, { onConflict: 'user_id,source' });
  if (error) throw new Error(`entitlement write failed: ${error.message}`);
}

export async function putFunnelSession(row: Record<string, unknown> & { id: string }) {
  const { error } = await db().from('funnel_sessions').upsert(row);
  if (error) throw new Error(`funnel_sessions write failed: ${error.message}`);
}

/** Rows parked for a human, newest first, optionally narrowed to one subscription. */
export async function unlinked(subscriptionId?: string | null) {
  let q = db().from('unlinked_purchases').select('*').order('id', { ascending: false });
  if (subscriptionId) q = q.eq('dodo_subscription_id', subscriptionId);
  const { data, error } = await q;
  if (error) throw new Error(`unlinked_purchases read failed: ${error.message}`);
  return data ?? [];
}

export async function webhookEvent(id: string) {
  const { data } = await db().from('webhook_events').select('*').eq('id', id).maybeSingle();
  return data as { id: string; status: string; received_at: string } | null;
}

export const days = (n: number) => n * 24 * 3600 * 1000;
export const isoIn = (ms: number) => new Date(Date.now() + ms).toISOString();
