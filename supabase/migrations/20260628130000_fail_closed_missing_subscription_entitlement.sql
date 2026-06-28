-- Missing subscription rows must fail closed.
--
-- The signup trigger should seed public.subscriptions in the same transaction as auth.users. If a row
-- is absent, the server cannot prove trial/subscription access, so writes to daily_rep_state are denied
-- until provisioning is repaired. This removes the last server-side paywall fail-open path.

create or replace function public.is_active_subscriber()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when (select auth.uid()) is null then false
    when not exists (select 1 from public.subscriptions where user_id = (select auth.uid())) then false
    else exists (
      select 1
      from public.subscriptions s
      where s.user_id = (select auth.uid())
        and (
          (s.stripe_subscription_id is not null and s.status in ('active', 'trialing', 'past_due'))
          or (s.trial_ends_at > now())
          or (
            s.stripe_subscription_id is not null
            and s.current_period_end > now()
            and s.status not in ('unpaid', 'incomplete', 'incomplete_expired')
          )
        )
    )
  end
$$;

revoke all on function public.is_active_subscriber() from public, anon;
grant execute on function public.is_active_subscriber() to authenticated, service_role;
