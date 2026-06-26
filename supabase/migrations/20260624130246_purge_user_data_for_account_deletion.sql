-- GDPR Art.17 erasure: delete ALL of a user's rows across public + the private analytics schema.
-- SECURITY DEFINER (owned by postgres) so it can reach the analytics schema; service_role-only.
-- The edge function calls this, then auth.admin.deleteUser (which also CASCADE-clears daily_rep_state).
create or replace function public.purge_user_data(p_user uuid)
returns void language plpgsql security definer set search_path to 'pg_catalog', 'public', 'pg_temp' as $$
begin
  delete from public.analytics_session_sets where user_id = p_user;
  delete from public.analytics_sessions     where user_id = p_user;
  delete from public.analytics_profile      where user_id = p_user;
  delete from analytics.user_watermark      where user_id = p_user;
  delete from analytics.reconcile_queue     where user_id = p_user;
  delete from public.daily_rep_state        where user_id = p_user;
end; $$;

revoke execute on function public.purge_user_data(uuid) from public, anon, authenticated;
grant  execute on function public.purge_user_data(uuid) to service_role;
