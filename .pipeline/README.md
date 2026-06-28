# `.pipeline/` — the dev-team handoff bus

This folder is the shared memory of the `/ship` pipeline. Four specialized subagents
hand work to each other by writing and reading files here — each agent starts fresh and
gets all of its context from `.pipeline/`, never from the orchestrator's chat history.

## Flow

```
/ship "<feature request>"
        │
        ▼
   request.md ──► [planner]  ──► spec.md
                                   │
                                   ▼
                              [tester]  ──► tests.md  (+ failing test files in the repo)
                                   │
                                   ▼
                              [coder]   ──► change.md (+ implementation in the repo)
                                   │
                                   ▼
                              [reviewer] ──► review.md  (VERDICT: APPROVE | REQUEST_CHANGES)
                                   │
                                   ▼
              APPROVE → commit on ship/<slug>, gated merge to main
              REQUEST_CHANGES → back to coder (≤2 retries)
```

## Artifacts

| File | Written by | Purpose |
|------|-----------|---------|
| `request.md` | orchestrator | The raw feature request + branch + verification commands. The planner's only input. |
| `spec.md` | planner (Opus 4.8, effort `max`) | Build-ready spec: file paths, signatures, edge cases, UI/UX. |
| `tests.md` | tester (Opus 4.8, effort `high`) | Test manifest + coverage map (spec edge case → test) + red-run output. |
| `change.md` | coder (Opus 4.8, effort `max`) | Implementation log: files changed, how the spec is satisfied, suite results. |
| `review.md` | reviewer (Opus 4.8, effort `max`, read-only) | Verdict + suite re-run + findings. The `VERDICT:` line is the gate. |

Model + reasoning effort are set per agent in `.claude/agents/*.md` frontmatter (`model:` + `effort:`).

## Agents
Defined in `.claude/agents/`: `planner`, `tester`, `coder`, `reviewer`.
The reviewer is read-only (no Edit/Write tools) — it cannot change code, only judge it.

The run artifacts (`spec.md`, `tests.md`, `change.md`, `review.md`) are git-ignored scratch;
only this README is tracked.
