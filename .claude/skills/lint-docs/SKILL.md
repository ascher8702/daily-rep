---
name: lint-docs
description: Audit the repo's docs for accuracy against the actual codebase, then ARCHIVE point-in-time docs whose job is done and UPDATE living docs that have drifted. Read-only analysis first; verifies every claim against the code (never trusts the doc); never deletes; always confirms the plan before moving or rewriting anything. Invoke as `/lint-docs [optional path or glob]` (defaults to `docs/` + README.md + CLAUDE.md).
---

# /lint-docs — keep the docs honest

Docs rot. Audits get superseded, runbooks describe infra that moved, progress logs blow past their deadline, build plans finish. This skill walks the docs, **verifies each one against the live code/infra**, and resolves every doc to one of three verdicts — **KEEP / UPDATE / ARCHIVE** — then executes the moves and edits after you confirm.

Core rule: **trust the code, not the doc.** A doc that says "we still need X" is only stale if the code shows X already shipped — so every verdict must be backed by a `file:line`, migration name, or config value, not by the doc's own say-so.

## Scope

By default audit everything in `docs/`, plus `README.md` and `CLAUDE.md` (and `supabase/migrations/README.md` if present). If the user passed a path/glob, audit just that. The archive destination is **`docs/archived/`** (this repo's existing convention — mirror `supabase/migrations/archive/`). Never invent a different archive dir.

## The three verdicts

| Verdict | When | Action |
|---|---|---|
| **KEEP** | Substantively accurate and still serves its purpose. A purely cosmetic nit (e.g. an old brand name in prose) can be noted but is still KEEP. | none |
| **UPDATE** | The doc is meant to be **current** (runbook, setup guide, living map/spec, backlog, README/CLAUDE) but has **drifted** from the code/infra. | rewrite the stale parts **in place**; fix any cross-refs |
| **ARCHIVE** | The doc is a **point-in-time artifact** whose job is done and which would **mislead** if read as current. | `git mv` to `docs/archived/` + prepend a one-line banner; **never delete** |

**Decision aid:** dated snapshot / log / finished plan whose recommendations have all *landed-or-been-rejected* → ARCHIVE. Current-but-wrong → UPDATE. Current-and-right → KEEP. When torn between UPDATE and ARCHIVE, ask: *is this doc's purpose ongoing?* A runbook's purpose is ongoing (UPDATE); a one-off audit's purpose ended when its findings were dispositioned (ARCHIVE).

## Doc taxonomy (default lean, then verify)

These are starting biases, not verdicts — always confirm against the code.

- **Audits / reviews** (`*-audit-*.md`) — point-in-time. Lean ARCHIVE *once every finding has shipped or been explicitly rejected*. Check the "Held / TODO / needs decision" sections against the code: if those items shipped, that's the archive trigger.
- **Progress / handoff logs** (`loop-progress.md`, anything with a deadline or "carry across context") — lean ARCHIVE once the deadline has passed. These are scratch, not reference.
- **Build / redesign plans** (`*-build.md`, `redesign-*.md`) — living until done. UPDATE the status while in flight; ARCHIVE once the plan is fully shipped (verify against the code, and migrate any still-useful design rationale into a durable doc or CLAUDE.md first).
- **Runbooks** (`runbook-*.md`) — operational, must stay correct. Almost always **UPDATE**, rarely archive. A runbook for a *completed one-time migration* may archive, but only after confirming the migration is truly done.
- **Setup guides** (`*_SETUP.md`, STRIPE_SETUP) — keep current → UPDATE.
- **Research notes** (`research-*.md`) — externally-sourced background; substance rarely rots. Usually **KEEP**. A stale brand name in prose is *not* grounds to archive a still-useful research doc.
- **Backlogs / workflow maps** (`*-backlog.md`, `user-workflow-map.md`) — living. UPDATE (prune shipped items, refresh flows); archive only if wholly superseded.

## Repo-specific staleness signals

This codebase has known migrations a doc may predate. Treat any of these as a red flag to investigate (but confirm against the code — some are deliberate, e.g. brand name kept in research prose):

- **Brand rename FitForge → "Daily Rep"** (2026-06-23), UI *and* internal ids. Stale tells: `fitforge_state` (now `daily_rep_state`), `fitforge-*` localStorage keys (now `daily-rep-*`), `fitforge-v1` (now `daily-rep-v1`).
- **Supabase project moved** from the old shared ref `aswwhsxubqyzbrfoptoq` to a **dedicated** project (current ref is in `supabase/config.toml`). A doc citing the old ref, or saying "we share a project with another app," is likely stale.
- **Account is now required** (paid product). The user-facing "Continue without an account" / `localOnly` *choice* was removed; `localOnly` survives only as a dev fallback when Supabase env is absent. A doc presenting "continue without an account" as a live feature is stale.
- **Schema-as-code shipped** under `supabase/migrations/` — including the **monotonic-clock write guard** and **pull-on-focus/visibility** in `src/lib/sync.ts`. Audits that list these as "held / not yet done" describe a state that has since shipped → that's the archive trigger.
- **Expired deadlines** — any "until <date>" / "by <date>" log where the date is in the past.

Update this list as the project evolves; it's the cheat-sheet that makes the audit fast.

## Procedure

### 1. Inventory
List the in-scope docs with size + last-modified (`ls -la docs/`). Note the archive dir exists (`docs/archived/`); create it with the first archive if it doesn't.

### 2. Classify + verify — **in parallel, one subagent per doc**
This is the leveraged step and it fans out cleanly. Dispatch **one subagent per doc** (the `Agent` tool, or a `Workflow` if available — see `lint-docs-firstpass` script pattern). Each subagent must:
1. Read the **whole** doc.
2. Extract its load-bearing claims (table/project names, file paths, "current behavior" statements, TODO/held items, deadlines).
3. **Verify each claim against the actual repo** — grep/read `src/`, `supabase/migrations/`, `supabase/config.toml`, `package.json`, `CLAUDE.md`. Cite evidence (`file:line` / migration name).
4. Grep the repo for **inbound references** to the doc's filename (so we know what breaks if it's archived).
5. Return a structured verdict: `{ file, docType, verdict, confidence, rationale, staleClaims[], accurateHighlights[], inboundRefs[], proposedAction }`.

