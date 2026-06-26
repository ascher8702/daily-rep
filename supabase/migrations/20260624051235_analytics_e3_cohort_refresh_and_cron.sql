create or replace function analytics.refresh_cohorts_hourly() returns void
  language plpgsql security definer set search_path to 'pg_catalog','pg_temp' as $$
begin
  refresh materialized view concurrently analytics.cohort_dau;
end $$;

create or replace function analytics.refresh_cohorts_nightly() returns void
  language plpgsql security definer set search_path to 'pg_catalog','pg_temp' as $$
begin
  refresh materialized view concurrently analytics.cohort_weekly;
  refresh materialized view concurrently analytics.cohort_retention;
  refresh materialized view concurrently analytics.popular_exercises;
  refresh materialized view concurrently analytics.popular_plans;
end $$;

revoke execute on function analytics.refresh_cohorts_hourly()  from public, anon, authenticated;
revoke execute on function analytics.refresh_cohorts_nightly() from public, anon, authenticated;
grant  execute on function analytics.refresh_cohorts_hourly()  to service_role;
grant  execute on function analytics.refresh_cohorts_nightly() to service_role;

select cron.schedule('analytics-cohort-hourly',  '0 * * * *',  $$ select analytics.refresh_cohorts_hourly(); $$);
select cron.schedule('analytics-cohort-nightly', '30 8 * * *', $$ select analytics.refresh_cohorts_nightly(); $$);
