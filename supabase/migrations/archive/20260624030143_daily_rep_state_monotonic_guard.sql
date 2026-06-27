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
