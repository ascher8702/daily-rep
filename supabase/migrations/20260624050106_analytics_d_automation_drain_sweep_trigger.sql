-- drain: dequeue + reconcile (latency path). Per-user advisory lock serializes drain-vs-sweep without
-- blocking the user's live blob push. On error, keep the row queued (retry next tick) + record on watermark.
create or replace function analytics.drain_reconcile_queue(p_limit int default 200)
returns int language plpgsql security definer set search_path to 'pg_catalog','pg_temp' as $$
declare u uuid; n int := 0;
begin
  for u in select user_id from analytics.reconcile_queue order by enqueued_at limit p_limit loop
    if pg_try_advisory_xact_lock(hashtext('analytics_reconcile_' || u::text)) then
      begin
        perform analytics.reconcile_user(u);
        delete from analytics.reconcile_queue where user_id = u;
        n := n + 1;
      exception when others then
        insert into analytics.user_watermark(user_id, last_reconciled_at, last_status, last_error, retry_count)
          values (u, now(), 'error', sqlerrm, 1)
          on conflict (user_id) do update set last_reconciled_at = now(), last_status = 'error',
            last_error = sqlerrm, retry_count = user_watermark.retry_count + 1;
      end;
    end if;
  end loop;
  return n;
end; $$;

-- sweep: the CORRECTNESS FLOOR — reconcile any user whose SERVER updated_at exceeds their watermark
-- (p_full=true ignores the watermark: nightly self-heal for missed enqueues / out-of-band writes).
create or replace function analytics.sweep_stale(p_limit int default 500, p_full boolean default false)
returns int language plpgsql security definer set search_path to 'pg_catalog','pg_temp' as $$
declare u uuid; n int := 0;
begin
  for u in
    select d.user_id from public.daily_rep_state d
    left join analytics.user_watermark wm on wm.user_id = d.user_id
    where p_full or wm.last_blob_updated_at is null or d.updated_at > wm.last_blob_updated_at
    order by d.updated_at limit p_limit
  loop
    if pg_try_advisory_xact_lock(hashtext('analytics_reconcile_' || u::text)) then
      begin
        perform analytics.reconcile_user(u);
        n := n + 1;
      exception when others then
        insert into analytics.user_watermark(user_id, last_reconciled_at, last_status, last_error, retry_count)
          values (u, now(), 'error', sqlerrm, 1)
          on conflict (user_id) do update set last_reconciled_at = now(), last_status = 'error',
            last_error = sqlerrm, retry_count = user_watermark.retry_count + 1;
      end;
    end if;
  end loop;
  return n;
end; $$;

-- enqueue trigger fn (SECURITY DEFINER: the client triggering the UPDATE has no write on analytics.*)
create or replace function analytics.tg_enqueue_reconcile()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','pg_temp' as $$
begin
  insert into analytics.reconcile_queue(user_id) values (new.user_id)
    on conflict (user_id) do update set enqueued_at = now();
  return null;
end; $$;

-- AFTER INSERT (first sync) unconditional; AFTER UPDATE only when the WORKOUTS subtree actually changed.
-- The BEFORE monotonic guard reverts NEW.data on a stale push, so the WHEN sees NEW=OLD → no churn.
drop trigger if exists daily_rep_state_enqueue_ins on public.daily_rep_state;
create trigger daily_rep_state_enqueue_ins
  after insert on public.daily_rep_state
  for each row execute function analytics.tg_enqueue_reconcile();

drop trigger if exists daily_rep_state_enqueue_upd on public.daily_rep_state;
create trigger daily_rep_state_enqueue_upd
  after update on public.daily_rep_state
  for each row when (new.data->'workouts' is distinct from old.data->'workouts')
  execute function analytics.tg_enqueue_reconcile();

revoke execute on function analytics.drain_reconcile_queue(int) from public, anon, authenticated;
revoke execute on function analytics.sweep_stale(int, boolean) from public, anon, authenticated;
grant  execute on function analytics.drain_reconcile_queue(int) to service_role;
grant  execute on function analytics.sweep_stale(int, boolean)  to service_role;
