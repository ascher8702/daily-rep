-- Subscriptions: one row per user. Mirrors Stripe subscription state and tracks the app-managed,
-- card-free 30-day free trial. Written ONLY by the service role (Stripe webhook) and the signup
-- trigger; users may read their own row but never write it (so nobody can grant themselves Pro).

create table if not exists public.subscriptions (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id   text unique,
  stripe_subscription_id text unique,
  status               text not null default 'trialing',  -- trialing|active|past_due|canceled|incomplete|incomplete_expired|unpaid|paused
  price_id             text,
  plan                 text,                                -- 'monthly' | 'annual' | null
  trial_ends_at        timestamptz,                         -- app-granted, card-free trial end
  current_period_end   timestamptz,                         -- paid period end (from Stripe)
  cancel_at_period_end boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

-- Read-only to the owning user. NO insert/update/delete policies => only the service role
-- (webhook) and SECURITY DEFINER trigger can write, both of which bypass RLS.
drop policy if exists "read own subscription" on public.subscriptions;
create policy "read own subscription" on public.subscriptions
  for select using (auth.uid() = user_id);

-- keep updated_at fresh on writes
create or replace function public.touch_subscriptions_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
drop trigger if exists trg_subscriptions_touch on public.subscriptions;
create trigger trg_subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_subscriptions_updated_at();

-- Auto-provision a 30-day, card-free trial row when a new auth user signs up.
create or replace function public.handle_new_user_subscription()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriptions (user_id, status, trial_ends_at)
  values (new.id, 'trialing', now() + interval '30 days')
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created_subscription on auth.users;
create trigger on_auth_user_created_subscription
  after insert on auth.users
  for each row execute function public.handle_new_user_subscription();

-- Backfill existing users with a fresh 30-day trial row.
insert into public.subscriptions (user_id, status, trial_ends_at)
select id, 'trialing', now() + interval '30 days' from auth.users
on conflict (user_id) do nothing;
