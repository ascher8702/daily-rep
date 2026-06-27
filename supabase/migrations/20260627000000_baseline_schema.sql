-- ============================================================================
-- Daily Rep — consolidated baseline schema (squash of the prior 28 migrations).
-- Single forward migration that builds the full schema on a clean project:
--   daily_rep_state (+ entitlement RLS, monotonic guard), plans, subscriptions
--   (+ trial trigger), trial_ledger, analytics schema + projection pipeline +
--   pg_cron jobs, per-user views, purge_user_data, and the 55-row exercise_facts seed.
-- The original granular migrations are preserved in supabase/migrations/archive/.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 20260624002011_rename_state_table_to_daily_rep
-- ---------------------------------------------------------------------------
-- Rename the cloud state store to match the app's new name "Daily Rep".
-- Per the user, existing state need not be preserved (table has 0 rows), so we recreate cleanly with
-- consistent daily_rep_* naming and ALL 2026-06-23 hardening (client_updated_at default, object CHECK,
-- authenticated-scoped RLS, touch trigger, column docs) baked in.


CREATE TABLE IF NOT EXISTS public.daily_rep_state (
  user_id           uuid        NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  client_updated_at timestamptz DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  schema_version    integer     NOT NULL DEFAULT 1,
  CONSTRAINT daily_rep_state_data_is_object CHECK (jsonb_typeof(data) = 'object')
);

CREATE OR REPLACE FUNCTION public.daily_rep_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  new.updated_at = now();
  return new;
END;
$$;

DROP TRIGGER IF EXISTS daily_rep_state_touch ON public.daily_rep_state;
CREATE TRIGGER daily_rep_state_touch
  BEFORE UPDATE ON public.daily_rep_state
  FOR EACH ROW EXECUTE FUNCTION public.daily_rep_touch_updated_at();

ALTER TABLE public.daily_rep_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_rep_state_select_own ON public.daily_rep_state;
CREATE POLICY daily_rep_state_select_own ON public.daily_rep_state
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS daily_rep_state_insert_own ON public.daily_rep_state;
CREATE POLICY daily_rep_state_insert_own ON public.daily_rep_state
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS daily_rep_state_update_own ON public.daily_rep_state;
CREATE POLICY daily_rep_state_update_own ON public.daily_rep_state
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS daily_rep_state_delete_own ON public.daily_rep_state;
CREATE POLICY daily_rep_state_delete_own ON public.daily_rep_state
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

COMMENT ON COLUMN public.daily_rep_state.user_id IS
  'PK and FK -> auth.users(id) ON DELETE CASCADE. RLS scopes every row to (SELECT auth.uid()) = user_id. Deleting the auth user erases this row automatically (GDPR right-to-erasure for cloud data); on-device localStorage (daily-rep-v1) is NOT covered and must be cleared client-side.';
COMMENT ON COLUMN public.daily_rep_state.data IS
  'Mirror of the partialized Zustand store (localStorage key daily-rep-v1): profile, workouts[], current session, activePlan, customPlans, planProgress, planOverrides, units. Last-write-wins; client is source of truth. Unbounded JSONB; must be a JSON object (enforced by daily_rep_state_data_is_object).';
COMMENT ON COLUMN public.daily_rep_state.client_updated_at IS
  'Client LWW logical clock (new Date().toISOString()) set by sync.ts pushNow(). pullAndReconcile() adopts cloud only when this is strictly newer than the local clock; a NULL value is treated as time 0. DEFAULT now() backstops out-of-band writes.';
COMMENT ON COLUMN public.daily_rep_state.updated_at IS
  'Server clock maintained by trigger daily_rep_state_touch (BEFORE UPDATE -> daily_rep_touch_updated_at, sets now()). Observability only; do NOT use for reconciliation — use client_updated_at.';
COMMENT ON COLUMN public.daily_rep_state.created_at IS
  'Server insert time (DEFAULT now()).';
COMMENT ON COLUMN public.daily_rep_state.schema_version IS
  'Reserved blob-shape version for forward-compat. The client does NOT read or write this (sync.ts sends only data + client_updated_at); it always stays at DEFAULT 1. Distinct from the Zustand persist version in useStore.ts.';

-- ---------------------------------------------------------------------------
-- 20260624022534_create_plans_table
-- ---------------------------------------------------------------------------
-- DB-managed workout plans: an OPTIONAL overlay on the app's bundled catalogue. Rows here add new
-- plans or override a bundled plan by id, without a code deploy. The app is offline-first: the bundled
-- catalogue always ships in-app, so an empty table / offline simply means "bundled only".
CREATE TABLE IF NOT EXISTS public.plans (
  id          text        PRIMARY KEY,
  data        jsonb       NOT NULL,
  sort        integer     NOT NULL DEFAULT 0,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plans_data_is_object CHECK (jsonb_typeof(data) = 'object'),
  CONSTRAINT plans_data_id_matches CHECK (data->>'id' = id)
);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

-- Public catalogue: read-only for everyone (anon + signed-in). No write policies → RLS denies all
-- client writes; plans are managed via the dashboard / service-role (which bypasses RLS).
DROP POLICY IF EXISTS plans_read_all ON public.plans;
DROP POLICY IF EXISTS plans_read_all ON public.plans;
CREATE POLICY plans_read_all ON public.plans
  FOR SELECT TO anon, authenticated
  USING (true);

-- keep updated_at fresh on edits (reuse the same trigger fn style as daily_rep_state)
CREATE OR REPLACE FUNCTION public.plans_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  new.updated_at = now();
  return new;
END;
$$;

DROP TRIGGER IF EXISTS plans_touch ON public.plans;
CREATE TRIGGER plans_touch BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.plans_touch_updated_at();

COMMENT ON TABLE public.plans IS 'Optional DB-managed workout plans overlaying the app bundled catalogue by id (add or override without a deploy). Public-read; writes via dashboard/service-role only. The app ships the bundled catalogue, so this can be empty.';

-- ---------------------------------------------------------------------------
-- 20260624030143_daily_rep_state_monotonic_guard
-- ---------------------------------------------------------------------------
-- Multi-device data-safety: reject a STALE update (one whose client clock is not strictly newer than
-- the stored one) by reverting the mutable columns to OLD — a no-op merge instead of clobbering newer
-- cloud data with a backward-skewed / replayed write. Pairs with the client's pull-on-visibility so a
-- refocused tab refetches the newer state before it next edits. NULL clocks are treated as oldest.
CREATE OR REPLACE FUNCTION public.daily_rep_guard_monotonic()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF COALESCE(NEW.client_updated_at, 'epoch'::timestamptz)
     <= COALESCE(OLD.client_updated_at, 'epoch'::timestamptz) THEN
    NEW.data := OLD.data;
    NEW.client_updated_at := OLD.client_updated_at;
    NEW.schema_version := OLD.schema_version;
  END IF;
  RETURN NEW;
END;
$$;

-- BEFORE-ROW triggers fire alphabetically: 'guard_monotonic' < 'touch', so the guard decides the data,
-- then the existing touch trigger stamps updated_at — order is harmless either way.
DROP TRIGGER IF EXISTS daily_rep_state_guard_monotonic ON public.daily_rep_state;
CREATE TRIGGER daily_rep_state_guard_monotonic
  BEFORE UPDATE ON public.daily_rep_state
  FOR EACH ROW EXECUTE FUNCTION public.daily_rep_guard_monotonic();

