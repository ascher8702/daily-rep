-- Extend the `rls_auto_enable` defensive event-trigger backstop to cover the `analytics` schema (P2).
--
-- WHY: 20260627180000_capture_rls_auto_enable_and_lockdown adopted an event trigger that auto-enables RLS
-- on any newly created table — but ONLY in schema 'public'. The private `analytics` schema holds bookkeeping
-- tables (analytics.meta / reconcile_queue / user_watermark) that also must never ship without RLS; a future
-- migration that adds an analytics table and forgets `enable row level security` would slip past the backstop.
-- This CREATE OR REPLACE re-defines the function with the allow-list IN-clause extended to ('public',
-- 'analytics'). Everything else (security definer, pinned search_path, the exception handling, the trigger
-- wiring, the EXECUTE revoke) is byte-for-byte identical to the captured version. Idempotent.

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
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public', 'analytics') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
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
