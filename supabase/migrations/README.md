# Database migrations

Version-controlled Postgres migrations for Daily Rep, applied to the Supabase project via
`supabase db push` (or replayed into a fresh project with `supabase db reset`).

## Provenance / schema-as-code

Migrations `20260623233216_fitforge_state_init` … `20260626121932_seed_exercise_facts_kettlebell_additions`
were originally applied to the live project **directly from a prior session** and existed only in the
remote ledger (`supabase_migrations.schema_migrations`). They have now been pulled back into this
directory verbatim — exactly the SQL that was applied — so the schema, RLS policies, the monotonic
write guard, the analytics projection pipeline, and `purge_user_data` are reviewable and recoverable
from source control. This closes the audit's P0 "schema lives only in the remote ledger" gap.

Covered objects (cross-checked against the live `public` + `analytics` schemas):

- `public.daily_rep_state` — per-user JSONB blob, owner-only RLS, monotonic-clock write guard
- `public.plans` — DB-managed plan overlay (public-read)
- `public.exercise_facts`, `public.analytics_sessions`, `public.analytics_session_sets`,
  `public.analytics_profile` — analytics projection tables (FORCE RLS, SELECT-only to the client)
- `analytics.meta`, `analytics.reconcile_queue`, `analytics.user_watermark` — private bookkeeping
- analytics math helpers, the `reconcile_user` extractor, drain/sweep automation, pg_cron schedules,
  per-user views + RPCs, cohort matviews, and `public.purge_user_data` (GDPR erasure)
- `public.subscriptions` + trial trigger, hardened functions, least-privilege grants

## Caveats

- **Reproducibility on a fresh project:** these were authored against the shared project's history.
  `20260623235631_drop_legacy_jolte_tesla_schema` drops the unrelated co-tenant (Tesla/EV) objects with
  `IF EXISTS`, so it is a harmless no-op on a clean project. The analytics/cron migrations require the
  `pg_cron` (and `pg_net`) extensions; they `create extension if not exists` where needed. Verify a clean
  `supabase db reset` reproduces the schema before relying on it for the dedicated-project cutover.
- **Drift:** treat the live project as downstream of this directory from now on. Do not apply ad-hoc DDL
  through the dashboard; add a migration here and `db push` instead. A CI drift check is a recommended
  follow-up (see the production-readiness task list).