-- ---------------------------------------------------------------------------
-- 20260624042145_analytics_a_schema_bookkeeping
-- ---------------------------------------------------------------------------
-- Migration A: private analytics schema + bookkeeping (queue, watermark, meta) for the session-analytics
-- projection. Cohort matviews/rollups will live here later; no client USAGE so matviews are protected by
-- schema-USAGE denial alone. (Per the multi-round design; correctness floor = watermark vs sweep.)
CREATE SCHEMA IF NOT EXISTS analytics AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA analytics FROM PUBLIC;
GRANT USAGE ON SCHEMA analytics TO service_role;

CREATE TABLE IF NOT EXISTS analytics.meta (
  id             smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  schema_version integer  NOT NULL DEFAULT 1,   -- bump on formula change OR exercise_facts reseed → re-derive all
  facts_version  integer  NOT NULL DEFAULT 1
);
INSERT INTO analytics.meta (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS analytics.reconcile_queue (
  user_id     uuid PRIMARY KEY,
  enqueued_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS queue_enqueued_idx ON analytics.reconcile_queue (enqueued_at);

CREATE TABLE IF NOT EXISTS analytics.user_watermark (
  user_id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_blob_updated_at timestamptz,   -- SERVER daily_rep_state.updated_at last reconciled (monotonic, skew-proof)
  last_reconciled_at   timestamptz,
  last_status          text,          -- ok | error | suspect_empty
  last_error           text,
  retry_count          integer NOT NULL DEFAULT 0
);

REVOKE ALL ON ALL TABLES IN SCHEMA analytics FROM anon, authenticated;

DO $do_rr$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
                 WHERE n.nspname='analytics' AND t.typname='reconcile_result') THEN
    CREATE TYPE analytics.reconcile_result AS (sessions int, sets int, deleted int);
  END IF;
END $do_rr$;

-- ---------------------------------------------------------------------------
-- 20260624042226_analytics_b_projection_tables
-- ---------------------------------------------------------------------------
-- Migration B: the set-level projection tables. RLS+FORCE, client SELECT-only, REVOKE in the SAME
-- migration as CREATE to neutralize the public default-ACL auto-grant. Rows enter ONLY via the
-- SECURITY DEFINER extractor (next migration), so client write-forgery is structurally impossible.

-- catalogue-derived facts (is_bodyweight_lift, regions) — seeded mechanically; client write forbidden
CREATE TABLE IF NOT EXISTS public.exercise_facts (
  exercise_id        text PRIMARY KEY,
  is_bodyweight_lift boolean NOT NULL DEFAULT false,
  regions            text[]  NOT NULL DEFAULT '{}'
);
ALTER TABLE public.exercise_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_facts FORCE  ROW LEVEL SECURITY;
REVOKE ALL    ON public.exercise_facts FROM anon, authenticated;
GRANT  SELECT ON public.exercise_facts TO authenticated;
DROP POLICY IF EXISTS exercise_facts_read ON public.exercise_facts;
CREATE POLICY exercise_facts_read ON public.exercise_facts FOR SELECT TO authenticated USING (true);

-- grain = one COMPLETED Workout; pre-aggregated working totals
CREATE TABLE IF NOT EXISTS public.analytics_sessions (
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id        text        NOT NULL,
  performed_at      timestamptz NOT NULL,
  performed_on      date        NOT NULL,
  local_week        integer     NOT NULL,
  day_is_estimated  boolean     NOT NULL DEFAULT false,
  started_at        timestamptz,
  completed_at      timestamptz,
  title             text        NOT NULL DEFAULT '',
  unit              text        NOT NULL CHECK (unit IN ('lb','kg')),
  bodyweight        numeric(7,2),
  bodyweight_kg     numeric(7,2),
  duration_min      integer,
  focus             text[]      NOT NULL DEFAULT '{}',
  gen_focus         text[],
  plan_id           text,
  plan_day_label    text,
  working_volume    numeric(14,2) NOT NULL DEFAULT 0,
  working_volume_kg numeric(14,2) NOT NULL DEFAULT 0,
  working_set_count integer       NOT NULL DEFAULT 0,
  working_rep_count integer       NOT NULL DEFAULT 0,
  exercise_count    integer       NOT NULL DEFAULT 0,
  fingerprint       text        NOT NULL,
  blob_updated_at   timestamptz NOT NULL,
  schema_version    integer     NOT NULL DEFAULT 1,
  projected_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, session_id)
);
ALTER TABLE public.analytics_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_sessions FORCE  ROW LEVEL SECURITY;
REVOKE ALL    ON public.analytics_sessions FROM anon, authenticated;
GRANT  SELECT ON public.analytics_sessions TO authenticated;
DROP POLICY IF EXISTS sess_read ON public.analytics_sessions;
CREATE POLICY sess_read ON public.analytics_sessions FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);

-- grain = one LoggedSet; flattened exercise context + extractor-computed derived columns
CREATE TABLE IF NOT EXISTS public.analytics_session_sets (
  user_id            uuid        NOT NULL,
  session_id         text        NOT NULL,
  set_id             text        NOT NULL,
  performed_at       timestamptz NOT NULL,
  performed_on       date        NOT NULL,
  exercise_id        text        NOT NULL,
  instance_id        text,
  plan_lift_id       text,
  plan_slot          integer,
  superset_group     text,
  exercise_order     integer     NOT NULL DEFAULT 0,
  set_order          integer     NOT NULL DEFAULT 0,
  target_rep_low     integer,
  target_rep_high    integer,
  regions            text[]      NOT NULL DEFAULT '{}',
  is_bodyweight_lift boolean     NOT NULL DEFAULT false,
  unit               text        NOT NULL CHECK (unit IN ('lb','kg')),
  weight             numeric(9,2) NOT NULL DEFAULT 0,
  reps               integer      NOT NULL DEFAULT 0,
  rpe                numeric(3,1),
  done               boolean      NOT NULL DEFAULT false,
  warmup             boolean      NOT NULL DEFAULT false,
  is_working          boolean     GENERATED ALWAYS AS (done AND NOT warmup) STORED,
  effective_weight    numeric(11,2) NOT NULL DEFAULT 0,
  effective_weight_kg numeric(11,2) NOT NULL DEFAULT 0,
  e1rm               numeric(11,2) NOT NULL DEFAULT 0,
  e1rm_kg            numeric(11,2) NOT NULL DEFAULT 0,
  set_volume         numeric(14,2) NOT NULL DEFAULT 0,
  set_volume_kg      numeric(14,2) NOT NULL DEFAULT 0,
  schema_version     integer       NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, session_id, set_id),
  FOREIGN KEY (user_id, session_id) REFERENCES public.analytics_sessions(user_id, session_id) ON DELETE CASCADE
);
ALTER TABLE public.analytics_session_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_session_sets FORCE  ROW LEVEL SECURITY;
REVOKE ALL    ON public.analytics_session_sets FROM anon, authenticated;
GRANT  SELECT ON public.analytics_session_sets TO authenticated;
DROP POLICY IF EXISTS sets_read ON public.analytics_session_sets;
CREATE POLICY sets_read ON public.analytics_session_sets FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);

-- per-user projected profile fields the metric views need (adherence target, unit, bodyweight)
CREATE TABLE IF NOT EXISTS public.analytics_profile (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  unit           text NOT NULL DEFAULT 'lb' CHECK (unit IN ('lb','kg')),
  bodyweight     numeric(7,2),
  days_per_week  integer,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.analytics_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_profile FORCE  ROW LEVEL SECURITY;
REVOKE ALL    ON public.analytics_profile FROM anon, authenticated;
GRANT  SELECT ON public.analytics_profile TO authenticated;
DROP POLICY IF EXISTS profile_read ON public.analytics_profile;
CREATE POLICY profile_read ON public.analytics_profile FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);

