-- Defense-in-depth: enable RLS on the three private analytics bookkeeping tables.
--
-- These are written only by the cron/backfill machinery (service_role) and the client never touches
-- them; the `analytics` schema is not exposed through PostgREST and EXECUTE/SELECT grants were already
-- revoked from anon/authenticated (see 20260624042145_analytics_a_schema_bookkeeping). Even so, a
-- Supabase security advisor flags them because RLS is off. Enabling RLS with NO policies denies anon and
-- authenticated outright while service_role (and the table owner) continue to bypass RLS — so the
-- reconcile/sweep/cron jobs keep working unchanged. This is the P2 "enable RLS on the 3 analytics.*
-- bookkeeping tables" item from the production-readiness audit.
--
-- NOTE: not yet applied to the shared production project — review and apply via the dedicated-project
-- cutover (or `supabase db push`) once schema-as-code is the source of truth.

alter table analytics.meta            enable row level security;
alter table analytics.reconcile_queue enable row level security;
alter table analytics.user_watermark  enable row level security;
