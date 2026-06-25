# Runbook — Backup & Restore (Daily Rep)

> Operational runbook for backing up and recovering Daily Rep's Supabase data. Written for an
> on-call operator. Object names below were introspected from the live project on 2026-06-24 and
> should be re-verified after any schema migration.
>
> **Project:** `aswwhsxubqyzbrfoptoq` (⚠️ currently SHARED with an unrelated app — see
> [runbook-dedicated-project.md](runbook-dedicated-project.md) / the production checklist; a
> dedicated project is a launch blocker because a restore here affects both apps).

---

## 1. What needs backing up (and what doesn't)

Daily Rep is **offline-first**. The authoritative copy of a user's training data is a single JSONB
**blob**, mirrored in three places — losing any one is survivable:

| Layer | Where | Role |
|---|---|---|
| Device | `localStorage['daily-rep-v1']` (Zustand persist) | Instant source of truth on the device |
| Cloud (source of truth, server-side) | `public.daily_rep_state.data` (one row per user, RLS + monotonic-clock guard) | The blob to back up / restore |
| Derived projection | `public.analytics_sessions`, `analytics_session_sets`, `analytics_profile` (+ `analytics` schema bookkeeping) | **Rebuildable** from the blob — NOT a backup concern |

**Key property:** the analytics tables and the `v_my_*` views are a pure **projection** of
`daily_rep_state.data`. They can always be rebuilt from the blobs (§5.3). So a complete logical
backup of Daily Rep is just: **every `daily_rep_state` row** + the `auth.users` rows they reference.

Reference / non-user data that lives only server-side and is restored from migrations + seed, not
from user backups: `public.plans` (32 seeded program templates), `public.exercise_facts`
(exercise catalogue regions/bodyweight flags).

---

## 2. Backup mechanisms

1. **Supabase automatic backups** — daily logical backups are taken automatically on the project's
   plan. These are the baseline. Retention depends on the plan tier.
2. **Point-in-Time Recovery (PITR)** — `[HUMAN]` **must be enabled** (Pro plan add-on). Gives
   second-granular restore to any moment in the retention window, vs. only the last daily snapshot.
   This is the launch-blocking item — see §3.
3. **Per-user self-service export** — every user can download their full data as JSON from
   Settings → "Download my data" (`src/lib/dataExport.ts`). This doubles as a user-initiated backup
   and is the fastest single-user restore source when PITR isn't granular enough (§5.1).
4. **The device copy** — if the cloud row is lost but the user still has the app installed, their
   `localStorage` blob re-pushes to the cloud on next sign-in (sync reconcile in `src/lib/sync.ts`).

### RPO / RTO targets

| | Without PITR (daily backup only) | With PITR (target — enable it) |
|---|---|---|
| **RPO** (max data loss) | up to ~24 h | ≤ 2 min (the cron drain cadence) |
| **RTO** (time to restore) | single user: minutes (§5.1); full project: ~tens of minutes (Supabase restore) | same |

---

## 3. `[HUMAN]` — Enable & verify PITR (launch blocker)

Cannot be done from app code / MCP — requires the Supabase dashboard:

1. Dashboard → Project `aswwhsxubqyzbrfoptoq` → **Database → Backups → Point in Time**.
2. Ensure the project is on a plan that includes PITR; enable it and choose a retention window
   (recommend ≥ 7 days).
3. **Verify** after ~1 day: the Backups page shows a continuous PITR window with a recent
   "earliest restore point", and the WAL/physical backup status is healthy.
4. Document the chosen retention window here once set: _retention = __ days (fill in)._

Until PITR is on, the effective RPO is the daily-backup interval — call that out in the launch
go/no-go.

---

## 4. Monitoring — what runs automatically

`pg_cron` jobs keep the projection fresh (introspected 2026-06-24, all UTC):

| jobid | Schedule | Command | Purpose |
|---|---|---|---|
| 1 | `* * * * *` (every min) | `analytics.drain_reconcile_queue(200)` | Apply queued per-user reconciles (drives the ≤2 min RPO for the projection) |
| 2 | `*/15 * * * *` | `analytics.sweep_stale(500, false)` | Incremental stale-projection sweep |
| 3 | `0 8 * * *` | `analytics.sweep_stale(100000, true)` | Nightly full stale sweep |
| 4 | `0 * * * *` | `analytics.refresh_cohorts_hourly()` | Hourly k-anon cohort refresh (percentiles) |
| 5 | `30 8 * * *` | `analytics.refresh_cohorts_nightly()` | Nightly cohort refresh |

Health check (queue should hover near 0; a growing backlog means the drain job is stuck):

```sql
select count(*) as pending from analytics.reconcile_queue;          -- expect small / 0
select jobid, jobname, schedule, active from cron.job order by jobid; -- all active = true
-- recent failures:
select jobid, status, return_message, start_time
from cron.job_run_details where status <> 'succeeded'
order by start_time desc limit 20;
```

---

## 5. Restore procedures

> Golden rule: **`daily_rep_state` is the only user data you must recover.** Once the correct blob
> is back in place, the analytics projection is rebuilt deterministically (§5.3) — never hand-edit
> the analytics tables.

### 5.1 Single user — bad/lost blob (most common)

Symptoms: a user reports lost or corrupted history; their `daily_rep_state.data` is wrong/empty.

**Option A — restore from the user's own export (fastest, no PITR needed).** If the user has a
"Download my data" JSON (§2.3), reconstruct the persist blob from its `profile`/`workouts`/
`customPlans`/`activePlan`/`planProgress` fields and write it back. ⚠️ The **monotonic-clock guard**
(`daily_rep_state_guard_monotonic` trigger → `public.daily_rep_guard_monotonic`) reverts any push
whose `client_updated_at` is **older** than the stored value. So set `client_updated_at` to **now()
or newer** on the restore write, e.g.:

