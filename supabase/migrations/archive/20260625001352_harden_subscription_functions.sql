-- Security hardening for the subscriptions trigger helpers (Supabase advisors 0011 / 0028 / 0029).
-- Both functions are trigger-only — they must not be callable via the PostgREST RPC API, and both get
-- a pinned, empty search_path. Triggers continue to fire after the EXECUTE revoke (the trigger mechanism
-- doesn't require EXECUTE for the triggering role), and fully-qualified object refs make search_path=''
-- safe.

create or replace function public.touch_subscriptions_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create or replace function public.handle_new_user_subscription()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.subscriptions (user_id, status, trial_ends_at)
  values (new.id, 'trialing', now() + interval '30 days')
  on conflict (user_id) do nothing;
  return new;
end $$;

revoke all on function public.handle_new_user_subscription() from public, anon, authenticated;
revoke all on function public.touch_subscriptions_updated_at() from public, anon, authenticated;
