-- Epley 1RM mirroring src/lib/format.ts estimate1RM EXACTLY (integer; reps=1 passthrough; zero guard).
create or replace function analytics.epley_1rm(p_w numeric, p_reps int)
returns numeric language sql immutable set search_path to 'pg_catalog' as
$$ select case
     when coalesce(p_w,0) = 0 or coalesce(p_reps,0) = 0 then 0
     when p_reps = 1 then p_w
     else round(p_w * (1 + p_reps / 30.0))
   end $$;

-- reconcile_user: a user's projection := pure, idempotent function of their CURRENT blob.
-- Watermark = SERVER updated_at (skew-proof). Per-session fingerprint skip avoids re-exploding unchanged
-- sessions. Never reads data->'current' (active session). Math matches stats.ts (effectiveLoad/Epley/volume).
create or replace function analytics.reconcile_user(p_user uuid)
returns analytics.reconcile_result
language plpgsql security definer set search_path to 'pg_catalog','pg_temp'
as $$
declare
  v_data jsonb; v_updated timestamptz; v_schema int;
  v_unit text; v_prof_bw numeric; v_days int;
  w jsonb; v_sid text; v_epoch bigint; v_tz int;
  v_perf_at timestamptz; v_perf_on date; v_week int; v_est boolean;
  v_bw numeric; v_bw_kg numeric; v_fp text; v_old_fp text; v_old_ver int;
  v_keep text[] := '{}'; r analytics.reconcile_result := (0,0,0); v_deleted int;
