# Session-analytics layer — build plan & status

Adds a queryable, **set-level** analytics projection over the offline-first JSONB blob so we can do
per-user metrics + cross-user/cohort analysis. Decided + designed via a multi-round architect workflow
(propose → draft → 5-adversary red-team (37 issues) → finalize). **Full buildable spec:**
`docs/sessions-analytics-spec.json` (the source of truth for the exact DDL/SQL of every remaining piece).

## Architecture (one-paragraph)
The blob (`public.daily_rep_state.data.workouts[]`) stays the **offline-first source of truth**. A
normalized **projection** — `public.analytics_sessions` (per completed Workout) + `public.analytics_session_sets`
(per LoggedSet) + `public.analytics_profile` + `public.exercise_facts` — is a deterministic, eventually-
consistent **function of the blob, derived ENTIRELY server-side** (client dual-write was rejected). A trigger
on `daily_rep_state` enqueues the user; pg_cron drain(1m)/sweep(15m)/nightly call SECURITY DEFINER
`analytics.reconcile_user(uid)`, which sanitizes the blob (mirrors client sanitizeWorkout), diffs each
completed session by a canonical **fingerprint**, re-explodes only changed sessions, and deletes absent ones.
**Correctness floor = watermark vs sweep** (the queue/cron is just latency) and the watermark is the SERVER
`updated_at` (skew-proof), NOT client_updated_at. Math (effectiveLoad bw*0.65 inner-round, Epley e1RM,
unrounded-kg) is computed once in plpgsql and stored in display+kg columns so views are pure SUM/MAX.
Per-user reads via security_invoker views with their own auth.uid() filter; cohort metrics are private
matviews surfaced only via K-anonymized SECURITY DEFINER RPCs. All SECURITY DEFINER fns use
`search_path = pg_catalog,pg_temp` + schema-qualified names.

## Build stages (rollout order from the spec)
- [x] **Stage 1 — foundation** (migrations `analytics_a_schema_bookkeeping`, `analytics_b_projection_tables`):
  analytics schema + meta/reconcile_queue/user_watermark + reconcile_result type; the 4 public tables +
  6 indexes + RLS(FORCE)+SELECT-only grants; `exercise_facts` seeded mechanically from the catalogue
  (53 rows, derived: is_bodyweight_lift = equipment∋bodyweight && category∈{compound,isolation};
  regions = distinct MUSCLES[primary].region). Verified: tsc, tests, advisors clean.
- [x] **Stage 2 — extractor** (migrations `analytics_c1_math_helpers`, `analytics_c2_extractor`):
  `effective_weight` (round(bw*0.65)+weight), `to_kg` (/2.20462), `is_projectable`, `epley_1rm`
  (mirrors estimate1RM: integer, reps=1 passthrough, zero guard), `reconcile_user` (sanitize → ordered
  fingerprint → explode sets via lateral jsonb + exercise_facts join → upsert/skip-on-fingerprint →
  delete-absent → monotonic SERVER-updated_at watermark; never reads data->'current'), and
  `backfill_projection`. All SECURITY DEFINER + search_path pinned + EXECUTE revoked from
  public/anon/authenticated, granted to service_role. (Helpers `canonical_fingerprint`/`_explode_sets`
  inlined into reconcile_user — same behaviour, fewer moving parts.) NOT YET: drain/sweep/enqueue (Stage 4).
- [x] **Stage 3 — backfill + MATH VERIFICATION** (the critical gate — PASSED): seeded a known session
  (straight sets + weighted bodyweight lift + a warmup) into the mock blob, ran reconcile_user, and every
  projected value was BIT-EXACT to stats.ts: working_volume 3018, sets/reps/exc 4/28/2, bench eff/vol/e1rm
  100/500/117, pushup eff/e1rm 101/135 & 160, warmup vol 0 / is_working false, regions {push}. Then emptied
  the blob → reconcile → delete-absent cleared sessions+sets to 0 (cascade) with watermark 'ok'. Mock blob
  restored to its real empty state. `backfill_projection()` runs (1 user). Security advisors clean.
- [x] **Stage 4 — automation** (migrations `analytics_d_automation_drain_sweep_trigger`,
  `analytics_d2_pg_cron_schedule`): `analytics.drain_reconcile_queue(limit)` (dequeue→reconcile→delete,
  per-user `pg_try_advisory_xact_lock` to serialize drain-vs-sweep without blocking the live push, errors
  recorded on the watermark + row kept queued) + `analytics.sweep_stale(limit, full)` (the correctness
  floor: reconcile any user whose SERVER `updated_at` > watermark; `full` ignores the watermark for nightly
  self-heal), both SECURITY DEFINER + search_path pinned + service_role-only. Enqueue trigger
  `analytics.tg_enqueue_reconcile` (SECURITY DEFINER — the client has no write on analytics.*) on
  `daily_rep_state`: AFTER INSERT (unconditional) + AFTER UPDATE `WHEN (new.data->'workouts' IS DISTINCT
  FROM old.data->'workouts')`. **Verified** the BEFORE guard (`daily_rep_guard_monotonic` does
  `NEW.data := OLD.data` on a stale push) runs before the AFTER enqueue evaluates, so: TEST1 real
  workouts-change → 1 enqueue; TEST2 stale push (older clock) → **0 enqueue** + stale data did not stick;
  TEST3 drain reconciles + empties queue. `pg_cron` 1.6.4 installed; cron jobs: `analytics-drain` `* * * * *`,
  `analytics-sweep` `*/15 * * * *`, `analytics-nightly-full` `0 8 * * *` (all active). `cron` schema not
  granted to anon/authenticated. Manual `sweep_stale(_,true)`=1 / `(_,false)`=0 (watermark gating works).
  Advisors clean (only pre-existing leaked-password auth WARN).
