-- Recovery queue for Stripe cleanup that FAILED during account deletion.
--
-- Account deletion (GDPR Art.17 erasure) must still complete even if the Stripe call to cancel the
-- subscription / delete the customer fails transiently. But we must NOT silently keep billing a
-- now-deleted account. The subscriptions row (and the only stripe_customer_id / stripe_subscription_id
-- mapping) is destroyed by ON DELETE CASCADE when the auth user is removed — so before purging, a failed
-- cleanup stashes just those ids here. This table is intentionally NOT linked to auth.users (no cascade),
-- so it survives the purge and a scheduled job can retry the cancellation and then clear the row.
create table if not exists public.pending_stripe_cleanup (
  id uuid primary key default gen_random_uuid(),
  stripe_customer_id text,
  stripe_subscription_id text,
  reason text,
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.pending_stripe_cleanup is
  'Stripe ids whose cancellation failed during account deletion; drained/retried by a scheduled job. Service-role only.';

-- Service-role only: enable RLS and grant NOTHING to anon/authenticated, so these billing ids are never
-- readable by clients. The Edge Functions use the service role, which bypasses RLS.
alter table public.pending_stripe_cleanup enable row level security;
revoke all on public.pending_stripe_cleanup from anon, authenticated;
