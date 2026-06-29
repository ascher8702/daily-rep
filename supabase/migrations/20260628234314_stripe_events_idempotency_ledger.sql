-- Stripe webhook idempotency ledger (P3). Stripe delivers each event AT LEAST once and retries on any
-- non-2xx — so the same event id can arrive multiple times (retries, parallel deliveries, replays). Our
-- handlers are written to converge (they re-RETRIEVE the subscription and write current truth), but
-- duplicate processing still spends Stripe API calls and can race concurrent deliveries of the same event.
-- This ledger lets the function short-circuit a duplicate: AFTER signature verification it inserts the
-- event id on-conflict-do-nothing; an already-present id means "already processed" → return 200 immediately.
--
-- Written ONLY by the service-role client inside the (public, signature-verified) stripe-webhook function.

create table if not exists public.stripe_events (
  event_id     text primary key,
  type         text,
  processed_at timestamptz not null default now()
);

comment on table public.stripe_events is
  'Idempotency ledger for the Stripe webhook. One row per processed event id; a present row means the '
  'event was already handled, so a redelivery is acknowledged with 200 without reprocessing. Service-role only.';
comment on column public.stripe_events.event_id is 'Stripe event id (evt_…); primary key, the dedup token.';
comment on column public.stripe_events.type is 'Stripe event type (e.g. customer.subscription.updated), for diagnostics.';
comment on column public.stripe_events.processed_at is 'When this event was first recorded/processed (UTC).';

-- RLS enabled + FORCED (owner included) with NO policies → anon/authenticated denied outright. The
-- service role has BYPASSRLS, so the webhook's writes/reads continue to work; the table is not exposed.
alter table public.stripe_events enable row level security;
alter table public.stripe_events force row level security;
revoke all on table public.stripe_events from anon, authenticated;
