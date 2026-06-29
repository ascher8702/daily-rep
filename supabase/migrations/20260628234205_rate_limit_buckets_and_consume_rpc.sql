-- Durable, cross-instance rate-limit store (P2). The Edge Functions' in-memory fixed-window limiter
-- (supabase/functions/_shared/rateLimit.ts) is PER WARM INSTANCE: under concurrency the platform fans a
-- caller across many instances, so the sensitive delete-account budget (3 per 10min per uid) is dilutable
-- — each instance keeps its own Map. This adds a shared Postgres-backed bucket table + an atomic RPC so
-- the budget is enforced GLOBALLY across instances. delete-account uses it via the service-role client,
-- with a fail-open fallback to the in-memory store if the RPC errors (matching the function's existing
-- posture: never block a legitimate irreversible-erasure request on a limiter outage).
--
-- The table holds one row per bucket key (e.g. 'delete-account:<uid>'); the RPC upserts it inside a single
-- statement so concurrent calls can't double-spend. Service-role / definer only — never client-reachable.

create table if not exists public.rate_limit_buckets (
  bucket_key   text primary key,
  window_start timestamptz not null,
  count        int not null
);

comment on table public.rate_limit_buckets is
  'Cross-instance fixed-window rate-limit counters. One row per bucket key (e.g. "delete-account:<uid>"). '
  'Written ONLY by consume_rate_limit() (SECURITY DEFINER) / the service role; no client access.';
comment on column public.rate_limit_buckets.bucket_key is 'Opaque per-endpoint+subject key, e.g. "delete-account:<uid>".';
comment on column public.rate_limit_buckets.window_start is 'Start of the current fixed window (UTC).';
comment on column public.rate_limit_buckets.count is 'Hits consumed so far in the current window.';

-- RLS enabled + FORCED (so even the table owner is subject to it) with NO policies → anon/authenticated
-- are denied outright. service_role has BYPASSRLS and the SECURITY DEFINER RPC runs as its owner, so the
-- limiter machinery keeps working; the table is simply not part of the exposed API surface.
alter table public.rate_limit_buckets enable row level security;
alter table public.rate_limit_buckets force row level security;
revoke all on table public.rate_limit_buckets from anon, authenticated;

-- Atomic consume-one-from-the-window. Returns true if the hit is ALLOWED (within budget), false if the
-- budget for the current window is already spent. A single upsert performs the read-modify-write so
-- concurrent invocations serialise on the PK row and cannot double-spend. The window resets lazily: when
-- the stored window has elapsed, the upsert restarts it at now() with count = 1.
--
-- search_path pinned (advisor 0011); SECURITY DEFINER so it writes the table regardless of caller RLS.
create or replace function public.consume_rate_limit(
  p_key text,
  p_limit int,
  p_window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  v_now    timestamptz := now();
  v_count  int;
begin
  if p_key is null or p_limit is null or p_limit < 1 or p_window_seconds is null or p_window_seconds < 1 then
    -- Misconfigured call → fail OPEN (allow) rather than wedge a legitimate request on a bad budget.
    return true;
  end if;

  insert into public.rate_limit_buckets (bucket_key, window_start, count)
  values (p_key, v_now, 1)
  on conflict (bucket_key) do update
    set
      -- Window elapsed → start a fresh window at now() with count 1; else increment within the window.
      window_start = case
        when public.rate_limit_buckets.window_start + make_interval(secs => p_window_seconds) <= v_now
          then v_now
        else public.rate_limit_buckets.window_start
      end,
      count = case
        when public.rate_limit_buckets.window_start + make_interval(secs => p_window_seconds) <= v_now
          then 1
        else public.rate_limit_buckets.count + 1
      end
  returning count into v_count;

  -- Allowed iff this hit did not push the window's count over the limit.
  return v_count <= p_limit;
end;
$$;

revoke all on function public.consume_rate_limit(text, int, int) from public, anon, authenticated;
grant  execute on function public.consume_rate_limit(text, int, int) to service_role;
