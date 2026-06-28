-- Keep public.exercise_facts (the analytics read-model projection) in sync with public.exercises
-- (the DB-managed catalogue). Without this, an exercise ADDED or EDITED directly in public.exercises
-- (the whole point of the DB-managed catalogue) would have no analytics facts row, so the region-volume
-- views (which LEFT JOIN exercise_facts) would silently attribute its logged sets to NO region and
-- treat it as non-bodyweight.
--
-- Reproduces the exact client contract (scripts/gen-exercise-facts-seed.ts / analytics-facts.test.ts):
--   is_bodyweight_lift = data.equipment ∋ 'bodyweight' AND data.category ∈ {compound, isolation}
--   regions            = DISTINCT region(primary muscle), in first-occurrence order
-- Rehab exercises (category 'rehab') are EXCLUDED, matching the existing facts seed (they aren't
-- volume-tracked). Verified zero-diff against the 55 seeded rows before shipping.
--
-- The muscle→region map is embedded here because the DB has no standalone map (that's precisely why
-- exercise_facts is precomputed). It mirrors src/data/muscles.ts — a fixed anatomy taxonomy; if a
-- muscle's region ever changes there, update this CASE too.

CREATE OR REPLACE FUNCTION public.exercise_region(muscle text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT CASE muscle
    WHEN 'chest' THEN 'push' WHEN 'shoulders' THEN 'push' WHEN 'triceps' THEN 'push'
    WHEN 'biceps' THEN 'pull' WHEN 'forearms' THEN 'pull' WHEN 'back' THEN 'pull'
    WHEN 'lats' THEN 'pull' WHEN 'traps' THEN 'pull'
    WHEN 'lowerback' THEN 'core' WHEN 'abs' THEN 'core'
    WHEN 'quads' THEN 'legs' WHEN 'hamstrings' THEN 'legs'
    WHEN 'glutes' THEN 'legs' WHEN 'calves' THEN 'legs'
    ELSE NULL
  END
$$;

-- The projection for one exercise's data jsonb → distinct regions in first-occurrence order.
CREATE OR REPLACE FUNCTION public.exercise_facts_regions(data jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
  SELECT COALESCE(array_agg(region ORDER BY min_ord), '{}')
  FROM (
    SELECT region, min(ord) AS min_ord
    FROM (
      SELECT public.exercise_region(elem) AS region, ord
      FROM jsonb_array_elements_text(data->'primary') WITH ORDINALITY AS t(elem, ord)
    ) m
    WHERE region IS NOT NULL
    GROUP BY region
  ) r
$$;

CREATE OR REPLACE FUNCTION public.exercises_sync_facts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    DELETE FROM public.exercise_facts WHERE exercise_id = OLD.id;
    RETURN OLD;
  END IF;

  -- Rehab exercises are excluded from the analytics facts (not volume-tracked) — clear any stray row
  -- (e.g. if an existing exercise is recategorised to 'rehab').
  IF (NEW.data->>'category' = 'rehab') THEN
    DELETE FROM public.exercise_facts WHERE exercise_id = NEW.id;
    RETURN NEW;
  END IF;

  INSERT INTO public.exercise_facts (exercise_id, is_bodyweight_lift, regions)
  VALUES (
    NEW.id,
    (NEW.data->'equipment' ? 'bodyweight') AND (NEW.data->>'category' IN ('compound', 'isolation')),
    public.exercise_facts_regions(NEW.data)
  )
  ON CONFLICT (exercise_id) DO UPDATE
    SET is_bodyweight_lift = excluded.is_bodyweight_lift,
        regions            = excluded.regions;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS exercises_sync_facts_trg ON public.exercises;
CREATE TRIGGER exercises_sync_facts_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.exercises
  FOR EACH ROW EXECUTE FUNCTION public.exercises_sync_facts();

-- One-time backfill so exercise_facts is a faithful projection of the current catalogue. Verified
-- to be a no-op against the 55 seeded rows; future inserts/updates/deletes are handled by the trigger.
INSERT INTO public.exercise_facts (exercise_id, is_bodyweight_lift, regions)
SELECT
  e.id,
  (e.data->'equipment' ? 'bodyweight') AND (e.data->>'category' IN ('compound', 'isolation')),
  public.exercise_facts_regions(e.data)
FROM public.exercises e
WHERE e.data->>'category' IS DISTINCT FROM 'rehab'
ON CONFLICT (exercise_id) DO UPDATE
  SET is_bodyweight_lift = excluded.is_bodyweight_lift,
      regions            = excluded.regions;
