-- Trial-abuse mitigation (P1). The signup trigger previously granted a fresh 30-day, card-free trial to
-- EVERY new auth user with no dedup — so deleting an account and re-signing up (FK-cascade drops the old
-- subscriptions row) or using a new address farmed unlimited trials. This adds a normalized-email ledger
-- that persists across account deletion, so a given email gets the free trial ONCE.
--
-- POLICY NOTE (tunable): normalization lowercases + trims, and for gmail.com/googlemail.com strips dots
-- and any +suffix (Gmail treats these as the same inbox) → one trial per real Gmail inbox. Other
-- providers are only lowercased/trimmed (no +tag stripping) to avoid false-positives across legitimately
-- distinct addresses. Tighten/loosen here if product wants a different stance. A determined abuser can
-- still use disposable domains; pair with email-confirmation + CAPTCHA (already scaffolded) for defense.
--
-- NOTE: not yet applied to the shared prod project. The normalize_email logic was validated against the
-- live engine (synthetic addresses) before commit. Apply via the dedicated-project cutover / db push.

-- Canonical inbox key for an email. IMMUTABLE + pinned search_path.
create or replace function public.normalize_email(p_email text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_email is null or btrim(p_email) = '' then null
    else (
      with parts as (
        select lower(btrim(split_part(p_email, '@', 1))) as local_part,
               lower(btrim(split_part(p_email, '@', 2))) as domain
      )
      select case
        when domain in ('gmail.com', 'googlemail.com')
          then replace(split_part(local_part, '+', 1), '.', '') || '@gmail.com'
        else local_part || '@' || domain
      end
      from parts
    )
  end
$$;

-- One row per inbox that has ever been granted the free trial. Deliberately NOT keyed to auth.users
-- (no FK), so it SURVIVES account deletion — that's the whole point. Service-role / definer-trigger only.
create table if not exists public.trial_ledger (
  normalized_email text primary key,
  first_user_id    uuid,
  first_granted_at timestamptz not null default now()
);
alter table public.trial_ledger enable row level security;
-- No policies → anon/authenticated have no access; the SECURITY DEFINER trigger and service_role bypass RLS.
revoke all on table public.trial_ledger from anon, authenticated;

-- Re-provision the signup trigger to grant the trial only on the FIRST claim per normalized email.
-- search_path = '' (NOT 'public') to preserve the hardening from 20260625001352 — every object below is
-- already fully schema-qualified, so this is behavior-identical and keeps advisor 0011 satisfied.
create or replace function public.handle_new_user_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_norm  text := public.normalize_email(new.email);
  v_trial timestamptz;
begin
  if v_norm is null then
    -- No usable email (e.g. phone-only signup) → can't dedup; grant the trial rather than block signup.
    v_trial := now() + interval '30 days';
  else
    insert into public.trial_ledger (normalized_email, first_user_id)
    values (v_norm, new.id)
    on conflict (normalized_email) do nothing;
    -- FOUND is true iff this INSERT actually added a row (i.e. first ever claim for this inbox).
    if found then
      v_trial := now() + interval '30 days';
    else
      v_trial := null; -- inbox already used its trial → no free window; user must subscribe
    end if;
  end if;

  -- INVARIANT: entitlement is decided by (stripe_subscription_id, trial_ends_at, current_period_end),
  -- NEVER by status alone. The repeat-claim row has status='trialing' but trial_ends_at=NULL and no sub,
  -- which deriveEntitlement / is_active_subscriber both read as NOT entitled (→ paywall + write-blocked).
  -- Do not add code that grants access on status='trialing' without also checking trial_ends_at.
  insert into public.subscriptions (user_id, status, trial_ends_at)
  values (new.id, 'trialing', v_trial)
  on conflict (user_id) do nothing;
  return new;
end
$$;

-- Backfill the ledger from existing users so a current user can't delete + re-signup for a new trial.
insert into public.trial_ledger (normalized_email, first_user_id, first_granted_at)
select distinct on (public.normalize_email(email))
  public.normalize_email(email), id, coalesce(created_at, now())
from auth.users
where public.normalize_email(email) is not null
order by public.normalize_email(email), created_at asc
on conflict (normalized_email) do nothing;