begin
  select data, updated_at into v_data, v_updated
    from public.daily_rep_state where user_id = p_user;
  if v_data is null then
    insert into analytics.user_watermark(user_id, last_reconciled_at, last_status)
      values (p_user, now(), 'suspect_empty')
      on conflict (user_id) do update set last_reconciled_at = now(), last_status = 'suspect_empty';
    return r;
  end if;

  select schema_version into v_schema from analytics.meta where id = 1;
  v_unit := coalesce(v_data->'profile'->>'unit', 'lb');
  if v_unit not in ('lb','kg') then v_unit := 'lb'; end if;
  v_prof_bw := nullif(v_data->'profile'->>'bodyweight','')::numeric;
  v_days    := nullif(v_data->'profile'->>'daysPerWeek','')::int;

  insert into public.analytics_profile(user_id, unit, bodyweight, days_per_week, updated_at)
    values (p_user, v_unit, v_prof_bw, v_days, now())
    on conflict (user_id) do update set unit = excluded.unit, bodyweight = excluded.bodyweight,
      days_per_week = excluded.days_per_week, updated_at = now();

  for w in select e from jsonb_array_elements(coalesce(v_data->'workouts','[]'::jsonb)) e
  loop
    if not analytics.is_projectable(w) then continue; end if;
    v_sid := w->>'id';
    v_keep := array_append(v_keep, v_sid);

    v_epoch := coalesce(nullif(w->>'completedAt','')::bigint, nullif(w->>'date','')::bigint, 0);
    v_tz := nullif(w->>'tzOffsetMin','')::int;
    v_perf_at := to_timestamp(v_epoch / 1000.0);
    if v_tz is not null then
      v_perf_on := (to_timestamp((v_epoch - v_tz * 60000) / 1000.0) at time zone 'UTC')::date;
      v_est := false;
    else
      v_perf_on := (v_perf_at at time zone 'UTC')::date;
      v_est := true;
    end if;
    -- localWeek = floor((localDay+3)/7); localDay = floor(localEpochMs/86400000)
    v_week := floor((floor((v_epoch - coalesce(v_tz,0) * 60000) / 86400000.0) + 3) / 7.0)::int;

    v_bw := coalesce(nullif(w->>'bodyweight','')::numeric, v_prof_bw, case when v_unit = 'kg' then 70 else 155 end);
    v_bw_kg := analytics.to_kg(v_bw, v_unit);

    -- fingerprint over the projection-relevant subtree (ordered → deterministic; over-sensitive is safe)
    v_fp := md5(
      v_unit || '|' || coalesce(w->>'bodyweight','') || '|' || v_epoch::text || '|' || coalesce(w->>'tzOffsetMin','') || '|' ||
      coalesce((
        select string_agg(
          (ex->>'exerciseId') || ':' || coalesce(ex->>'planSlot','') || ':' || coalesce(ex->>'instanceId','') || '#' ||
          coalesce((
            select string_agg(
              (st->>'id') || ',' || coalesce((st->>'weight')::numeric::text,'0') || ',' || coalesce((st->>'reps')::numeric::text,'0') || ',' ||
              coalesce(st->>'done','false') || ',' || coalesce(st->>'warmup','false') || ',' || coalesce(st->>'rpe',''),
              ';' order by sord)
            from jsonb_array_elements(coalesce(ex->'sets','[]'::jsonb)) with ordinality as s(st, sord)
          ), ''),
          '|' order by exord)
        from jsonb_array_elements(coalesce(w->'exercises','[]'::jsonb)) with ordinality as e(ex, exord)
      ), '')
    );

    select fingerprint, schema_version into v_old_fp, v_old_ver
      from public.analytics_sessions where user_id = p_user and session_id = v_sid;
    if v_old_fp is not distinct from v_fp and v_old_ver is not distinct from v_schema then
      continue; -- unchanged → skip re-explode
    end if;

    insert into public.analytics_sessions(user_id, session_id, performed_at, performed_on, local_week, day_is_estimated,
        started_at, completed_at, title, unit, bodyweight, bodyweight_kg, duration_min, focus, gen_focus, plan_id,
        plan_day_label, fingerprint, blob_updated_at, schema_version, projected_at)
      values (p_user, v_sid, v_perf_at, v_perf_on, v_week, v_est,
        to_timestamp(nullif(w->>'startedAt','')::bigint / 1000.0),
        to_timestamp(nullif(w->>'completedAt','')::bigint / 1000.0),
        coalesce(w->>'title',''), v_unit, v_bw, v_bw_kg, nullif(w->>'durationMin','')::int,
        coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(w->'focus','[]'::jsonb))), '{}'),
        (select array_agg(value) from jsonb_array_elements_text(coalesce(w->'genFocus','[]'::jsonb))),
        w->>'planId', w->>'planDayLabel', v_fp, v_updated, v_schema, now())
      on conflict (user_id, session_id) do update set
        performed_at = excluded.performed_at, performed_on = excluded.performed_on, local_week = excluded.local_week,
        day_is_estimated = excluded.day_is_estimated, started_at = excluded.started_at, completed_at = excluded.completed_at,
        title = excluded.title, unit = excluded.unit, bodyweight = excluded.bodyweight, bodyweight_kg = excluded.bodyweight_kg,
        duration_min = excluded.duration_min, focus = excluded.focus, gen_focus = excluded.gen_focus, plan_id = excluded.plan_id,
        plan_day_label = excluded.plan_day_label, fingerprint = excluded.fingerprint, blob_updated_at = excluded.blob_updated_at,
        schema_version = excluded.schema_version, projected_at = now();

    delete from public.analytics_session_sets where user_id = p_user and session_id = v_sid;

    insert into public.analytics_session_sets(user_id, session_id, set_id, performed_at, performed_on, exercise_id, instance_id,
        plan_lift_id, plan_slot, superset_group, exercise_order, set_order, target_rep_low, target_rep_high, regions,
        is_bodyweight_lift, unit, weight, reps, rpe, done, warmup, effective_weight, effective_weight_kg, e1rm, e1rm_kg,
        set_volume, set_volume_kg, schema_version)
    select p_user, v_sid, sto.st->>'id', v_perf_at, v_perf_on, exo.ex->>'exerciseId', exo.ex->>'instanceId',
        exo.ex->>'planLiftId', nullif(exo.ex->>'planSlot','')::int, exo.ex->>'group', exo.exord::int, sto.setord::int,
        nullif(exo.ex->'targetReps'->>0,'')::int, nullif(exo.ex->'targetReps'->>1,'')::int,
        coalesce(ef.regions, '{}'), coalesce(ef.is_bodyweight_lift, false), v_unit,
        coalesce((sto.st->>'weight')::numeric, 0), coalesce((sto.st->>'reps')::int, 0), nullif(sto.st->>'rpe','')::numeric,
        coalesce((sto.st->>'done')::boolean, false), coalesce((sto.st->>'warmup')::boolean, false),
        ewc.ew, analytics.to_kg(ewc.ew, v_unit),
        analytics.epley_1rm(ewc.ew, coalesce((sto.st->>'reps')::int, 0)),
        analytics.to_kg(analytics.epley_1rm(ewc.ew, coalesce((sto.st->>'reps')::int, 0)), v_unit),
        case when coalesce((sto.st->>'done')::boolean,false) and not coalesce((sto.st->>'warmup')::boolean,false)
             then ewc.ew * coalesce((sto.st->>'reps')::numeric, 0) else 0 end,
        analytics.to_kg(case when coalesce((sto.st->>'done')::boolean,false) and not coalesce((sto.st->>'warmup')::boolean,false)
             then ewc.ew * coalesce((sto.st->>'reps')::numeric, 0) else 0 end, v_unit),
        v_schema
    from jsonb_array_elements(coalesce(w->'exercises','[]'::jsonb)) with ordinality as exo(ex, exord)
    cross join lateral jsonb_array_elements(coalesce(exo.ex->'sets','[]'::jsonb)) with ordinality as sto(st, setord)
    left join public.exercise_facts ef on ef.exercise_id = exo.ex->>'exerciseId'
    cross join lateral (select analytics.effective_weight(coalesce(ef.is_bodyweight_lift,false), v_bw,
                                 coalesce((sto.st->>'weight')::numeric, 0)) as ew) ewc
    where sto.st->>'id' is not null;

    update public.analytics_sessions s set
      working_volume = t.vol, working_volume_kg = t.vol_kg, working_set_count = t.cnt,
      working_rep_count = t.reps, exercise_count = t.exc
    from (
      select coalesce(sum(set_volume),0) vol, coalesce(sum(set_volume_kg),0) vol_kg,
             count(*) filter (where is_working) cnt, coalesce(sum(reps) filter (where is_working),0) reps,
             count(distinct exercise_id) filter (where is_working) exc
      from public.analytics_session_sets where user_id = p_user and session_id = v_sid
    ) t
    where s.user_id = p_user and s.session_id = v_sid;

    r.sessions := r.sessions + 1;
  end loop;

  delete from public.analytics_sessions where user_id = p_user and not (session_id = any(v_keep));
  get diagnostics v_deleted = row_count;
  r.deleted := v_deleted;
  select coalesce(sum(working_set_count),0) into r.sets from public.analytics_sessions where user_id = p_user;

  insert into analytics.user_watermark(user_id, last_blob_updated_at, last_reconciled_at, last_status, last_error, retry_count)
    values (p_user, v_updated, now(), 'ok', null, 0)
    on conflict (user_id) do update set
      last_blob_updated_at = greatest(user_watermark.last_blob_updated_at, excluded.last_blob_updated_at),
      last_reconciled_at = now(), last_status = 'ok', last_error = null, retry_count = 0;
  return r;
end;
$$;

-- backfill: reconcile every existing user, each in its own subtransaction (one bad blob can't abort the run).
create or replace function analytics.backfill_projection()
returns int language plpgsql security definer set search_path to 'pg_catalog','pg_temp'
as $$
declare u uuid; n int := 0;
begin
  for u in select user_id from public.daily_rep_state loop
    begin
      perform analytics.reconcile_user(u);
      n := n + 1;
    exception when others then
      insert into analytics.user_watermark(user_id, last_reconciled_at, last_status, last_error, retry_count)
        values (u, now(), 'error', sqlerrm, 1)
        on conflict (user_id) do update set last_reconciled_at = now(), last_status = 'error',
          last_error = sqlerrm, retry_count = user_watermark.retry_count + 1;
    end;
  end loop;
  return n;
end;
$$;

-- definer functions: deny client EXECUTE, allow service_role (cron/backend).
revoke execute on function analytics.reconcile_user(uuid)   from public, anon, authenticated;
revoke execute on function analytics.backfill_projection()  from public, anon, authenticated;
grant  execute on function analytics.reconcile_user(uuid)   to service_role;
grant  execute on function analytics.backfill_projection()  to service_role;
