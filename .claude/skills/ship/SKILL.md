---
name: ship
description: Autonomous feature pipeline. Chains four specialized subagents — planner → tester → coder → reviewer — through the .pipeline/ handoff bus to take a vague feature request all the way to a reviewed, ready-to-merge feature branch. Invoke as `/ship <feature request>`, e.g. `/ship add rate limiting to the login endpoint`.
---

# /ship — overnight dev-team pipeline

You (the main agent) are the **orchestrator/foreman**. You do not plan, test, code, or review yourself — you dispatch the four subagents in sequence and pass context between them through files in `.pipeline/`. Each subagent starts with a fresh context and learns everything it needs from `.pipeline/`, never from your conversation history.

**The feature request** is the text the user passed to `/ship` (i.e. `$ARGUMENTS`). If it is empty, ask the user for one and stop.

**Operating mode: autonomous.** The point of this pipeline is to ship while the user is away. Run all phases without pausing for check-ins or "should I continue?" prompts. Stop only for: a hard blocker you cannot resolve, a phase that failed to produce its handoff artifact, the review retry budget being exhausted, or the final merge-to-main gate.

## The crew (model + reasoning effort, set in each agent's frontmatter)

| Stage | Agent | Model | Effort | Why |
|-------|-------|-------|--------|-----|
| 1 | `planner` | Opus 4.8 | `max` | "Ultracode" — the most leveraged stage; deepest reasoning |
| 2 | `tester` | Opus 4.8 | `high` | careful edge-case design |
| 3 | `coder` | Opus 4.8 | `max` | "Opus 4.8 Max" — correctness under load |
| 4 | `reviewer` | Opus 4.8 | `max` | "Opus 4.8 Max" — the gate; maximal scrutiny |

Effort is a real frontmatter knob (`effort: low|medium|high|xhigh|max`) honored on dispatch. **`max` is the ceiling** — it's what "ultracode" / highest effort maps to, and the planner, coder, and reviewer all run there. Tune per stage in `.claude/agents/*.md` to trade tokens for depth.

## The handoff bus (`.pipeline/`)

| Artifact | Written by | Read by |
|----------|-----------|---------|
| `request.md` | you (orchestrator) | planner |
| `spec.md` | planner | tester, coder, reviewer |
| `tests.md` | tester | coder, reviewer |
| `change.md` | coder | reviewer |
| `review.md` | reviewer | you (gate) + coder on re-run |

After every phase, **assert the expected artifact exists and is non-empty before proceeding.** If it's missing, stop and report — do not run the next agent on missing context.

## Procedure

