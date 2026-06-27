-- Migration B: the set-level projection tables. RLS+FORCE, client SELECT-only, REVOKE in the SAME
-- migration as CREATE to neutralize the public default-ACL auto-grant. Rows enter ONLY via the
-- SECURITY DEFINER extractor (next migration), so client write-forgery is structurally impossible.

-- catalogue-derived facts (is_bodyweight_lift, regions) — seeded mechanically; client write forbidden
CREATE TABLE public.exercise_facts (
  exercise_id        text PRIMARY KEY,
  is_bodyweight_lift boolean NOT NULL DEFAULT false,
  regions            text[]  NOT NULL DEFAULT '{}'
);
ALTER TABLE public.exercise_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_facts FORCE  ROW LEVEL SECURITY;
REVOKE ALL    ON public.exercise_facts FROM anon, authenticated;
GRANT  SELECT ON public.exercise_facts TO authenticated;
CREATE POLICY exercise_facts_read ON public.exercise_facts FOR SELECT TO authenticated USING (true);

-- grain = one COMPLETED Workout; pre-aggregated working totals
CREATE TABLE public.analytics_sessions (
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
CREATE POLICY sess_read ON public.analytics_sessions FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);

-- grain = one LoggedSet; flattened exercise context + extractor-computed derived columns
CREATE TABLE public.analytics_session_sets (
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
CREATE POLICY sets_read ON public.analytics_session_sets FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);

-- per-user projected profile fields the metric views need (adherence target, unit, bodyweight)
CREATE TABLE public.analytics_profile (
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
CREATE POLICY profile_read ON public.analytics_profile FOR SELECT TO authenticated USING ((select auth.uid()) = user_id);

-- indexes (the sets table is the one that scales)
CREATE INDEX sessions_user_time_idx   ON public.analytics_sessions (user_id, performed_at DESC);
CREATE INDEX sessions_user_week_idx   ON public.analytics_sessions (user_id, local_week);
CREATE INDEX sessions_plan_idx        ON public.analytics_sessions (plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX sets_user_ex_time_idx    ON public.analytics_session_sets (user_id, exercise_id, performed_at DESC);
CREATE INDEX sets_working_idx         ON public.analytics_session_sets (user_id, performed_at DESC) WHERE is_working;
CREATE INDEX sets_exercise_cohort_idx ON public.analytics_session_sets (exercise_id) WHERE is_working;
