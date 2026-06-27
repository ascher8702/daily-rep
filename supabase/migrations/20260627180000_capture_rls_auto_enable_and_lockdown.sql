-- Adopt the `rls_auto_enable` defensive event trigger into schema-as-code and lock down its grants.
--
-- WHY: this event-trigger function auto-enables Row-Level Security on any newly created table in the
-- `public` schema — defense-in-depth so a future migration that forgets `enable row level security`
-- can't silently ship a world-readable table. It was created out-of-band during the dedicated-project
-- (clobxwwcjlmyckvkongk) cutover; capturing it here keeps the schema reproducible from migrations alone.
--
-- SECURITY: it RETURNS event_trigger, so it can ONLY run as an event trigger — a direct
-- `/rest/v1/rpc/rls_auto_enable` call errors ("can only be called in an event trigger"). Even so we
-- REVOKE EXECUTE from PUBLIC/anon/authenticated so it isn't part of the exposed API surface, which
-- clears Supabase security advisors 0028/0029 (SECURITY DEFINER function executable by anon/authenticated).
-- The event trigger keeps firing regardless of caller EXECUTE grants (it runs as the function owner on DDL).
-- Idempotent: safe to re-run / re-apply over the already-live object.

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

drop event trigger if exists ensure_rls;
create event trigger ensure_rls on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();

revoke all on function public.rls_auto_enable() from public, anon, authenticated;
