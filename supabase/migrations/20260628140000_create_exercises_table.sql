-- DB-managed exercise + rehab catalogue: an OPTIONAL overlay on the app's bundled catalogues
-- (src/data/exercises.ts → EXERCISES and src/data/rehab.ts → REHAB_EXERCISES). Rows here add new
-- exercises or override a bundled one by id, without a code deploy. A row whose data.category is
-- 'rehab' routes to the therapeutic/rehab pool (never the generator). The app is offline-first: the
-- bundled catalogues always ship in-app, so an empty table / offline simply means "bundled only".
--
-- Mirrors public.plans exactly (id text PK, data jsonb, sort int, active bool, public-read RLS,
-- touch-updated_at trigger, data-is-object + id-matches CHECKs) — see the baseline migration.
CREATE TABLE IF NOT EXISTS public.exercises (
  id          text        PRIMARY KEY,
  data        jsonb       NOT NULL,
  sort        integer     NOT NULL DEFAULT 0,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exercises_data_is_object CHECK (jsonb_typeof(data) = 'object'),
  CONSTRAINT exercises_data_id_matches CHECK (data->>'id' = id)
);

ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;

-- Public catalogue: read-only for everyone (anon + signed-in). No write policies → RLS denies all
-- client writes; exercises are managed via the dashboard / service-role (which bypasses RLS).
DROP POLICY IF EXISTS exercises_read_all ON public.exercises;
CREATE POLICY exercises_read_all ON public.exercises
  FOR SELECT TO anon, authenticated
  USING (true);

-- keep updated_at fresh on edits (reuse the same trigger fn style as plans_touch_updated_at)
CREATE OR REPLACE FUNCTION public.exercises_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  new.updated_at = now();
  return new;
END;
$$;

DROP TRIGGER IF EXISTS exercises_touch ON public.exercises;
CREATE TRIGGER exercises_touch BEFORE UPDATE ON public.exercises
  FOR EACH ROW EXECUTE FUNCTION public.exercises_touch_updated_at();

COMMENT ON TABLE public.exercises IS 'Optional DB-managed exercise + rehab catalogue overlaying the bundled catalogue by id (add/override without a deploy). category:"rehab" routes to the rehab pool. Public-read; writes via dashboard/service-role only. The app ships the bundled catalogue, so this can be empty.';
