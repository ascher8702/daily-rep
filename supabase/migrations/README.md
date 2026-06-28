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

## Deferred / future work (rescued from archived audits)

DB-flavored items that were held, deferred, or explicitly rejected in two point-in-time docs, kept here
so they aren't lost when those docs are archived. None of these are applied; treat each as a flagged seam,
not a TODO to action blindly.

From the 2026-06-23 DB architecture audit:

- **[LOW] ~5MB `data` size CHECK on `public.daily_rep_state`** (runaway-blob backstop) — **deferred**.
  Only worth adding with a generous cap **and** client-side rejected-push handling: without it a rejected
  upsert makes `pushNow` throw unhandled → silent sync stop.
- **Automated RLS per-user isolation regression test** — still missing. Should assert `anon` sees 0 rows
  and that user A cannot read user B's row.
- **Rejected as HARMFUL — do NOT add:** a `client_updated_at <= now() + interval '1 day'` CHECK. Users with
  fast device clocks send legitimately future timestamps; the check would silently break their cloud sync.
  Also rejected: lowering `fillfactor` / per-table autovacuum tuning — premature on a 1-row-per-user,
  PK-only table (HOT skips the unchanged index; the real cost is TOAST, which `fillfactor` doesn't touch).

From the session-analytics design spec:

- **Partition `analytics_session_sets`** via `pg_partman` (monthly RANGE on `performed_at`) at the
  data-driven threshold (~100M set rows / vacuum bloat). The PK must then include the partition key — a
  surrogate `bigint`, or `set_id + performed_at`.
- **Convert the cohort matview refresh to an incremental rollup** when a full refresh gets heavy. The
  `analytics.refresh_cohort_hourly` / `analytics.refresh_cohort_nightly` procedures are the seam.
- **Persist an immutable original-unit weight at `finishWorkout`** to remove `*_kg` gym-rounding drift
  from analytics (a future client change).
- **On unit switch, prefer an in-place `UPDATE`** of stored set weights over `DELETE` + reinsert.

_Provenance: captured from `docs/archived/db-architecture-audit-2026-06-23.md` and
`docs/archived/sessions-analytics-spec.json`._
