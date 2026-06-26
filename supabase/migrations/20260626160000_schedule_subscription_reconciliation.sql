-- Schedule the reconcile-subscriptions Edge Function (the missed-webhook safety net) via pg_cron + pg_net.
--
-- ONE-TIME [HUMAN] before this runs effectively:
--   1. Deploy the function:  supabase functions deploy reconcile-subscriptions
--   2. Set its shared secret:  supabase secrets set RECONCILE_SECRET=<random>
--   3. Store the URL + secret in Vault so they aren't committed here:
--        select vault.create_secret('https://<ref>.supabase.co/functions/v1/reconcile-subscriptions', 'reconcile_url');
--        select vault.create_secret('<same RECONCILE_SECRET>', 'reconcile_secret');
--
-- Creating the schedule is safe before the Vault secrets exist: the inner SELECTs are evaluated per run,
-- so until they're set the job simply posts to a null URL and pg_net logs an error (no data impact).
--
-- NOTE: not yet applied to the shared prod project — apply via the dedicated-project cutover / db push.

create extension if not exists pg_net;
-- pg_cron is normally created by the analytics migrations; ensure it here too so this migration is
-- self-sufficient on a fresh/dedicated project that doesn't replay the analytics history.
create extension if not exists pg_cron;

-- Idempotent (re)schedule: drop any prior job of this name, then create it. Runs every 6 hours (offset
-- to avoid the top-of-hour analytics cron pile-up).
do $$
begin
  perform cron.unschedule('reconcile-subscriptions-6h');
exception when others then
  null; -- not previously scheduled
end $$;

select cron.schedule(
  'reconcile-subscriptions-6h',
  '17 */6 * * *',
  $cron$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'reconcile_url'),
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'x-reconcile-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'reconcile_secret')
    ),
    body    := '{}'::jsonb
  );
  $cron$
);
