-- Defense-in-depth: scope the four own-row policies to the `authenticated` role instead of
-- PUBLIC. Same USING/WITH CHECK expressions (incl. the (select auth.uid()) wrapper the perf
-- linter prefers). Authenticated users are unaffected (the JS client always acts as that role
-- after sign-in); anon — which already has zero table grants and matches zero rows — loses an
-- already-non-functional code path. Drop+create because Postgres can't ALTER a policy's roles.
DROP POLICY IF EXISTS fitforge_state_select_own ON public.fitforge_state;
CREATE POLICY fitforge_state_select_own ON public.fitforge_state
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS fitforge_state_insert_own ON public.fitforge_state;
CREATE POLICY fitforge_state_insert_own ON public.fitforge_state
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS fitforge_state_update_own ON public.fitforge_state;
CREATE POLICY fitforge_state_update_own ON public.fitforge_state
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS fitforge_state_delete_own ON public.fitforge_state;
CREATE POLICY fitforge_state_delete_own ON public.fitforge_state
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);
