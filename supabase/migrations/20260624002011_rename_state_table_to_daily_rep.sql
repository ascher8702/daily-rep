-- Rename the cloud state store to match the app's new name "Daily Rep".
-- Per the user, existing state need not be preserved (table has 0 rows), so we recreate cleanly with
-- consistent daily_rep_* naming and ALL 2026-06-23 hardening (client_updated_at default, object CHECK,
-- authenticated-scoped RLS, touch trigger, column docs) baked in.

DROP TABLE IF EXISTS public.fitforge_state CASCADE;           -- also drops its policies/trigger/constraints
DROP FUNCTION IF EXISTS public.fitforge_touch_updated_at();   -- standalone fn, not dropped by the table

CREATE TABLE public.daily_rep_state (
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

CREATE TRIGGER daily_rep_state_touch
  BEFORE UPDATE ON public.daily_rep_state
  FOR EACH ROW EXECUTE FUNCTION public.daily_rep_touch_updated_at();

ALTER TABLE public.daily_rep_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY daily_rep_state_select_own ON public.daily_rep_state
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY daily_rep_state_insert_own ON public.daily_rep_state
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY daily_rep_state_update_own ON public.daily_rep_state
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
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
