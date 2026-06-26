-- Migration A: private analytics schema + bookkeeping (queue, watermark, meta) for the session-analytics
-- projection. Cohort matviews/rollups will live here later; no client USAGE so matviews are protected by
-- schema-USAGE denial alone. (Per the multi-round design; correctness floor = watermark vs sweep.)
CREATE SCHEMA IF NOT EXISTS analytics AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA analytics FROM PUBLIC;
GRANT USAGE ON SCHEMA analytics TO service_role;

CREATE TABLE analytics.meta (
  id             smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  schema_version integer  NOT NULL DEFAULT 1,   -- bump on formula change OR exercise_facts reseed → re-derive all
  facts_version  integer  NOT NULL DEFAULT 1
);
INSERT INTO analytics.meta (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE analytics.reconcile_queue (
  user_id     uuid PRIMARY KEY,
  enqueued_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX queue_enqueued_idx ON analytics.reconcile_queue (enqueued_at);

CREATE TABLE analytics.user_watermark (
  user_id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  last_blob_updated_at timestamptz,   -- SERVER daily_rep_state.updated_at last reconciled (monotonic, skew-proof)
  last_reconciled_at   timestamptz,
  last_status          text,          -- ok | error | suspect_empty
  last_error           text,
  retry_count          integer NOT NULL DEFAULT 0
);

REVOKE ALL ON ALL TABLES IN SCHEMA analytics FROM anon, authenticated;

CREATE TYPE analytics.reconcile_result AS (sessions int, sets int, deleted int);
