create view public.v_my_session_volume with (security_invoker = true) as
  select user_id, performed_on, local_week, working_volume, working_volume_kg,
         working_set_count, working_rep_count
  from public.analytics_sessions where user_id = (select auth.uid());

create view public.v_my_exercise_e1rm with (security_invoker = true) as
  select user_id, exercise_id, performed_on, max(e1rm) as best_e1rm, max(e1rm_kg) as best_e1rm_kg
  from public.analytics_session_sets
  where user_id = (select auth.uid()) and is_working and e1rm > 0
  group by user_id, exercise_id, performed_on;

create view public.v_my_exercise_prs with (security_invoker = true) as
  with day_best as (
    select user_id, exercise_id, performed_on, performed_at, max(e1rm) as best_e1rm
    from public.analytics_session_sets
    where user_id = (select auth.uid()) and is_working and e1rm > 0
    group by user_id, exercise_id, performed_on, performed_at),
  w as (
    select *,
      max(best_e1rm) over (partition by exercise_id order by performed_at
        rows between unbounded preceding and 1 preceding) as prior_best,
      row_number() over (partition by exercise_id order by performed_at) as rn
    from day_best)
  select user_id, exercise_id, performed_on, best_e1rm as e1rm, prior_best as previous
  from w where rn > 1 and prior_best is not null and best_e1rm > prior_best;

create view public.v_my_region_volume with (security_invoker = true) as
  select s.user_id, s.performed_on,
         floor(((s.performed_on - date '1970-01-01') + 3)::numeric/7)::int as local_week,
         r.region, count(*) as working_sets,
         sum(s.set_volume) as volume, sum(s.set_volume_kg) as volume_kg
  from public.analytics_session_sets s, unnest(s.regions) as r(region)
  where s.user_id = (select auth.uid()) and s.is_working
  group by s.user_id, s.performed_on, r.region;

create view public.v_my_adherence with (security_invoker = true) as
  select s.user_id, s.local_week, count(distinct s.performed_on) as training_days,
         p.days_per_week as target,
         case when p.days_per_week > 0
              then count(distinct s.performed_on)::numeric / p.days_per_week end as adherence
  from public.analytics_sessions s
  join public.analytics_profile p on p.user_id = s.user_id
  where s.user_id = (select auth.uid())
  group by s.user_id, s.local_week, p.days_per_week;

create function public.my_weekly_streak() returns integer
  language sql stable security invoker set search_path = pg_catalog, public, pg_temp as $$
  with recursive
       weeks as (select distinct local_week from public.analytics_sessions where user_id = (select auth.uid())),
       cur as (select floor(((current_date - date '1970-01-01') + 3)::numeric/7)::int as w),
       start as (select case when exists (select 1 from weeks where local_week = (select w from cur))
                             then (select w from cur) else (select w from cur) - 1 end as s),
       rec as (select (select s from start) as wk, 0 as depth
               union all
               select wk - 1, depth + 1 from rec where exists (select 1 from weeks where local_week = rec.wk))
  select coalesce(max(depth) filter (where exists (select 1 from weeks where local_week = rec.wk)) + 1, 0) from rec;
$$;

create function public.my_volume_percentile()
  returns table(my_volume numeric, cohort_p50 numeric, cohort_n int)
  language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
  declare k constant int := 20; v_me numeric; v_n int; v_p50 numeric;
  begin
    select sum(working_volume_kg) into v_me from public.analytics_sessions
      where user_id = (select auth.uid()) and performed_at >= now() - interval '28 days';
    with per_user as (
      select user_id, sum(working_volume_kg) as vol from public.analytics_sessions
      where performed_at >= now() - interval '28 days' group by user_id)
    select count(*), percentile_cont(0.5) within group (order by vol) into v_n, v_p50 from per_user;
    if v_n < k then return query select v_me, null::numeric, v_n;
    else            return query select v_me, v_p50, v_n; end if;
  end $$;

revoke all on public.v_my_session_volume, public.v_my_exercise_e1rm, public.v_my_exercise_prs,
              public.v_my_region_volume, public.v_my_adherence from anon, public;
grant  select on public.v_my_session_volume, public.v_my_exercise_e1rm, public.v_my_exercise_prs,
              public.v_my_region_volume, public.v_my_adherence to authenticated;

revoke all on function public.my_weekly_streak()       from public, anon;
revoke all on function public.my_volume_percentile()   from public, anon;
grant  execute on function public.my_weekly_streak()     to authenticated;
grant  execute on function public.my_volume_percentile() to authenticated;
