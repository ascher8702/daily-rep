-- Integrity guards + observability docs for the offline-first state blob.
-- All additive / non-breaking: the client's 3-column upsert (user_id, data, client_updated_at)
-- still satisfies every guard, and offline-first / local-only use is unaffected.

-- 1) Backstop the LWW logical clock with a sane server default + backfill any NULLs.
--    The client always sends its own ISO value; the DEFAULT only fires on out-of-band writes
--    (manual fixes, seeding, future server inserts), preventing a NULL clock (== time 0) clobber.
ALTER TABLE public.fitforge_state
  ALTER COLUMN client_updated_at SET DEFAULT now();

UPDATE public.fitforge_state
  SET client_updated_at = COALESCE(client_updated_at, updated_at, now())
  WHERE client_updated_at IS NULL;

-- 2) Codify the existing client invariant that the blob is a JSON object (mergePersisted spreads it).
--    Table is empty and DEFAULT '{}' satisfies it, so this never rejects a legitimate client write.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.fitforge_state'::regclass
      AND conname = 'fitforge_state_data_is_object'
  ) THEN
    ALTER TABLE public.fitforge_state
      ADD CONSTRAINT fitforge_state_data_is_object
      CHECK (jsonb_typeof(data) = 'object');
  END IF;
END $$;

-- 3) Column documentation — observability + institutional memory (COMMENT is idempotent).
COMMENT ON COLUMN public.fitforge_state.user_id IS
  'PK and FK -> auth.users(id) ON DELETE CASCADE. RLS scopes every row to (SELECT auth.uid()) = user_id. Deleting the auth user erases this row automatically (GDPR right-to-erasure for cloud data); on-device localStorage (fitforge-v1) is NOT covered and must be cleared client-side.';
COMMENT ON COLUMN public.fitforge_state.data IS
  'Mirror of the partialized Zustand store (localStorage key fitforge-v1): profile, workouts[], current session, activePlan, customPlans, planProgress, planOverrides, units. Last-write-wins; client is source of truth. Unbounded JSONB; must be a JSON object (enforced by fitforge_state_data_is_object).';
COMMENT ON COLUMN public.fitforge_state.client_updated_at IS
  'Client LWW logical clock (new Date().toISOString()) set by sync.ts pushNow(). pullAndReconcile() adopts cloud only when this is strictly newer than the local clock; a NULL value is treated as time 0. DEFAULT now() backstops out-of-band writes.';
COMMENT ON COLUMN public.fitforge_state.updated_at IS
  'Server clock maintained by trigger fitforge_state_touch (BEFORE UPDATE -> fitforge_touch_updated_at, sets now()). Observability only; do NOT use for reconciliation — use client_updated_at.';
COMMENT ON COLUMN public.fitforge_state.created_at IS
  'Server insert time (DEFAULT now()).';
COMMENT ON COLUMN public.fitforge_state.schema_version IS
  'Reserved blob-shape version for forward-compat. As of 2026-06-23 the client does NOT read or write this (sync.ts sends only data + client_updated_at); it always stays at DEFAULT 1. Distinct from the Zustand persist version in useStore.ts. Before relying on it, wire a CLIENT_BLOB_VERSION constant into sync.ts and gate cloud adoption on it.';
