create extension if not exists pg_cron;

-- drain the enqueue queue every minute (latency path)
select cron.schedule('analytics-drain', '* * * * *', $$ select analytics.drain_reconcile_queue(200); $$);

-- correctness floor: every 15m reconcile anyone whose SERVER updated_at outran their watermark
select cron.schedule('analytics-sweep', '*/15 * * * *', $$ select analytics.sweep_stale(500, false); $$);

-- nightly full self-heal (08:00 UTC ~ small-hours US) ignores the watermark to catch any missed user
select cron.schedule('analytics-nightly-full', '0 8 * * *', $$ select analytics.sweep_stale(100000, true); $$);