- [x] **Stage 5 — query layer** (migrations `analytics_e1_per_user_views_and_rpc`,
  `analytics_e2_cohort_matviews`, `analytics_e3_cohort_refresh_and_cron`): 5 per-user
  `security_invoker=true` views — `v_my_session_volume`, `v_my_exercise_e1rm`, `v_my_exercise_prs`
  (first-ever session not flagged), `v_my_region_volume` (sets table has no `local_week` → derived inline
  from `performed_on` with the SAME `floor((localDay+3)/7)`), `v_my_adherence` — each with its own
  `(select auth.uid()) = user_id` filter + SELECT granted to `authenticated` only (anon/public revoked).
  `my_weekly_streak()` (SECURITY INVOKER, `WITH RECURSIVE`, `cur` week uses the same grid as
  `local_week`). Private cohort matviews in the `analytics` schema (no client USAGE): `cohort_dau`,
  `cohort_weekly`, `cohort_retention`, `popular_exercises`, `popular_plans` (added — `analytics_sessions`
  carries `plan_id`), each unique-indexed; refreshed by `analytics.refresh_cohorts_hourly()` (dau, `0 * * * *`)
  / `analytics.refresh_cohorts_nightly()` (rest, `30 8 * * *` after the 08:00 full sweep) via `REFRESH …
  CONCURRENTLY` (SECURITY DEFINER, service_role-only). Client-facing cohort RPC
  `public.my_volume_percentile()` (SECURITY DEFINER, no params → no IDOR, `auth.uid()` filter, K=20 anon
  floor → cohort_p50 NULL below 20 users, never returns a user_id). **Verified** (seeded today-session,
  reconcile=1/4/0): under the mock JWT every view bit-exact — session vol 3018, 4 sets/28 reps, e1rm rows 2
  (max 160), region `push`/4, streak 1, `cohort_n=1`/`cohort_p50=NULL` (K-anon), my_vol 1369.0 kg; **RLS
  isolation** a different uid sees 0 everywhere + own my_vol NULL; matviews refresh; advisors: only the
  intentional `my_volume_percentile` definer WARN (by design) + pre-existing leaked-password WARN.
- [x] **Stage 6 — client stamp** (`src/types.ts`, `src/store/useStore.ts`): ONE additive change —
  `Workout` gains optional `performed_on?: string` + `tzOffsetMin?: number`; `finishWorkout` stamps the
  local `YYYY-MM-DD` day (zero-padded) + `new Date(completedAt).getTimezoneOffset()`. Rides the existing
  blob push; `reconcile_user` reads `tzOffsetMin` (→ `day_is_estimated=false`), old blobs keep the UTC
  fallback. tsc clean; store regression test asserts the runtime stamp + format; live app renders, no new
  console errors.
- [x] **Stage 7 — tests + advisors**: `src/__tests__/analytics-facts.test.ts` locks the
  `exercise_facts`↔`stats.ts` contract (count==53; `is_bodyweight_lift` probed non-circularly via the real
  `effectiveLoad`; regions deduped subset of {push,pull,legs,core}; pushup/bench/deadlift anchors). RLS
  isolation verified live (different uid → 0 rows, own cohort number NULL). `get_advisors(security)` clean
  apart from the intentional `my_volume_percentile` definer WARN (by design) + pre-existing leaked-password
  WARN. Suite: 262 tests green.

## Open risks (from the spec — flagged, NOT blocking the analytics layer)
- LWW blob guard is unsound under client clock skew (pre-existing; the projection no longer amplifies it
  because watermark = server updated_at). Flag to product owner.
- `performed_on`/`tzOffsetMin` are client-controlled → a client could backdate its OWN cohort contribution
  (mitigated by day_is_estimated exclusion + K-anon; full fix = anchor cohort time on server updated_at).
- *_kg columns inherit bounded gym-rounding drift across unit toggles (≤1 step; blob is deliberately lossy).
- pg_cron 1.6.4 now installed (jobs: analytics-drain 1m, analytics-sweep 15m, analytics-nightly-full 08:00,
  analytics-cohort-hourly :00, analytics-cohort-nightly 08:30). reconcile_queue stays a plain table.

## STATUS: ✅ ALL STAGES COMPLETE (1–7) — the set-level analytics layer is built, deployed, and verified.
Offline-first preserved (blob is still the source of truth; projection is a server-derived, eventually-
consistent CQRS read model). Next, when product wants charts: wire the per-user views/RPC into the client
(read-only) — no further schema work required. Future additive: anchor cohort time on server `updated_at`
(see backdating risk above), a `plan_id` popularity surface is already live via `analytics.popular_plans`.