Never let a subagent assign a verdict from the doc's text alone — require code evidence.

### 3. Adversarial gate on every ARCHIVE
Archiving is the consequential action, so refute it before trusting it. For each ARCHIVE verdict, run an independent skeptic that tries to **keep** the doc — hunting for: (a) unique, still-true info that lives nowhere else and would be lost, (b) a load-bearing inbound reference (CLAUDE.md, README, build/deploy tooling) that would break, (c) evidence the doc is actually still current. If it finds (a), migrate that nugget into a living doc **before** archiving (verdict `ARCHIVE-AFTER-MIGRATING-NUGGET`); if (b), fix the ref as part of the move; if (c), downgrade to UPDATE/KEEP.

### 4. Propose the plan and **confirm**
Present a single table — every doc, its verdict, one-line reason, and the concrete action — grouped ARCHIVE / UPDATE / KEEP. **Stop and get the user's go-ahead before any move or rewrite.** Doc changes are consequential and the user may want to keep a "stale" doc for the record, or update one you'd have archived. Offer to do all, a subset, or just the archives.

### 5. Execute (only what was confirmed)
- **Archive:** `git mv docs/<doc> docs/archived/<doc>` (preserves history). Prepend a one-line banner at the very top:
  `> **Archived <YYYY-MM-DD>.** Point-in-time <type>; superseded by <what> / its recommendations shipped. Kept for history — not current.`
  For a non-Markdown doc that has no comment syntax (e.g. a `.json` spec), add the banner as a top-level `"_archived": "…"` key instead of a `>` line.
  Then fix every inbound reference — and grep **source comments**, not just other docs (this repo cites docs from `src/*.ts` headers): point each at `docs/archived/…`, repoint it to the live doc that superseded it, or remove the link if it implied currency. If several get archived, drop/refresh a one-line index in `docs/archived/README.md`.
- **Update:** make **surgical** edits — rewrite only the stale statements, preserve the doc's structure and voice, fix cross-refs. Don't rewrite a doc wholesale when a few lines drifted.
- **Keep:** nothing (apply a noted cosmetic nit only if the user opted in).

### 6. Report
Summarize: counts (archived / updated / kept), the git moves, the files edited, any nuggets migrated, and any inbound references fixed. Note anything you flagged but left for the user to decide. If nothing was changed (analysis only), say so plainly.

## Safety rules

- **Never delete a doc** — archiving via `git mv` preserves it and its history. The whole point is recoverability.
- **Verify before you archive** — a doc is ARCHIVE only with code evidence that its content is spent. When unsure, downgrade to UPDATE or leave it KEEP and flag it.
- **Confirm before writing** — analysis is automatic; moves and rewrites are not. Always present the plan first (step 4).
- **Don't strand a reference** — if CLAUDE.md, README, or build tooling cites a doc you're archiving, fix the citation in the same change (or don't archive it).
- **Migrate, don't lose** — if a spent doc holds the *only* copy of a still-true fact (a runbook step, a sourced decision), move that fact into a living doc before filing the original away.
- **Surgical updates** — match the existing doc's structure, density, and voice; change only what drifted.