-- indexes (the sets table is the one that scales)
CREATE INDEX IF NOT EXISTS sessions_user_time_idx   ON public.analytics_sessions (user_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS sessions_user_week_idx   ON public.analytics_sessions (user_id, local_week);
CREATE INDEX IF NOT EXISTS sessions_plan_idx        ON public.analytics_sessions (plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sets_user_ex_time_idx    ON public.analytics_session_sets (user_id, exercise_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS sets_working_idx         ON public.analytics_session_sets (user_id, performed_at DESC) WHERE is_working;
CREATE INDEX IF NOT EXISTS sets_exercise_cohort_idx ON public.analytics_session_sets (exercise_id) WHERE is_working;

-- ---------------------------------------------------------------------------
-- 20260624042913_analytics_c1_math_helpers
-- ---------------------------------------------------------------------------
-- Stage 2 math primitives — must match src/lib/stats.ts + format.ts exactly.
-- effectiveLoad: bodyweight lifts add round(bw*0.65) (BW_LOAD_FRACTION); else raw external load.
create or replace function analytics.effective_weight(p_is_bw boolean, p_bw numeric, p_weight numeric)
returns numeric language sql immutable set search_path to 'pg_catalog' as
$$ select case when p_is_bw and p_bw > 0 then round(p_bw * 0.65) + p_weight else p_weight end $$;

-- display-unit value -> kg (unrounded), for cross-user aggregation. 1 kg = 2.20462 lb.
create or replace function analytics.to_kg(p_v numeric, p_unit text)
returns numeric language sql immutable set search_path to 'pg_catalog' as
$$ select case when p_unit = 'lb' then p_v / 2.20462 else p_v end $$;

-- mirror the client's sanitizeWorkout gate: only COMPLETED workouts with an id and an exercises array.
create or replace function analytics.is_projectable(w jsonb)
returns boolean language sql immutable set search_path to 'pg_catalog' as
$$ select w->>'status' = 'completed' and coalesce(w->>'id','') <> '' and jsonb_typeof(w->'exercises') = 'array' $$;

-- math sanity (returned by this migration via a trailing select is not supported; verify separately)

-- ---------------------------------------------------------------------------
-- 20260624043143_analytics_c2_extractor
-- ---------------------------------------------------------------------------
-- Epley 1RM mirroring src/lib/format.ts estimate1RM EXACTLY (integer; reps=1 passthrough; zero guard).
create or replace function analytics.epley_1rm(p_w numeric, p_reps int)
returns numeric language sql immutable set search_path to 'pg_catalog' as
$$ select case
     when coalesce(p_w,0) = 0 or coalesce(p_reps,0) = 0 then 0
     when p_reps = 1 then p_w
     else round(p_w * (1 + p_reps / 30.0))
   end $$;

-- reconcile_user: a user's projection := pure, idempotent function of their CURRENT blob.
-- Watermark = SERVER updated_at (skew-proof). Per-session fingerprint skip avoids re-exploding unchanged
-- sessions. Never reads data->'current' (active session). Math matches stats.ts (effectiveLoad/Epley/volume).
create or replace function analytics.reconcile_user(p_user uuid)
returns analytics.reconcile_result
language plpgsql security definer set search_path to 'pg_catalog','pg_temp'
as $$
declare
  v_data jsonb; v_updated timestamptz; v_schema int;
  v_unit text; v_prof_bw numeric; v_days int;
  w jsonb; v_sid text; v_epoch bigint; v_tz int;
  v_perf_at timestamptz; v_perf_on date; v_week int; v_est boolean;
  v_bw numeric; v_bw_kg numeric; v_fp text; v_old_fp text; v_old_ver int;
  v_keep text[] := '{}'; r analytics.reconcile_result := (0,0,0); v_deleted int;
begin
  select data, updated_at into v_data, v_updated
    from public.daily_rep_state where user_id = p_user;
  if v_data is null then
    insert into analytics.user_watermark(user_id, last_reconciled_at, last_status)
      values (p_user, now(), 'suspect_empty')
      on conflict (user_id) do update set last_reconciled_at = now(), last_status = 'suspect_empty';
    return r;
  end if;

  select schema_version into v_schema from analytics.meta where id = 1;
  v_unit := coalesce(v_data->'profile'->>'unit', 'lb');
  if v_unit not in ('lb','kg') then v_unit := 'lb'; end if;
  v_prof_bw := nullif(v_data->'profile'->>'bodyweight','')::numeric;
  v_days    := nullif(v_data->'profile'->>'daysPerWeek','')::int;

  insert into public.analytics_profile(user_id, unit, bodyweight, days_per_week, updated_at)
    values (p_user, v_unit, v_prof_bw, v_days, now())
    on conflict (user_id) do update set unit = excluded.unit, bodyweight = excluded.bodyweight,
      days_per_week = excluded.days_per_week, updated_at = now();

  for w in select e from jsonb_array_elements(coalesce(v_data->'workouts','[]'::jsonb)) e
  loop
    if not analytics.is_projectable(w) then continue; end if;
    v_sid := w->>'id';
    v_keep := array_append(v_keep, v_sid);

    v_epoch := coalesce(nullif(w->>'completedAt','')::bigint, nullif(w->>'date','')::bigint, 0);
    v_tz := nullif(w->>'tzOffsetMin','')::int;
    v_perf_at := to_timestamp(v_epoch / 1000.0);
    if v_tz is not null then
      v_perf_on := (to_timestamp((v_epoch - v_tz * 60000) / 1000.0) at time zone 'UTC')::date;
      v_est := false;
    else
      v_perf_on := (v_perf_at at time zone 'UTC')::date;
      v_est := true;
    end if;
    -- localWeek = floor((localDay+3)/7); localDay = floor(localEpochMs/86400000)
    v_week := floor((floor((v_epoch - coalesce(v_tz,0) * 60000) / 86400000.0) + 3) / 7.0)::int;

    v_bw := coalesce(nullif(w->>'bodyweight','')::numeric, v_prof_bw, case when v_unit = 'kg' then 70 else 155 end);
    v_bw_kg := analytics.to_kg(v_bw, v_unit);

    -- fingerprint over the projection-relevant subtree (ordered → deterministic; over-sensitive is safe)
    v_fp := md5(
      v_unit || '|' || coalesce(w->>'bodyweight','') || '|' || v_epoch::text || '|' || coalesce(w->>'tzOffsetMin','') || '|' ||
      coalesce((
        select string_agg(
          (ex->>'exerciseId') || ':' || coalesce(ex->>'planSlot','') || ':' || coalesce(ex->>'instanceId','') || '#' ||
          coalesce((
            select string_agg(
              (st->>'id') || ',' || coalesce((st->>'weight')::numeric::text,'0') || ',' || coalesce((st->>'reps')::numeric::text,'0') || ',' ||
              coalesce(st->>'done','false') || ',' || coalesce(st->>'warmup','false') || ',' || coalesce(st->>'rpe',''),
              ';' order by sord)
            from jsonb_array_elements(coalesce(ex->'sets','[]'::jsonb)) with ordinality as s(st, sord)
          ), ''),
          '|' order by exord)
        from jsonb_array_elements(coalesce(w->'exercises','[]'::jsonb)) with ordinality as e(ex, exord)
      ), '')
    );

    select fingerprint, schema_version into v_old_fp, v_old_ver
      from public.analytics_sessions where user_id = p_user and session_id = v_sid;
    if v_old_fp is not distinct from v_fp and v_old_ver is not distinct from v_schema then
      continue; -- unchanged → skip re-explode
    end if;

    insert into public.analytics_sessions(user_id, session_id, performed_at, performed_on, local_week, day_is_estimated,
        started_at, completed_at, title, unit, bodyweight, bodyweight_kg, duration_min, focus, gen_focus, plan_id,
        plan_day_label, fingerprint, blob_updated_at, schema_version, projected_at)
      values (p_user, v_sid, v_perf_at, v_perf_on, v_week, v_est,
        to_timestamp(nullif(w->>'startedAt','')::bigint / 1000.0),
        to_timestamp(nullif(w->>'completedAt','')::bigint / 1000.0),
        coalesce(w->>'title',''), v_unit, v_bw, v_bw_kg, nullif(w->>'durationMin','')::int,
        coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(w->'focus','[]'::jsonb))), '{}'),
        (select array_agg(value) from jsonb_array_elements_text(coalesce(w->'genFocus','[]'::jsonb))),
        w->>'planId', w->>'planDayLabel', v_fp, v_updated, v_schema, now())
      on conflict (user_id, session_id) do update set
        performed_at = excluded.performed_at, performed_on = excluded.performed_on, local_week = excluded.local_week,
        day_is_estimated = excluded.day_is_estimated, started_at = excluded.started_at, completed_at = excluded.completed_at,
        title = excluded.title, unit = excluded.unit, bodyweight = excluded.bodyweight, bodyweight_kg = excluded.bodyweight_kg,
        duration_min = excluded.duration_min, focus = excluded.focus, gen_focus = excluded.gen_focus, plan_id = excluded.plan_id,
        plan_day_label = excluded.plan_day_label, fingerprint = excluded.fingerprint, blob_updated_at = excluded.blob_updated_at,
        schema_version = excluded.schema_version, projected_at = now();

    delete from public.analytics_session_sets where user_id = p_user and session_id = v_sid;

    insert into public.analytics_session_sets(user_id, session_id, set_id, performed_at, performed_on, exercise_id, instance_id,
        plan_lift_id, plan_slot, superset_group, exercise_order, set_order, target_rep_low, target_rep_high, regions,
        is_bodyweight_lift, unit, weight, reps, rpe, done, warmup, effective_weight, effective_weight_kg, e1rm, e1rm_kg,
        set_volume, set_volume_kg, schema_version)
    select p_user, v_sid, sto.st->>'id', v_perf_at, v_perf_on, exo.ex->>'exerciseId', exo.ex->>'instanceId',
        exo.ex->>'planLiftId', nullif(exo.ex->>'planSlot','')::int, exo.ex->>'group', exo.exord::int, sto.setord::int,
        nullif(exo.ex->'targetReps'->>0,'')::int, nullif(exo.ex->'targetReps'->>1,'')::int,
        coalesce(ef.regions, '{}'), coalesce(ef.is_bodyweight_lift, false), v_unit,
        coalesce((sto.st->>'weight')::numeric, 0), coalesce((sto.st->>'reps')::int, 0), nullif(sto.st->>'rpe','')::numeric,
        coalesce((sto.st->>'done')::boolean, false), coalesce((sto.st->>'warmup')::boolean, false),
        ewc.ew, analytics.to_kg(ewc.ew, v_unit),
        analytics.epley_1rm(ewc.ew, coalesce((sto.st->>'reps')::int, 0)),
        analytics.to_kg(analytics.epley_1rm(ewc.ew, coalesce((sto.st->>'reps')::int, 0)), v_unit),
        case when coalesce((sto.st->>'done')::boolean,false) and not coalesce((sto.st->>'warmup')::boolean,false)
             then ewc.ew * coalesce((sto.st->>'reps')::numeric, 0) else 0 end,
        analytics.to_kg(case when coalesce((sto.st->>'done')::boolean,false) and not coalesce((sto.st->>'warmup')::boolean,false)
             then ewc.ew * coalesce((sto.st->>'reps')::numeric, 0) else 0 end, v_unit),
        v_schema
    from jsonb_array_elements(coalesce(w->'exercises','[]'::jsonb)) with ordinality as exo(ex, exord)
    cross join lateral jsonb_array_elements(coalesce(exo.ex->'sets','[]'::jsonb)) with ordinality as sto(st, setord)
    left join public.exercise_facts ef on ef.exercise_id = exo.ex->>'exerciseId'
    cross join lateral (select analytics.effective_weight(coalesce(ef.is_bodyweight_lift,false), v_bw,
                                 coalesce((sto.st->>'weight')::numeric, 0)) as ew) ewc
    where sto.st->>'id' is not null;

    update public.analytics_sessions s set
      working_volume = t.vol, working_volume_kg = t.vol_kg, working_set_count = t.cnt,
      working_rep_count = t.reps, exercise_count = t.exc
    from (
      select coalesce(sum(set_volume),0) vol, coalesce(sum(set_volume_kg),0) vol_kg,
             count(*) filter (where is_working) cnt, coalesce(sum(reps) filter (where is_working),0) reps,
             count(distinct exercise_id) filter (where is_working) exc
      from public.analytics_session_sets where user_id = p_user and session_id = v_sid
    ) t
    where s.user_id = p_user and s.session_id = v_sid;

    r.sessions := r.sessions + 1;
  end loop;

  delete from public.analytics_sessions where user_id = p_user and not (session_id = any(v_keep));
  get diagnostics v_deleted = row_count;
  r.deleted := v_deleted;
  select coalesce(sum(working_set_count),0) into r.sets from public.analytics_sessions where user_id = p_user;

  insert into analytics.user_watermark(user_id, last_blob_updated_at, last_reconciled_at, last_status, last_error, retry_count)
    values (p_user, v_updated, now(), 'ok', null, 0)
    on conflict (user_id) do update set
      last_blob_updated_at = greatest(user_watermark.last_blob_updated_at, excluded.last_blob_updated_at),
      last_reconciled_at = now(), last_status = 'ok', last_error = null, retry_count = 0;
  return r;
