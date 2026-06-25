# Runbook — Migrate to a Dedicated Supabase Project (Daily Rep)

> **Why this is a launch blocker.** Daily Rep currently shares Supabase project
> `aswwhsxubqyzbrfoptoq` with an unrelated app. Shared tenancy means a co-tenant incident (a bad
> migration, a quota/usage spike, a billing lapse, a PITR restore — see
> [runbook-backup-restore.md](runbook-backup-restore.md) §5.2) blasts BOTH apps, and the two apps'
> data shares one backup/restore boundary. Before charging money, Daily Rep should live in its own
> project. This runbook is the migration plan. Object names were introspected from the live project
> on 2026-06-24; re-verify before executing.
>
> `[HUMAN]` end-to-end: provisioning a project, direct-DB `pg_dump`/`psql`, and dashboard toggles
> can't be done by the app/loop. The loop has prepared the schema-aware plan below.

---

## 1. What has to move (and what doesn't)

| Object | Schema | Migrate? | Notes |
|---|---|---|---|
| `auth.users` (+ `auth.identities`) | `auth` | **YES — first** | Email + GoTrue password hashes. `daily_rep_state` FKs this `ON DELETE CASCADE`, so it must exist before the blobs. Moving hashes lets users keep their passwords. |
| `public.daily_rep_state` | `public` | **YES** | The per-user source-of-truth blob. The only essential user table. |
| `public.plans` (32) | `public` | seed | Reference data — re-seed from the app's seed, not from user data. |
| `public.exercise_facts` | `public` | seed | Exercise catalogue (regions / bodyweight flags). Re-seed. |
| `public.analytics_sessions` / `analytics_session_sets` / `analytics_profile` | `public` | **NO — rebuild** | Pure projection of the blob. Recreate the tables (DDL), then `analytics.backfill_projection()` (§4.5) regenerates the rows — don't copy them. |
| `analytics.meta` / `reconcile_queue` / `user_watermark` | `analytics` | NO — rebuild | Projection bookkeeping; recreated by the DDL + backfill. |

**Schema objects to recreate (DDL / "schema-as-code"):** the 6 `public` tables + 3 `analytics`
tables; RLS policies (`daily_rep_state` select/insert/update/delete-own; read-only `*_read` on the
analytics projections, `exercise_facts`, `plans`); functions (`public.purge_user_data`,
`daily_rep_guard_monotonic`, `daily_rep_touch_updated_at`, `plans_touch_updated_at`,
`my_volume_percentile`, `my_weekly_streak`; `analytics.backfill_projection`, `reconcile_user`,
`drain_reconcile_queue`, `sweep_stale`, `tg_enqueue_reconcile`, `effective_weight`, `epley_1rm`,
`is_projectable`, `to_kg`, `refresh_cohorts_hourly`, `refresh_cohorts_nightly`); triggers on
`daily_rep_state` (`*_guard_monotonic`, `*_touch`, `*_enqueue_ins`, `*_enqueue_upd`) + `plans_touch`;
the `v_my_*` views; the 5 `pg_cron` jobs (§4.6); the `delete-account` Edge Function (§4.7).

> ⚠️ There is no `supabase/migrations/` dir in the repo yet (schema-as-code is a separate
> `[HUMAN]`/CLI gap). **Do that first** so this DDL is reproducible: `supabase db pull` against the
> current project to capture the schema, commit it, THEN apply to the new project. Until then, the
> DDL must be hand-extracted (`pg_dump --schema-only`).

---

## 2. Pre-reqs

- Owner/admin on the Supabase org; ability to create a project.
- The Supabase CLI (`supabase`) and `psql`/`pg_dump` (v15+) locally, plus the **direct connection
  string** (not the pooler) for both source and target — Dashboard → Project Settings → Database.
- A maintenance window: the cutover briefly makes the old project read-only to avoid split-brain
  writes. Daily Rep is offline-first, so clients keep working locally during it.

---

## 3. Provision the target project

