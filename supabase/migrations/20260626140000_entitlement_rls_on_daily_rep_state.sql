-- Server-side entitlement enforcement (P0). The paywall was client-only and fails open in
-- offline/local/cache-miss paths, so a determined account holder could keep full cloud access for free.
-- This gates WRITES to public.daily_rep_state behind an active subscription/trial, in addition to the
-- client gate (which stays as UX). Reads and deletes remain owner-only and ungated, so a lapsed user can
-- ALWAYS still read and export their own data and delete their account (GDPR) — they just can't sync new
-- data up. This mirrors src/lib/billing.ts deriveEntitlement(...).entitled exactly (kept in parity by
-- src/__tests__/entitlement-parity.test.ts).
--
-- NOTE: not yet applied to the shared production project. Review + apply via the dedicated-project
-- cutover (or a reviewed `supabase db push`). The predicate logic was validated against the live engine
-- before commit (synthetic rows, nothing created).

-- is_active_subscriber(): true iff the CALLER currently has access. No argument — it reads auth.uid()
-- internally so an authenticated user can't probe another user's subscription state. SECURITY DEFINER so
-- it can read public.subscriptions regardless of the caller's RLS.
create or replace function public.is_active_subscriber()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when (select auth.uid()) is null then false
    -- Fail OPEN when no row exists yet (signup-trigger provisioning gap) so a brand-new user is never
    -- locked out of their first sync. A genuinely lapsed user ALWAYS has a row (status persists), and
    -- users cannot delete their subscriptions row (no delete policy), so this branch can't be abused.
    when not exists (select 1 from public.subscriptions where user_id = (select auth.uid())) then true
    else exists (
      select 1
      from public.subscriptions s
      where s.user_id = (select auth.uid())
        and (
          -- hasSubscription: a live (paid or trialing) Stripe subscription
          (s.stripe_subscription_id is not null and s.status in ('active', 'trialing', 'past_due'))
          -- trialActive: still inside the app-granted, card-free trial window
          or (s.trial_ends_at > now())
          -- paidPeriodActive: canceled-but-paid-through (honor already-paid time), excluding never-paid statuses
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

-- Gate writes. SELECT + DELETE policies are intentionally left unchanged (owner-only, ungated).
drop policy if exists daily_rep_state_insert_own on public.daily_rep_state;
create policy daily_rep_state_insert_own on public.daily_rep_state
  for insert to authenticated
  with check ((select auth.uid()) = user_id and public.is_active_subscriber());

drop policy if exists daily_rep_state_update_own on public.daily_rep_state;
create policy daily_rep_state_update_own on public.daily_rep_state
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and public.is_active_subscriber());
