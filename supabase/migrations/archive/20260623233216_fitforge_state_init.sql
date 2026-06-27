-- FitForge cloud sync (offline-first): one per-user state blob mirroring the local Zustand store.
-- Coexists with the project's existing tables; RLS isolates each user's data.
create table if not exists public.fitforge_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  -- the client's logical "last edited" time, for offline-first last-write-wins conflict resolution
  client_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  schema_version int not null default 1
);

comment on table public.fitforge_state is 'FitForge: per-user app-state blob synced from the local Zustand store (offline-first).';

alter table public.fitforge_state enable row level security;

-- a user may only read/write their OWN row
create policy "fitforge_state_select_own" on public.fitforge_state
  for select using ((select auth.uid()) = user_id);
create policy "fitforge_state_insert_own" on public.fitforge_state
  for insert with check ((select auth.uid()) = user_id);
create policy "fitforge_state_update_own" on public.fitforge_state
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "fitforge_state_delete_own" on public.fitforge_state
  for delete using ((select auth.uid()) = user_id);

-- keep updated_at fresh on every write
create or replace function public.fitforge_touch_updated_at()
  returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger fitforge_state_touch
  before update on public.fitforge_state
  for each row execute function public.fitforge_touch_updated_at();
