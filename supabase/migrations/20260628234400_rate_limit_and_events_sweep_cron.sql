-- Periodic cleanup for the two ledger tables added in 20260628234205 / 20260628234314 (P3 housekeeping).
-- Both grow monotonically with no reclamation: rate_limit_buckets keeps one row per (endpoint:subject) and
-- only resets the window in place; stripe_events keeps one row per lifetime Stripe event. Volume is low but
-- unbounded — these pg_cron jobs reclaim stale rows. Windows are minutes / Stripe redelivers within days, so
-- the retention horizons below sit safely past any functional need. cron.schedule upserts by job name, so a
-- `db reset` replay re-points the existing jobs rather than duplicating them (pg_cron >= 1.4).

-- rate_limit_buckets: a bucket is dead once its window is well past (the longest window today is
-- delete-account's 10 min). Sweep daily, dropping anything untouched for > 1 day. This also reclaims the
-- 'delete-account:<uid>' bucket of an already-purged account (purge_user_data does not touch this table).
select cron.schedule(
  'rate-limit-buckets-sweep',
  '17 4 * * *',
  $$delete from public.rate_limit_buckets where window_start < now() - interval '1 day'$$
);

-- stripe_events: only needed while Stripe might still redeliver an event (retries span a few days). Keep
-- 90 days for an audit trail, then reclaim.
select cron.schedule(
  'stripe-events-sweep',
  '23 4 * * *',
  $$delete from public.stripe_events where processed_at < now() - interval '90 days'$$
);
