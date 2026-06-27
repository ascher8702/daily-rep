-- Cleanup: drop the last orphaned object from the unrelated legacy (Tesla/Jolte) app that shared this
-- project. `20260623235631_drop_legacy_jolte_tesla_schema` removed that app's tables/schema/functions/
-- enums, but a standalone sequence `public.invoice_number_seq` (its charging-invoices feature) survived
-- because it wasn't owned by any dropped column. Daily Rep has no invoice logic and nothing references
-- it (0 dependencies, verified), so drop it. Idempotent — a no-op on a fresh/dedicated project.
drop sequence if exists public.invoice_number_seq;
