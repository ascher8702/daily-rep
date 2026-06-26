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