```sql
update public.daily_rep_state
set data = $1::jsonb,                       -- the reconstructed blob
    client_updated_at = now()               -- newer than stored, or the guard reverts it
where user_id = $2;
select analytics.reconcile_user($2);        -- rebuild this user's projection from the new blob
```

**Option B — restore one row from PITR.** Spin up a PITR restore (§5.2) to just before the loss,
read that user's `data` + `client_updated_at` from the restored copy, then apply it with Option A's
`update` (bumping `client_updated_at` to now()). Always finish with `analytics.reconcile_user(uid)`.

After either: confirm the device re-syncs — on the user's next sign-in, `sync.ts` pulls the cloud
row; if their local copy is newer it re-pushes (last-write-wins by the logical clock).

### 5.2 Full project restore (PITR)

For broad corruption / accidental mass delete / bad migration:

1. Dashboard → Database → Backups → **Point in Time** → pick the timestamp just **before** the
   incident. Supabase provisions a restored database (often a new project/branch).
2. Decide scope:
   - **Whole-project rollback** acceptable → restore in place (⚠️ shared project: this also rolls
     back the co-tenant app — coordinate; this is exactly why the dedicated-project blocker exists).
   - **Surgical** → restore to a **separate** target, then copy only the needed `daily_rep_state`
     rows back into prod (per §5.1 Option A, bumping `client_updated_at`).
3. Post-restore verification (§6), then **rebuild the projection** (§5.3).
4. Confirm the 5 `pg_cron` jobs are present + `active` (§4) — re-create them if the restore dropped
   the schedule.

### 5.3 Rebuild the analytics projection (no user-data loss)

The projection is derived, so it's always safe to rebuild from the blobs — do this after any restore,
or if the projection drifts from the blobs:

```sql
-- Whole-population rebuild (idempotent; reprojects every projectable blob):
select analytics.backfill_projection();

-- Or just one user (after a single-user restore):
select analytics.reconcile_user('<user-uuid>');
```

Then force-refresh the cohort aggregates so percentiles reflect the rebuilt rows:

```sql
select analytics.refresh_cohorts_hourly();
select analytics.refresh_cohorts_nightly();
```

### 5.4 Accidental account deletion

Account deletion (`delete-account` Edge Function → `public.purge_user_data(uid)` →
`auth.admin.deleteUser`) is **irreversible by design** (GDPR Art.17 erasure): it removes the blob,
the analytics rows, and the auth user. The FK `daily_rep_state_user_id_fkey` is `ON DELETE CASCADE`,
so deleting the auth user also drops the blob. **The only recovery is PITR** (§5.2) to a point before
the deletion — another reason PITR is launch-blocking. Do NOT attempt to "recreate" the user with the
same email to recover; that produces a new `auth.users.id` and the old rows won't reattach.

---

## 6. Post-restore verification checklist

```sql
-- Row counts sane (compare to pre-incident baseline if known):
select count(*) as users from public.daily_rep_state;
select count(*) as plans from public.plans;          -- expect 32 seeded
select count(*) as sessions from public.analytics_sessions;

-- Projection consistency: every projectable blob should have produced sessions.
-- A user with workouts in the blob but zero analytics_sessions rows ⇒ run reconcile_user(uid).
select s.user_id, jsonb_array_length(s.data->'workouts') as blob_workouts,
       count(a.session_id) as projected_sessions
from public.daily_rep_state s
left join public.analytics_sessions a on a.user_id = s.user_id
group by s.user_id, blob_workouts
having jsonb_array_length(s.data->'workouts') > 0 and count(a.session_id) = 0;

-- Guard + touch triggers present on daily_rep_state:
select tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid
where c.relname='daily_rep_state' and not t.tgisinternal;
-- expect: daily_rep_state_guard_monotonic, daily_rep_state_touch,
--         daily_rep_state_enqueue_ins, daily_rep_state_enqueue_upd

-- Cron jobs active (§4): expect 5 rows, all active.
select count(*) from cron.job where active;
```

Then a smoke test through the app: sign in as a representative (non-mock) user, confirm history +
Progress charts render, and complete one set → confirm a new `analytics_session_sets` row appears
within ~2 min (the drain cadence).

---

## 7. Key objects (quick reference, introspected 2026-06-24)

- **Source-of-truth table:** `public.daily_rep_state(user_id, data jsonb, client_updated_at, schema_version, …)`; FK → `auth.users` `ON DELETE CASCADE`.
- **Guard:** `public.daily_rep_guard_monotonic()` via trigger `daily_rep_state_guard_monotonic` — reverts stale (older-clock) pushes. Always bump `client_updated_at` on a manual restore write.
- **Projection rebuild:** `analytics.backfill_projection()` (all users) · `analytics.reconcile_user(uuid)` (one user).
- **Queue/sweep:** `analytics.drain_reconcile_queue(int)`, `analytics.sweep_stale(int, bool)`; enqueue triggers `daily_rep_state_enqueue_ins`/`_upd` → `analytics.tg_enqueue_reconcile()`.
- **Cohorts:** `analytics.refresh_cohorts_hourly()` / `refresh_cohorts_nightly()`.
- **Erasure (GDPR):** `public.purge_user_data(uuid)` + Edge Function `delete-account` (irreversible).
- **Self-service export (GDPR portability):** Settings → "Download my data" (`src/lib/dataExport.ts`).

> ⚠️ This runbook references object names that live only in the remote DB (no `supabase/migrations/`
> in the repo yet — schema-as-code is a separate `[HUMAN]`/CLI item). Re-introspect (the queries in
> §6/§4) after any migration and update this file.
