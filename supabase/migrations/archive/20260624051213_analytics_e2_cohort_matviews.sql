-- All cohort matviews live in the PRIVATE analytics schema (anon/authenticated have no USAGE),
-- exclude day_is_estimated sessions from time-cohorting, and count DISTINCT users so one heavy
-- logger can't skew popularity. Unique index on each → REFRESH ... CONCURRENTLY is possible.

create materialized view analytics.cohort_dau as
  select performed_on, count(distinct user_id) as dau
  from public.analytics_sessions where not day_is_estimated group by performed_on;
create unique index cohort_dau_pk on analytics.cohort_dau (performed_on);

create materialized view analytics.cohort_weekly as
  select local_week, count(distinct user_id) as wau,
         count(*)::numeric / nullif(count(distinct user_id),0) as sessions_per_user
  from public.analytics_sessions where not day_is_estimated group by local_week;
create unique index cohort_weekly_pk on analytics.cohort_weekly (local_week);

create materialized view analytics.cohort_retention as
  with firsts as (select user_id, min(local_week) as cohort_week
                  from public.analytics_sessions where not day_is_estimated group by user_id),
       act as (select distinct user_id, local_week
               from public.analytics_sessions where not day_is_estimated)
  select f.cohort_week, a.local_week - f.cohort_week as weeks_since, count(distinct a.user_id) as active_users
  from firsts f join act a using (user_id)
  group by f.cohort_week, a.local_week - f.cohort_week;
create unique index cohort_retention_pk on analytics.cohort_retention (cohort_week, weeks_since);

create materialized view analytics.popular_exercises as
  select exercise_id, count(distinct user_id) as users, count(*) as working_sets
  from public.analytics_session_sets where is_working group by exercise_id;
create unique index popular_exercises_pk on analytics.popular_exercises (exercise_id);

-- popular_plans: analytics_sessions carries plan_id, so the "same shape for plan_id" the spec noted is buildable
create materialized view analytics.popular_plans as
  select plan_id, count(distinct user_id) as users, count(*) as sessions
  from public.analytics_sessions where plan_id is not null and plan_id <> '' group by plan_id;
create unique index popular_plans_pk on analytics.popular_plans (plan_id);
