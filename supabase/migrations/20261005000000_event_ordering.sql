-- P2-17: Dodo retries a failed webhook delivery hours later, so an OLDER
-- subscription event can arrive after a newer one (e.g. a retried `renewed`
-- after `expired`). dodo-webhook stores when the newest applied event
-- happened and ignores older events for the same subscription.
--
-- Additive only (one nullable column). Same discipline as the others: copy
-- into the app repo's supabase/migrations/, dev first, prod via
-- scripts/db-push-prod.sh. Apply BEFORE deploying the dodo-webhook that
-- writes it — the webhook's upsert names this column.
alter table public.entitlements
  add column if not exists last_event_at timestamptz;