1. Create the new project (same region as the app's users / Vercel region to minimise latency).
2. Enable the required extensions (introspected versions): **`pg_cron`** (1.6.x), **`pgcrypto`**,
   **`uuid-ossp`** (Dashboard → Database → Extensions). `pg_cron` must be enabled before the cron
   jobs in §4.6 can be created.
3. Note the new **Project URL** + **anon key** (Settings → API) for the cutover (§5).

---

## 4. Migrate (run in this order — FK + derived-data aware)

> Source = `aswwhsxubqyzbrfoptoq`, Target = the new project. Use the **direct** connection strings.

**4.1 Apply the schema (DDL) to the target** — from the committed `supabase/migrations/` (preferred)
or a schema-only dump:
```bash
# preferred, once schema-as-code exists:
supabase db push --db-url "$TARGET_DB_URL"
# fallback: structure only (no rows), public + analytics:
pg_dump "$SOURCE_DB_URL" --schema-only --schema=public --schema=analytics > schema.sql
psql "$TARGET_DB_URL" -f schema.sql
```

**4.2 Migrate auth users FIRST** (FK dependency). Dump only the user-facing auth tables (skip
sessions/refresh tokens/audit):
```bash
pg_dump "$SOURCE_DB_URL" --data-only \
  --table=auth.users --table=auth.identities > auth_data.sql
psql "$TARGET_DB_URL" -f auth_data.sql
# verify:
psql "$TARGET_DB_URL" -c "select count(*) from auth.users;"
```
> Password hashes carry over, so users keep their passwords. If the org's policy forbids moving the
> `auth` schema directly, the fallback is a password-reset flow for all users (worse UX) — prefer the
> dump. Coordinate with Supabase support for large/edge cases.

**4.3 Migrate the source-of-truth blobs** (now that `auth.users` exists):
```bash
pg_dump "$SOURCE_DB_URL" --data-only --table=public.daily_rep_state > blobs.sql
psql "$TARGET_DB_URL" -f blobs.sql
psql "$TARGET_DB_URL" -c "select count(*) from public.daily_rep_state;"  # match source
```
The `daily_rep_state_guard_monotonic` trigger is a no-op on a fresh INSERT (no prior row to compare),
so the dump restores cleanly.

**4.4 Seed reference data** — `public.plans` (32) + `public.exercise_facts`: re-run the app's seed
against the target (or `pg_dump --data-only --table=public.plans --table=public.exercise_facts`).

**4.5 Rebuild the analytics projection from the blobs** (do NOT copy analytics rows):
```sql
select analytics.backfill_projection();
select analytics.refresh_cohorts_hourly();
select analytics.refresh_cohorts_nightly();
```

**4.6 Re-create the `pg_cron` jobs** (they live in the `cron` schema, not in a public dump). Match the
source schedule (all UTC):
```sql
select cron.schedule('drain_reconcile',   '* * * * *',    $$select analytics.drain_reconcile_queue(200);$$);
select cron.schedule('sweep_partial',     '*/15 * * * *', $$select analytics.sweep_stale(500, false);$$);
select cron.schedule('sweep_full',        '0 8 * * *',    $$select analytics.sweep_stale(100000, true);$$);
select cron.schedule('cohorts_hourly',    '0 * * * *',    $$select analytics.refresh_cohorts_hourly();$$);
select cron.schedule('cohorts_nightly',   '30 8 * * *',   $$select analytics.refresh_cohorts_nightly();$$);
select jobid, schedule, command, active from cron.job order by jobid;  -- expect 5, active
```

**4.7 Re-deploy the `delete-account` Edge Function** to the target (`verify_jwt=true`; it uses the
target's service-role key automatically). Confirm it's ACTIVE.

**4.8 Re-apply dashboard security settings** on the target (none migrate): min password length = 8 +
**leaked-password (HIBP) protection** ON; **CAPTCHA = Turnstile** ON + the Turnstile secret; **PITR**
enabled (see [runbook-backup-restore.md](runbook-backup-restore.md) §3). Set the same auth rate limits.

---

## 5. Cutover

1. Briefly set the old project read-only (or announce the window). Offline-first clients keep working
   locally; their pushes resume against the new project post-cutover.
2. Update the app env to the **target** `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   (Vercel/host env + `.env.local`) and **redeploy**. The build fail-fasts if either is missing
   (`src/lib/supabase.ts`).
3. Also set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` if CAPTCHA is on (matches §4.8 secret).
4. Run §6. Keep the old project intact (read-only) for a rollback window (e.g. 1–2 weeks).

> Client impact: the Supabase session lives in `localStorage['daily-rep-sb-auth']` and is tied to the
> project. After cutover, existing sessions on the OLD project won't validate against the new one →
> users are prompted to sign in again (passwords preserved via §4.2). Communicate this.

---

## 6. Post-migration verification

```sql
-- counts match the source snapshot:
select (select count(*) from auth.users)            as users,
       (select count(*) from public.daily_rep_state) as blobs,
       (select count(*) from public.plans)           as plans,        -- 32
       (select count(*) from public.analytics_sessions) as sessions;  -- > 0 after backfill

-- projection consistency (any projectable blob with zero sessions ⇒ reconcile_user(uid)):
select s.user_id, jsonb_array_length(s.data->'workouts') as blob_workouts,
       count(a.session_id) as projected
from public.daily_rep_state s
left join public.analytics_sessions a on a.user_id = s.user_id
group by s.user_id, blob_workouts
having jsonb_array_length(s.data->'workouts') > 0 and count(a.session_id) = 0;

-- RLS enabled on user tables; 5 cron jobs active; delete-account function deployed.
select relname, relrowsecurity from pg_class where relname in ('daily_rep_state','analytics_sessions');
select count(*) from cron.job where active;  -- 5
```

App smoke test against the new project: sign in as a representative (non-mock) user → history +
Progress charts render → complete one set → a new `analytics_session_sets` row appears within ~2 min
(the drain cadence). Then test account creation + deletion on a THROWAWAY user (never the mock
account).

---

## 7. Rollback

If verification fails: revert the app env to the old project URL/anon key + redeploy (the old project
was kept read-only, so it still holds the pre-cutover state). Investigate, then re-attempt. Only
decommission the old project after the rollback window passes clean.

---

## 8. `[HUMAN]` checklist (the parts only a human can do)

- [ ] Commit schema-as-code first (`supabase db pull` → `supabase/migrations/`) so §4.1 is reproducible.
- [ ] Provision the dedicated project + enable extensions (§3).
- [ ] Run the `pg_dump`/`psql` auth + blob migration (§4.2–4.3).
- [ ] Re-create cron jobs (§4.6) + re-deploy `delete-account` (§4.7).
- [ ] Re-apply dashboard security (HIBP, CAPTCHA + keys, PITR, min-length, rate limits) (§4.8).
- [ ] Cutover env + redeploy (§5); verify (§6); keep old project for rollback (§7).
