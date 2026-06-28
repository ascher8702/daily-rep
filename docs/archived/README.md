# Archived docs

Point-in-time documents whose job is done — completed audits, expired progress logs, and finished
build/migration plans. They are kept for history and are **not** current; each carries a dated
`> Archived …` banner at the top explaining what superseded it. Do not treat anything here as a
description of how the app works today.

Archived on **2026-06-28** (via the `/lint-docs` skill), after verifying every claim against the code:

| Doc | Was | Superseded by |
| --- | --- | --- |
| `db-architecture-audit-2026-06-23.md` | DB/sync architecture audit | Held items shipped (monotonic guard + pull-on-visibility); schema-as-code under `supabase/migrations/`. Deferred/rejected DDL → `supabase/migrations/README.md`. |
| `progression-audit-2026-06-23.md` | Progression-engine code audit ("do not ship") | All findings fixed in `src/lib/progression.ts` + `src/lib/generator.ts` w/ tests. Living spec + citations → `docs/research-progressive-overload.md`. |
| `loop-progress.md` | Autonomous-improvement-loop progress/handoff log | Deadline 2026-06-24 passed; all items shipped or moved to current docs. Backlog → `docs/ux-improvement-backlog.md`. |
| `redesign-blaze.md` | Charge/Blaze redesign build-plan | Completed (it.1–20). Live UI + `tailwind.config.ts` / `globals.css` tokens are the source of truth. |
| `runbook-dedicated-project.md` | Plan to migrate off the shared Supabase project | Cutover done (project `clobxwwcjlmyckvkongk`). Data-preserving recipe → `docs/runbook-backup-restore.md` (Appendix). |
| `sessions-analytics-build.md` | Session-analytics build plan & status | All 7 stages shipped → `supabase/migrations/20260627000000_baseline_schema.sql`. |
| `sessions-analytics-spec.json` | Pre-build DDL design spec for the analytics projection | Shipped in the baseline migration (the source of truth). Deferred scaling items → `supabase/migrations/README.md`. |
