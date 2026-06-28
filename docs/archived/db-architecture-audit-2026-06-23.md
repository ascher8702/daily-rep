> **Archived 2026-06-28.** Point-in-time DB audit. Superseded: project is now `clobxwwcjlmyckvkongk` / table `public.daily_rep_state`; the monotonic-clock guard + pull-on-visibility shipped; schema is version-controlled under `supabase/migrations/`. Its deferred/rejected-DDL guardrails were moved to `supabase/migrations/README.md` (Deferred / future work). Kept for history — not current.

# DB / data-architecture audit — 2026-06-23

Five independent database/system architects audited the Supabase backend (project
`aswwhsxubqyzbrfoptoq`, table `public.fitforge_state`) + the offline-first sync layer
(`src/lib/sync.ts`), then every proposed DDL change was adversarially verified against the
offline-first model. 31 findings; 17 agents.

## Verdict on the current design
- **Storage model (single JSONB blob per user) is correct for now.** The whole store is read/written
  atomically and the client is source of truth — full normalization is not warranted. Documented a
  migration path for later (server-side queries / sharing).
- **Per-user isolation is airtight.** `anon` holds zero table grants AND matches zero rows (null
  `auth.uid()`); all four commands enforce `((select auth.uid()) = user_id)` incl. WITH CHECK, so
  `user_id` can't be forged. Trigger fn is SECURITY INVOKER with a pinned `search_path`.
- **No additional index is justified.** Access is point-lookup/upsert by PK; a GIN/expression index
  would be pure write-amplification with zero read benefit.
- Security advisors: clean. Performance advisor: one project-level INFO (Auth pooler), not schema.

## Applied (safe, additive, no client change)
**Migration `fitforge_state_integrity_and_docs`:**
1. `client_updated_at` → `DEFAULT now()` + backfill NULLs. The column is the LWW logical-clock-of-record
   but was nullable/defaultless, and `pullAndReconcile` coerces NULL → time 0, so any out-of-band write
   that dropped the clock could be silently clobbered. The client always sends its own value, so the
   default only fires on manual/seed/server writes.
2. `fitforge_state_data_is_object` CHECK `jsonb_typeof(data) = 'object'`. Codifies the invariant
   `mergePersisted` already relies on (it spreads `{...p}`); a scalar/array blob would mishydrate. Table
   empty + default `'{}'` satisfies it, so it never rejects a legit client upsert.
3. COMMENTs on all six columns (reconciliation semantics, GDPR-erasure note, schema_version dormancy).

**Migration `fitforge_state_scope_rls_to_authenticated`:** the four own-row policies recreated
`TO authenticated` instead of PUBLIC (defense-in-depth; authenticated unaffected, anon loses an
already-non-functional path).

## Held — needs your decision (NOT applied)
1. **[HIGH] Server-side monotonic-clock guard** (BEFORE UPDATE trigger that reverts a stale write to a
   no-op instead of clobbering a newer cloud row). This is the highest-value fix for the LWW
   lost-update window (two devices / clock skew / a long-lived signed-in tab). **It must ship together
   with a client edit** — `sync.ts` only pulls once at sign-in (no realtime, no focus/visibility pull),
   and after a no-op'd push the client sets `lastPushedJson` and believes it synced, so a stale tab would
   stay divergent until next sign-in. Recommended next step: implement the trigger **and** a
   pull-on-visibility/focus (+ re-pull after a push whose `updated_at` advanced) as one unit, with tests.
2. **[LOW] ~5MB `data` size CHECK** (runaway-blob backstop). Threshold is a product decision and, if ever
   hit, `pushNow` would throw unhandled → silent sync stop. Worth adding only with a generous cap +
   client-side rejected-push handling.

## Rejected (cargo-cult / harmful — verified and dropped)
- `REVOKE` anon/PUBLIC grants — nothing is granted to revoke; a one-time revoke doesn't guard future grants.
- `client_updated_at <= now()+1day` CHECK — **harmful**: users with fast device clocks send legit
  future timestamps; the check would silently break their cloud sync.
- Lower `fillfactor` / tighten per-table autovacuum — premature micro-tuning on a 1-row-per-user,
  PK-only table; HOT already skips the index (user_id never changes) and the real cost is TOAST, which
  fillfactor doesn't touch. Revisit only if `pg_stat_user_tables` shows real bloat under load.

## Process recommendations (no DDL)
- Check in a generated Supabase TypeScript types file + use it in the client (silent schema drift today).
- Add an automated RLS regression test (per-user isolation).
- Document a backup/PITR expectation + restore runbook for the single-blob model.
- Confirm auth-level hardening in the dashboard: leaked-password (HIBP) protection, OTP expiry, password
  min length (not reachable via MCP).
- Migration ledger still lists ~80 legacy Jolte/Tesla entries (harmless; only 3 are FitForge).
