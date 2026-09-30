-- Marketing-email opt-outs (the abandoned-funnel win-back ladder). CAN-SPAM
-- requires honoring these within 10 business days; we honor them on the next
-- sweep. Transactional mail (receipts, "finish setting up the app" for people
-- who paid) is unaffected.
--
-- Same discipline as 20260918000000_web2app.sql: copy into the app repo's
-- supabase/migrations/, dev first, prod only via scripts/db-push-prod.sh.

create table if not exists public.email_opt_outs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.email_opt_outs enable row level security;
-- No policies: written by the unsubscribe edge function, read by
-- winback-sweep, both service_role.
