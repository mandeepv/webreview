# Deploy log — edge functions

Written by `scripts/deploy-functions.sh`: one row per function, added the
moment its deploy succeeds. Supabase keeps a version number per function but
not which code it was; this is that record. Commit it after each deploy.

To check reality against it: `supabase functions list` (dev) or
`supabase functions list --project-ref <PROD_PROJECT_REF>` (prod).

**Before this log existed** (from `supabase functions list`, 2026-10-07), dev ran:
`capture-email` v9 and `create-checkout` v9 (2026-09-19), `winback-sweep` v10
(2026-09-19), `dodo-webhook` v11 (2026-09-19); the app's `redeem-handoff` v1
(2026-10-06) and `delete-account` v18 (2026-07-11), which are deployed from
`~/mamalearn` and recorded in its `docs/OPS_STATE.md`, not here. Prod: none of
the website's functions.

| Deployed (UTC) | Project | Function | Commit |
|---|---|---|---|