end;
$$;

-- backfill: reconcile every existing user, each in its own subtransaction (one bad blob can't abort the run).
create or replace function analytics.backfill_projection()
returns int language plpgsql security definer set search_path to 'pg_catalog','pg_temp'
as $$
declare u uuid; n int := 0;
begin
  for u in select user_id from public.daily_rep_state loop
    begin
      perform analytics.reconcile_user(u);
      n := n + 1;
    exception when others then
      insert into analytics.user_watermark(user_id, last_reconciled_at, last_status, last_error, retry_count)
        values (u, now(), 'error', sqlerrm, 1)
        on conflict (user_id) do update set last_reconciled_at = now(), last_status = 'error',
          last_error = sqlerrm, retry_count = user_watermark.retry_count + 1;
    end;
  end loop;
  return n;
end;
$$;

-- definer functions: deny client EXECUTE, allow service_role (cron/backend).
revoke execute on function analytics.reconcile_user(uuid)   from public, anon, authenticated;
revoke execute on function analytics.backfill_projection()  from public, anon, authenticated;
grant  execute on function analytics.reconcile_user(uuid)   to service_role;
grant  execute on function analytics.backfill_projection()  to service_role;

-- ---------------------------------------------------------------------------
-- 20260624050106_analytics_d_automation_drain_sweep_trigger
-- ---------------------------------------------------------------------------
-- drain: dequeue + reconcile (latency path). Per-user advisory lock serializes drain-vs-sweep without
-- blocking the user's live blob push. On error, keep the row queued (retry next tick) + record on watermark.
create or replace function analytics.drain_reconcile_queue(p_limit int default 200)
returns int language plpgsql security definer set search_path to 'pg_catalog','pg_temp' as $$
declare u uuid; n int := 0;
begin
  for u in select user_id from analytics.reconcile_queue order by enqueued_at limit p_limit loop
    if pg_try_advisory_xact_lock(hashtext('analytics_reconcile_' || u::text)) then
      begin
        perform analytics.reconcile_user(u);
        delete from analytics.reconcile_queue where user_id = u;
        n := n + 1;
      exception when others then
        insert into analytics.user_watermark(user_id, last_reconciled_at, last_status, last_error, retry_count)
          values (u, now(), 'error', sqlerrm, 1)
          on conflict (user_id) do update set last_reconciled_at = now(), last_status = 'error',
            last_error = sqlerrm, retry_count = user_watermark.retry_count + 1;
      end;
    end if;
  end loop;
  return n;
end; $$;

-- sweep: the CORRECTNESS FLOOR — reconcile any user whose SERVER updated_at exceeds their watermark
-- (p_full=true ignores the watermark: nightly self-heal for missed enqueues / out-of-band writes).
create or replace function analytics.sweep_stale(p_limit int default 500, p_full boolean default false)
returns int language plpgsql security definer set search_path to 'pg_catalog','pg_temp' as $$
declare u uuid; n int := 0;
begin
  for u in
    select d.user_id from public.daily_rep_state d
    left join analytics.user_watermark wm on wm.user_id = d.user_id
    where p_full or wm.last_blob_updated_at is null or d.updated_at > wm.last_blob_updated_at
    order by d.updated_at limit p_limit
  loop
    if pg_try_advisory_xact_lock(hashtext('analytics_reconcile_' || u::text)) then
      begin
        perform analytics.reconcile_user(u);
        n := n + 1;
      exception when others then
        insert into analytics.user_watermark(user_id, last_reconciled_at, last_status, last_error, retry_count)
          values (u, now(), 'error', sqlerrm, 1)
          on conflict (user_id) do update set last_reconciled_at = now(), last_status = 'error',
            last_error = sqlerrm, retry_count = user_watermark.retry_count + 1;
      end;
    end if;
  end loop;
  return n;
end; $$;

-- enqueue trigger fn (SECURITY DEFINER: the client triggering the UPDATE has no write on analytics.*)
create or replace function analytics.tg_enqueue_reconcile()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','pg_temp' as $$
begin
  insert into analytics.reconcile_queue(user_id) values (new.user_id)
    on conflict (user_id) do update set enqueued_at = now();
  return null;
end; $$;

-- AFTER INSERT (first sync) unconditional; AFTER UPDATE only when the WORKOUTS subtree actually changed.
-- The BEFORE monotonic guard reverts NEW.data on a stale push, so the WHEN sees NEW=OLD → no churn.
drop trigger if exists daily_rep_state_enqueue_ins on public.daily_rep_state;
create trigger daily_rep_state_enqueue_ins
  after insert on public.daily_rep_state
  for each row execute function analytics.tg_enqueue_reconcile();

drop trigger if exists daily_rep_state_enqueue_upd on public.daily_rep_state;
create trigger daily_rep_state_enqueue_upd
  after update on public.daily_rep_state
  for each row when (new.data->'workouts' is distinct from old.data->'workouts')
  execute function analytics.tg_enqueue_reconcile();

revoke execute on function analytics.drain_reconcile_queue(int) from public, anon, authenticated;
revoke execute on function analytics.sweep_stale(int, boolean) from public, anon, authenticated;
grant  execute on function analytics.drain_reconcile_queue(int) to service_role;
grant  execute on function analytics.sweep_stale(int, boolean)  to service_role;

-- ---------------------------------------------------------------------------
-- 20260624050517_analytics_d2_pg_cron_schedule
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

-- drain the enqueue queue every minute (latency path)
select cron.schedule('analytics-drain', '* * * * *', $$ select analytics.drain_reconcile_queue(200); $$);

-- correctness floor: every 15m reconcile anyone whose SERVER updated_at outran their watermark
select cron.schedule('analytics-sweep', '*/15 * * * *', $$ select analytics.sweep_stale(500, false); $$);

-- nightly full self-heal (08:00 UTC ~ small-hours US) ignores the watermark to catch any missed user
select cron.schedule('analytics-nightly-full', '0 8 * * *', $$ select analytics.sweep_stale(100000, true); $$);

-- ---------------------------------------------------------------------------
-- 20260624051148_analytics_e1_per_user_views_and_rpc
-- ---------------------------------------------------------------------------
create or replace view public.v_my_session_volume with (security_invoker = true) as
  select user_id, performed_on, local_week, working_volume, working_volume_kg,
         working_set_count, working_rep_count
  from public.analytics_sessions where user_id = (select auth.uid());

create or replace view public.v_my_exercise_e1rm with (security_invoker = true) as
  select user_id, exercise_id, performed_on, max(e1rm) as best_e1rm, max(e1rm_kg) as best_e1rm_kg
  from public.analytics_session_sets
  where user_id = (select auth.uid()) and is_working and e1rm > 0
  group by user_id, exercise_id, performed_on;

create or replace view public.v_my_exercise_prs with (security_invoker = true) as
  with day_best as (
    select user_id, exercise_id, performed_on, performed_at, max(e1rm) as best_e1rm
    from public.analytics_session_sets
    where user_id = (select auth.uid()) and is_working and e1rm > 0
    group by user_id, exercise_id, performed_on, performed_at),
  w as (
    select *,
      max(best_e1rm) over (partition by exercise_id order by performed_at
        rows between unbounded preceding and 1 preceding) as prior_best,
      row_number() over (partition by exercise_id order by performed_at) as rn
    from day_best)
  select user_id, exercise_id, performed_on, best_e1rm as e1rm, prior_best as previous
  from w where rn > 1 and prior_best is not null and best_e1rm > prior_best;

create or replace view public.v_my_region_volume with (security_invoker = true) as
  select s.user_id, s.performed_on,
         floor(((s.performed_on - date '1970-01-01') + 3)::numeric/7)::int as local_week,
         r.region, count(*) as working_sets,
         sum(s.set_volume) as volume, sum(s.set_volume_kg) as volume_kg
  from public.analytics_session_sets s, unnest(s.regions) as r(region)
  where s.user_id = (select auth.uid()) and s.is_working
  group by s.user_id, s.performed_on, r.region;

create or replace view public.v_my_adherence with (security_invoker = true) as
  select s.user_id, s.local_week, count(distinct s.performed_on) as training_days,
         p.days_per_week as target,
         case when p.days_per_week > 0
              then count(distinct s.performed_on)::numeric / p.days_per_week end as adherence
  from public.analytics_sessions s
  join public.analytics_profile p on p.user_id = s.user_id
  where s.user_id = (select auth.uid())
  group by s.user_id, s.local_week, p.days_per_week;

create function public.my_weekly_streak() returns integer
  language sql stable security invoker set search_path = pg_catalog, public, pg_temp as $$
  with recursive
       weeks as (select distinct local_week from public.analytics_sessions where user_id = (select auth.uid())),
       cur as (select floor(((current_date - date '1970-01-01') + 3)::numeric/7)::int as w),
       start as (select case when exists (select 1 from weeks where local_week = (select w from cur))
                             then (select w from cur) else (select w from cur) - 1 end as s),
       rec as (select (select s from start) as wk, 0 as depth
               union all
               select wk - 1, depth + 1 from rec where exists (select 1 from weeks where local_week = rec.wk))
  select coalesce(max(depth) filter (where exists (select 1 from weeks where local_week = rec.wk)) + 1, 0) from rec;
$$;

create function public.my_volume_percentile()
  returns table(my_volume numeric, cohort_p50 numeric, cohort_n int)
  language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
  declare k constant int := 20; v_me numeric; v_n int; v_p50 numeric;
  begin
    select sum(working_volume_kg) into v_me from public.analytics_sessions
      where user_id = (select auth.uid()) and performed_at >= now() - interval '28 days';
    with per_user as (
      select user_id, sum(working_volume_kg) as vol from public.analytics_sessions
      where performed_at >= now() - interval '28 days' group by user_id)
    select count(*), percentile_cont(0.5) within group (order by vol) into v_n, v_p50 from per_user;
    if v_n < k then return query select v_me, null::numeric, v_n;
    else            return query select v_me, v_p50, v_n; end if;
  end $$;

revoke all on public.v_my_session_volume, public.v_my_exercise_e1rm, public.v_my_exercise_prs,
              public.v_my_region_volume, public.v_my_adherence from anon, public;
grant  select on public.v_my_session_volume, public.v_my_exercise_e1rm, public.v_my_exercise_prs,
              public.v_my_region_volume, public.v_my_adherence to authenticated;

revoke all on function public.my_weekly_streak()       from public, anon;
revoke all on function public.my_volume_percentile()   from public, anon;
grant  execute on function public.my_weekly_streak()     to authenticated;
grant  execute on function public.my_volume_percentile() to authenticated;

-- ---------------------------------------------------------------------------
-- 20260624051213_analytics_e2_cohort_matviews
-- ---------------------------------------------------------------------------
-- All cohort matviews live in the PRIVATE analytics schema (anon/authenticated have no USAGE),
-- exclude day_is_estimated sessions from time-cohorting, and count DISTINCT users so one heavy
-- logger can't skew popularity. Unique index on each → REFRESH ... CONCURRENTLY is possible.

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.cohort_dau as
  select performed_on, count(distinct user_id) as dau
  from public.analytics_sessions where not day_is_estimated group by performed_on;
CREATE UNIQUE INDEX IF NOT EXISTS cohort_dau_pk on analytics.cohort_dau (performed_on);

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.cohort_weekly as
  select local_week, count(distinct user_id) as wau,
         count(*)::numeric / nullif(count(distinct user_id),0) as sessions_per_user
  from public.analytics_sessions where not day_is_estimated group by local_week;
CREATE UNIQUE INDEX IF NOT EXISTS cohort_weekly_pk on analytics.cohort_weekly (local_week);

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.cohort_retention as
  with firsts as (select user_id, min(local_week) as cohort_week
                  from public.analytics_sessions where not day_is_estimated group by user_id),
       act as (select distinct user_id, local_week
               from public.analytics_sessions where not day_is_estimated)
  select f.cohort_week, a.local_week - f.cohort_week as weeks_since, count(distinct a.user_id) as active_users
  from firsts f join act a using (user_id)
  group by f.cohort_week, a.local_week - f.cohort_week;
CREATE UNIQUE INDEX IF NOT EXISTS cohort_retention_pk on analytics.cohort_retention (cohort_week, weeks_since);

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.popular_exercises as
  select exercise_id, count(distinct user_id) as users, count(*) as working_sets
  from public.analytics_session_sets where is_working group by exercise_id;
CREATE UNIQUE INDEX IF NOT EXISTS popular_exercises_pk on analytics.popular_exercises (exercise_id);

-- popular_plans: analytics_sessions carries plan_id, so the "same shape for plan_id" the spec noted is buildable
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.popular_plans as
  select plan_id, count(distinct user_id) as users, count(*) as sessions
  from public.analytics_sessions where plan_id is not null and plan_id <> '' group by plan_id;
CREATE UNIQUE INDEX IF NOT EXISTS popular_plans_pk on analytics.popular_plans (plan_id);

-- ---------------------------------------------------------------------------
-- 20260624051235_analytics_e3_cohort_refresh_and_cron
-- ---------------------------------------------------------------------------
create or replace function analytics.refresh_cohorts_hourly() returns void
  language plpgsql security definer set search_path to 'pg_catalog','pg_temp' as $$
begin
  refresh materialized view concurrently analytics.cohort_dau;
end $$;

create or replace function analytics.refresh_cohorts_nightly() returns void
  language plpgsql security definer set search_path to 'pg_catalog','pg_temp' as $$
begin
  refresh materialized view concurrently analytics.cohort_weekly;
  refresh materialized view concurrently analytics.cohort_retention;
  refresh materialized view concurrently analytics.popular_exercises;
  refresh materialized view concurrently analytics.popular_plans;
end $$;

revoke execute on function analytics.refresh_cohorts_hourly()  from public, anon, authenticated;
revoke execute on function analytics.refresh_cohorts_nightly() from public, anon, authenticated;
grant  execute on function analytics.refresh_cohorts_hourly()  to service_role;
grant  execute on function analytics.refresh_cohorts_nightly() to service_role;

select cron.schedule('analytics-cohort-hourly',  '0 * * * *',  $$ select analytics.refresh_cohorts_hourly(); $$);
select cron.schedule('analytics-cohort-nightly', '30 8 * * *', $$ select analytics.refresh_cohorts_nightly(); $$);

-- ---------------------------------------------------------------------------
-- 20260624130246_purge_user_data_for_account_deletion
-- ---------------------------------------------------------------------------
-- GDPR Art.17 erasure: delete ALL of a user's rows across public + the private analytics schema.
-- SECURITY DEFINER (owned by postgres) so it can reach the analytics schema; service_role-only.
-- The edge function calls this, then auth.admin.deleteUser (which also CASCADE-clears daily_rep_state).
create or replace function public.purge_user_data(p_user uuid)
returns void language plpgsql security definer set search_path to 'pg_catalog', 'public', 'pg_temp' as $$
begin
  delete from public.analytics_session_sets where user_id = p_user;
  delete from public.analytics_sessions     where user_id = p_user;
  delete from public.analytics_profile      where user_id = p_user;
  delete from analytics.user_watermark      where user_id = p_user;
  delete from analytics.reconcile_queue     where user_id = p_user;
  delete from public.daily_rep_state        where user_id = p_user;
end; $$;

revoke execute on function public.purge_user_data(uuid) from public, anon, authenticated;
grant  execute on function public.purge_user_data(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 20260624235132_subscriptions_table_and_trial
-- ---------------------------------------------------------------------------
-- Subscriptions: one row per user. Mirrors Stripe subscription state and tracks the app-managed,
-- card-free 30-day free trial. Written ONLY by the service role (Stripe webhook) and the signup
-- trigger; users may read their own row but never write it (so nobody can grant themselves Pro).

create table if not exists public.subscriptions (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id   text unique,
  stripe_subscription_id text unique,
  status               text not null default 'trialing',  -- trialing|active|past_due|canceled|incomplete|incomplete_expired|unpaid|paused
  price_id             text,
  plan                 text,                                -- 'monthly' | 'annual' | null
  trial_ends_at        timestamptz,                         -- app-granted, card-free trial end
  current_period_end   timestamptz,                         -- paid period end (from Stripe)
  cancel_at_period_end boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

-- Read-only to the owning user. NO insert/update/delete policies => only the service role
-- (webhook) and SECURITY DEFINER trigger can write, both of which bypass RLS.
drop policy if exists "read own subscription" on public.subscriptions;
DROP POLICY IF EXISTS "read own subscription" ON public.subscriptions;
CREATE POLICY "read own subscription" ON public.subscriptions
  for select using (auth.uid() = user_id);

-- keep updated_at fresh on writes
create or replace function public.touch_subscriptions_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists trg_subscriptions_touch on public.subscriptions;
create trigger trg_subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_subscriptions_updated_at();

-- Auto-provision a 30-day, card-free trial row when a new auth user signs up.
create or replace function public.handle_new_user_subscription()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriptions (user_id, status, trial_ends_at)
  values (new.id, 'trialing', now() + interval '30 days')
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created_subscription on auth.users;
create trigger on_auth_user_created_subscription
  after insert on auth.users
  for each row execute function public.handle_new_user_subscription();

-- Backfill existing users with a fresh 30-day trial row.
insert into public.subscriptions (user_id, status, trial_ends_at)
select id, 'trialing', now() + interval '30 days' from auth.users
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 20260625001352_harden_subscription_functions
-- ---------------------------------------------------------------------------
-- Security hardening for the subscriptions trigger helpers (Supabase advisors 0011 / 0028 / 0029).
-- Both functions are trigger-only — they must not be callable via the PostgREST RPC API, and both get
-- a pinned, empty search_path. Triggers continue to fire after the EXECUTE revoke (the trigger mechanism
-- doesn't require EXECUTE for the triggering role), and fully-qualified object refs make search_path=''
-- safe.

create or replace function public.touch_subscriptions_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create or replace function public.handle_new_user_subscription()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.subscriptions (user_id, status, trial_ends_at)
  values (new.id, 'trialing', now() + interval '30 days')
  on conflict (user_id) do nothing;
  return new;
end $$;

revoke all on function public.handle_new_user_subscription() from public, anon, authenticated;
revoke all on function public.touch_subscriptions_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 20260625002142_subscriptions_least_privilege_grants
-- ---------------------------------------------------------------------------
-- Defense-in-depth: the subscriptions row is read-only to end users by RLS (only a SELECT policy
-- exists). Make that intent enforced by GRANTS too, so a future permissive write policy added by
-- mistake can't immediately hand users the ability to self-grant Pro. Writes are performed only by the
-- service role (webhook) and the SECURITY DEFINER signup trigger, neither of which needs these grants.
revoke insert, update, delete on public.subscriptions from authenticated;
revoke insert, update, delete on public.subscriptions from anon;

-- ---------------------------------------------------------------------------
-- 20260626130000_enable_rls_on_analytics_bookkeeping_tables
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 20260626140000_entitlement_rls_on_daily_rep_state
-- ---------------------------------------------------------------------------
-- Server-side entitlement enforcement (P0). The paywall was client-only and fails open in
-- offline/local/cache-miss paths, so a determined account holder could keep full cloud access for free.
-- This gates WRITES to public.daily_rep_state behind an active subscription/trial, in addition to the
-- client gate (which stays as UX). Reads and deletes remain owner-only and ungated, so a lapsed user can
-- ALWAYS still read and export their own data and delete their account (GDPR) — they just can't sync new
-- data up. This mirrors src/lib/billing.ts deriveEntitlement(...).entitled exactly (kept in parity by
-- src/__tests__/entitlement-parity.test.ts).
--
-- NOTE: not yet applied to the shared production project. Review + apply via the dedicated-project
-- cutover (or a reviewed `supabase db push`). The predicate logic was validated against the live engine
-- before commit (synthetic rows, nothing created).

-- is_active_subscriber(): true iff the CALLER currently has access. No argument — it reads auth.uid()
-- internally so an authenticated user can't probe another user's subscription state. SECURITY DEFINER so
-- it can read public.subscriptions regardless of the caller's RLS.
create or replace function public.is_active_subscriber()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when (select auth.uid()) is null then false
    -- Fail OPEN when no row exists yet (signup-trigger provisioning gap) so a brand-new user is never
    -- locked out of their first sync. A genuinely lapsed user ALWAYS has a row (status persists), and
    -- users cannot delete their subscriptions row (no delete policy), so this branch can't be abused.
    when not exists (select 1 from public.subscriptions where user_id = (select auth.uid())) then true
    else exists (
      select 1
      from public.subscriptions s
      where s.user_id = (select auth.uid())
        and (
          -- hasSubscription: a live (paid or trialing) Stripe subscription
          (s.stripe_subscription_id is not null and s.status in ('active', 'trialing', 'past_due'))
          -- trialActive: still inside the app-granted, card-free trial window
          or (s.trial_ends_at > now())
          -- paidPeriodActive: canceled-but-paid-through (honor already-paid time), excluding never-paid statuses
          or (
            s.stripe_subscription_id is not null
            and s.current_period_end > now()
            and s.status not in ('unpaid', 'incomplete', 'incomplete_expired')
          )
        )
    )
  end
$$;

revoke all on function public.is_active_subscriber() from public, anon;
grant execute on function public.is_active_subscriber() to authenticated, service_role;

-- Gate writes. SELECT + DELETE policies are intentionally left unchanged (owner-only, ungated).
drop policy if exists daily_rep_state_insert_own on public.daily_rep_state;
DROP POLICY IF EXISTS daily_rep_state_insert_own ON public.daily_rep_state;
CREATE POLICY daily_rep_state_insert_own ON public.daily_rep_state
  for insert to authenticated
  with check ((select auth.uid()) = user_id and public.is_active_subscriber());

drop policy if exists daily_rep_state_update_own on public.daily_rep_state;
DROP POLICY IF EXISTS daily_rep_state_update_own ON public.daily_rep_state;
CREATE POLICY daily_rep_state_update_own ON public.daily_rep_state
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and public.is_active_subscriber());

-- ---------------------------------------------------------------------------
-- 20260626150000_trial_abuse_normalized_email_ledger
-- ---------------------------------------------------------------------------
-- Trial-abuse mitigation (P1). The signup trigger previously granted a fresh 30-day, card-free trial to
-- EVERY new auth user with no dedup — so deleting an account and re-signing up (FK-cascade drops the old
-- subscriptions row) or using a new address farmed unlimited trials. This adds a normalized-email ledger
-- that persists across account deletion, so a given email gets the free trial ONCE.
--
-- POLICY NOTE (tunable): normalization lowercases + trims, and for gmail.com/googlemail.com strips dots
-- and any +suffix (Gmail treats these as the same inbox) → one trial per real Gmail inbox. Other
-- providers are only lowercased/trimmed (no +tag stripping) to avoid false-positives across legitimately
-- distinct addresses. Tighten/loosen here if product wants a different stance. A determined abuser can
-- still use disposable domains; pair with email-confirmation + CAPTCHA (already scaffolded) for defense.
--
-- NOTE: not yet applied to the shared prod project. The normalize_email logic was validated against the
-- live engine (synthetic addresses) before commit. Apply via the dedicated-project cutover / db push.

-- Canonical inbox key for an email. IMMUTABLE + pinned search_path.
create or replace function public.normalize_email(p_email text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_email is null or btrim(p_email) = '' then null
    else (
      with parts as (
        select lower(btrim(split_part(p_email, '@', 1))) as local_part,
               lower(btrim(split_part(p_email, '@', 2))) as domain
      )
      select case
        when domain in ('gmail.com', 'googlemail.com')
          then replace(split_part(local_part, '+', 1), '.', '') || '@gmail.com'
        else local_part || '@' || domain
      end
      from parts
    )
  end
$$;

-- One row per inbox that has ever been granted the free trial. Deliberately NOT keyed to auth.users
-- (no FK), so it SURVIVES account deletion — that's the whole point. Service-role / definer-trigger only.
create table if not exists public.trial_ledger (
  normalized_email text primary key,
  first_user_id    uuid,
  first_granted_at timestamptz not null default now()
);
alter table public.trial_ledger enable row level security;
-- No policies → anon/authenticated have no access; the SECURITY DEFINER trigger and service_role bypass RLS.
revoke all on table public.trial_ledger from anon, authenticated;

-- Re-provision the signup trigger to grant the trial only on the FIRST claim per normalized email.
-- search_path = '' (NOT 'public') to preserve the hardening from 20260625001352 — every object below is
-- already fully schema-qualified, so this is behavior-identical and keeps advisor 0011 satisfied.
create or replace function public.handle_new_user_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_norm  text := public.normalize_email(new.email);
  v_trial timestamptz;
begin
  if v_norm is null then
    -- No usable email (e.g. phone-only signup) → can't dedup; grant the trial rather than block signup.
    v_trial := now() + interval '30 days';
  else
    insert into public.trial_ledger (normalized_email, first_user_id)
    values (v_norm, new.id)
    on conflict (normalized_email) do nothing;
    -- FOUND is true iff this INSERT actually added a row (i.e. first ever claim for this inbox).
    if found then
      v_trial := now() + interval '30 days';
    else
      v_trial := null; -- inbox already used its trial → no free window; user must subscribe
    end if;
  end if;

  -- INVARIANT: entitlement is decided by (stripe_subscription_id, trial_ends_at, current_period_end),
  -- NEVER by status alone. The repeat-claim row has status='trialing' but trial_ends_at=NULL and no sub,
  -- which deriveEntitlement / is_active_subscriber both read as NOT entitled (→ paywall + write-blocked).
  -- Do not add code that grants access on status='trialing' without also checking trial_ends_at.
  insert into public.subscriptions (user_id, status, trial_ends_at)
  values (new.id, 'trialing', v_trial)
  on conflict (user_id) do nothing;
  return new;
end
$$;

-- Backfill the ledger from existing users so a current user can't delete + re-signup for a new trial.
insert into public.trial_ledger (normalized_email, first_user_id, first_granted_at)
select distinct on (public.normalize_email(email))
  public.normalize_email(email), id, coalesce(created_at, now())
from auth.users
where public.normalize_email(email) is not null
order by public.normalize_email(email), created_at asc
on conflict (normalized_email) do nothing;

-- ---------------------------------------------------------------------------
-- 20260626160000_schedule_subscription_reconciliation
-- ---------------------------------------------------------------------------
-- Schedule the reconcile-subscriptions Edge Function (the missed-webhook safety net) via pg_cron + pg_net.
--
-- ONE-TIME [HUMAN] before this runs effectively:
--   1. Deploy the function:  supabase functions deploy reconcile-subscriptions
--   2. Set its shared secret:  supabase secrets set RECONCILE_SECRET=<random>
--   3. Store the URL + secret in Vault so they aren't committed here:
--        select vault.create_secret('https://<ref>.supabase.co/functions/v1/reconcile-subscriptions', 'reconcile_url');
--        select vault.create_secret('<same RECONCILE_SECRET>', 'reconcile_secret');
--
-- Creating the schedule is safe before the Vault secrets exist: the inner SELECTs are evaluated per run,
-- so until they're set the job simply posts to a null URL and pg_net logs an error (no data impact).
--
-- NOTE: not yet applied to the shared prod project — apply via the dedicated-project cutover / db push.

create extension if not exists pg_net;
-- pg_cron is normally created by the analytics migrations; ensure it here too so this migration is
-- self-sufficient on a fresh/dedicated project that doesn't replay the analytics history.
create extension if not exists pg_cron;

-- Idempotent (re)schedule: drop any prior job of this name, then create it. Runs every 6 hours (offset
-- to avoid the top-of-hour analytics cron pile-up).
do $$
begin
  perform cron.unschedule('reconcile-subscriptions-6h');
exception when others then
  null; -- not previously scheduled
end $$;

select cron.schedule(
  'reconcile-subscriptions-6h',
  '17 */6 * * *',
  $cron$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'reconcile_url'),
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'x-reconcile-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reconcile_secret')
    ),
    body    := '{}'::jsonb
  );
  $cron$
);