### 0. Set up
1. Confirm you're in a git repo. If not, stop and tell the user.
2. **Require a clean working tree.** Run `git status --porcelain`. If there are uncommitted changes (other than `.pipeline/` scratch), stop and ask the user to commit or stash them first — otherwise their pre-existing edits ride onto the branch and pollute the reviewer's diff. Do not proceed on a dirty tree without an explicit go-ahead (and if they say go ahead, record the pre-existing files so the reviewer can disregard them).
3. Detect the verification commands from `package.json` scripts (or the build system). For this repo the defaults are: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`. Capture the ones that exist.
4. Pick a short kebab slug from the request (e.g. `rate-limit-login`). **Create and switch to a feature branch `ship/<slug>` off the current branch.** Never run the pipeline directly on `main`/`master` — the reviewer gates *before* anything touches the main branch.
5. Reset the bus: remove stale `.pipeline/{spec,tests,change,review}.md` from any prior run (keep `.pipeline/README.md`).
6. Write `.pipeline/request.md`: the verbatim feature request, the branch name, the verification commands, the date, and any stack notes the agents need. This is the planner's only input.

### 1. Planner  →  `.pipeline/spec.md`
Call the `Agent` tool with `subagent_type: "planner"`. In the prompt, tell it: read `.pipeline/request.md`, produce `.pipeline/spec.md` per its template, work only from `.pipeline/`. Run the planner at maximum thoroughness — this is the most leveraged stage; a vague spec poisons everything downstream.
**Gate:** confirm `.pipeline/spec.md` exists and is substantive.

### 2. Tester  →  failing tests + `.pipeline/tests.md`
Call `Agent` with `subagent_type: "tester"`. Tell it: read `.pipeline/spec.md`, write failing tests (TDD red) covering the happy path and every edge case in spec §7, and write `.pipeline/tests.md`. It must run the suite and confirm the tests fail for the *right* reason (feature not built), not authoring errors.
**Gate:** confirm `.pipeline/tests.md` exists and that test files were created.

### 3. Coder  →  source + `.pipeline/change.md`
Call `Agent` with `subagent_type: "coder"`. Tell it: read `.pipeline/spec.md` + `.pipeline/tests.md` (and the test files), implement until tests + typecheck + lint + build are all green without gaming the tests, and write `.pipeline/change.md`. Pass the exact verification commands.
**Gate:** confirm `.pipeline/change.md` exists.

### 4. Reviewer  →  `.pipeline/review.md` (the verdict)
**Freeze the feature into a scoped commit before review.** Stage ONLY the feature's own paths — the exact file list is in spec §4 (limiter/source + test files + the touched endpoints) — and commit them with an explicit pathspec: `git commit -m "feat: …" -- <those paths>`. Do **not** use `git add -A`: an autonomous run may have scheduled tasks or hooks (e.g. a docs linter doing `git mv`) concurrently mutating the working tree and index, and `-A` would drag that unrelated churn into the review and the commit. Committing the feature to its own commit gives the reviewer a stable diff immune to that race.
Then call `Agent` with `subagent_type: "reviewer"`. Tell it: the feature is **HEAD** (give the sha); review exactly `git show HEAD`; ignore any unrelated working-tree churn (`git status`/`git diff` may be polluted by a concurrent process); read spec/tests/change; re-run the full suite itself; write `.pipeline/review.md` with a `VERDICT:` line. The reviewer is read-only and cannot change code.
**Gate:** read `.pipeline/review.md` and grep the `VERDICT:` line.

### 5. Verdict gate + retry loop
- **`VERDICT: APPROVE`** → go to Finalize.
- **`VERDICT: REQUEST_CHANGES`** → re-dispatch the **coder** (step 3) and tell it to read `.pipeline/review.md` and fix every blocking finding. Then fold the fixes into the feature commit (`git commit --amend -- <feature paths>`, or add a follow-up commit) and re-run the **reviewer** (step 4) against the updated HEAD. Allow **up to 2** such retries. If still not approved after the budget, stop and hand the user the open findings — do not merge.

### 6. Finalize
- The feature is already committed on the branch (step 4). Confirm the commit is scoped to the feature only (`git show --stat HEAD`) and that no unrelated concurrent churn rode along.
- **Do not merge to `main` automatically.** Touching the main branch is gated: present the verdict, the branch name, the diffstat, and the `.pipeline/` artifacts, and give the exact merge/cherry-pick command for the user to run (or open a PR) when they're back. On an explicit prior "merge when approved" instruction, you may fast-forward `main` — otherwise leave it for the user.

## Report back
End with a tight summary: the branch, the verdict, suite status, files changed, the riskiest thing the reviewer flagged, and the one command to merge. Link the artifacts (`.pipeline/spec.md`, `.pipeline/review.md`) so the user can audit the run.

## Notes
- Pass each subagent only what it needs via `.pipeline/` + a focused prompt; never dump your own context into them.
- If any agent reports it could not do its job (e.g. the spec is impossible, the request is underspecified beyond reasonable assumption), stop the loop and surface that — a bad artifact must not silently flow downstream.
- The four agents (`planner`, `tester`, `coder`, `reviewer`) are also usable individually via the Agent tool if the user wants just one stage.