-- ---------------------------------------------------------------------------
-- 20260626190000_seed_exercise_facts_full_catalogue
-- ---------------------------------------------------------------------------
-- AUTO-GENERATED by scripts/gen-exercise-facts-seed.ts — do not edit by hand.
-- Full public.exercise_facts seed (55 rows) derived from the source catalogue
-- (src/data/exercises.ts + muscles.ts) per the analytics-facts contract:
--   is_bodyweight_lift = equipment ∋ 'bodyweight' AND category ∈ {compound, isolation}
--   regions            = DISTINCT MUSCLES[primary].region
-- Regenerate after any catalogue change: node --experimental-strip-types scripts/gen-exercise-facts-seed.ts
insert into public.exercise_facts (exercise_id, is_bodyweight_lift, regions) values
  ('barbell-bench-press', false, '{push}'),
  ('incline-db-press', false, '{push}'),
  ('pushup', true, '{push}'),
  ('cable-fly', false, '{push}'),
  ('machine-chest-press', false, '{push}'),
  ('dips', true, '{push}'),
  ('deadlift', false, '{legs,core}'),
  ('pullup', true, '{pull}'),
  ('lat-pulldown', false, '{pull}'),
  ('barbell-row', false, '{pull}'),
  ('db-row', false, '{pull}'),
  ('seated-cable-row', false, '{pull}'),
  ('face-pull', false, '{push,pull}'),
  ('shrug', false, '{pull}'),
  ('overhead-press', false, '{push}'),
  ('db-shoulder-press', false, '{push}'),
  ('lateral-raise', false, '{push}'),
  ('rear-delt-fly', false, '{push}'),
  ('barbell-curl', false, '{pull}'),
  ('db-curl', false, '{pull}'),
  ('hammer-curl', false, '{pull}'),
  ('cable-curl', false, '{pull}'),
  ('close-grip-bench', false, '{push}'),
  ('triceps-pushdown', false, '{push}'),
  ('overhead-triceps', false, '{push}'),
  ('bench-dip', true, '{push}'),
  ('back-squat', false, '{legs}'),
  ('front-squat', false, '{legs}'),
  ('leg-press', false, '{legs}'),
  ('goblet-squat', false, '{legs}'),
  ('lunge', true, '{legs}'),
  ('leg-extension', false, '{legs}'),
  ('romanian-deadlift', false, '{legs}'),
  ('hip-thrust', false, '{legs}'),
  ('leg-curl', false, '{legs}'),
  ('glute-bridge', true, '{legs}'),
  ('kb-swing', false, '{legs}'),
  ('kb-clean-press', false, '{push}'),
  ('turkish-get-up', false, '{push,core}'),
  ('standing-calf-raise', true, '{legs}'),
  ('seated-calf-raise', false, '{legs}'),
  ('plank', false, '{core}'),
  ('hanging-leg-raise', false, '{core}'),
  ('cable-crunch', false, '{core}'),
  ('bicycle-crunch', false, '{core}'),
  ('wrist-curl', false, '{pull}'),
  ('rowing-machine', false, '{pull}'),
  ('burpee', false, '{legs,push}'),
  ('db-bench-press', false, '{push}'),
  ('incline-bench-press', false, '{push}'),
  ('pike-pushup', true, '{push}'),
  ('chinup', true, '{pull}'),
  ('inverted-row', true, '{pull}'),
  ('bodyweight-squat', true, '{legs}'),
  ('bulgarian-split-squat', true, '{legs}')
on conflict (exercise_id) do update
  set is_bodyweight_lift = excluded.is_bodyweight_lift,
      regions            = excluded.regions;

