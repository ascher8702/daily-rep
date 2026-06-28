> **Archived 2026-06-28.** Point-in-time code audit (pre-"Daily Rep" rename). All CRITICAL/HIGH/MED findings shipped fixes in `src/lib/progression.ts` + `src/lib/generator.ts` with regression tests in `src/__tests__/progression.test.ts`; the remaining spec-gaps and their sourced citations now live in `docs/research-progressive-overload.md`. Kept for history — not current.

<!-- Generated 2026-06-23 by a 5-agent research + 6-agent adversarial code-audit workflow (46 agents, 26 verified findings). The CRITICAL/HIGH bugs have since been FIXED in src/lib/progression.ts (top-set evaluation + failure-to-improve stall + rep-bank cap + occurrence + bodyweight cue) and src/lib/generator.ts (incWeight), with regression tests in progression.test.ts. Remaining items are spec gaps (per-cycle 5/3/1, deload-state, fractional plates, RIR gate) — tracked as future work. -->

# FitForge weight-progression audit (2026-06-23)

## Executive verdict

**Do not ship.** The recording layer is sound — per-set weight/reps are captured cleanly, `finishWorkout` persists every block with `instanceId`, and unit conversion is bounded. But the **progression math is inverted at its core** and punishes correct execution on the flagship plans.

The stall detector requires **every** logged working set to reach `repMax` (`progression.ts:113` for `allHitTop`, `:121` for the stall-loop escape). That predicate is structurally false for the exact schemes the built-in plans ship — 5/3/1 waves with an AMRAP top set, ascending ramps, pyramids, and top-set + back-off — and for **any rep range spanning ≥3 reps**, which includes the default hypertrophy ranges (compound 8–12, isolation 10–15). The consequence is the opposite of progressive overload: a lifter who hits a climbing AMRAP, or who adds one rep every session, is auto-**deloaded −10%** with reps reset to `repMin`, and the load ratchets **down** indefinitely.

I confirmed this by reading the code, tracing the data path end-to-end, and **running `prescribe()` live** against the real exercise/plan data. Every critical and high finding reproduces. The existing unit test at `progression.test.ts:115-126` *codifies the broken behavior* (it asserts `deload: true` on a lift that climbed reps 8→9 inside an 8–12 range), so the suite gives false confidence rather than catching the bug.

## Confirmed bugs

| Severity | Area | File:line | Problem |
|---|---|---|---|
| critical | simulation | `progression.ts:113,121,124` | 5/3/1 / AMRAP / ascending lift misread as a stall → auto-deload −10% |
| critical | simulation | `progression.ts:116-123,165` | Mid-range rep climbing (range span ≥3) misread as stall → weight ratchets DOWN forever (default hypertrophy) |
| high | simulation | `progression.ts:113,143` | Back-off / FSL set vetoes the load increase even when top sets hit the range |
| high | spec-conformance | `progression.ts:78-82` | Same lift twice in a day (5/3/1 main + BBB) conflated — prescribe reads only the FIRST block |
| high | loadable-math | `progression.ts:67-75` | `increment()` loadStep floor overrides the 10% cap → +33% jump on light dumbbell/machine lifts |
| med | prescribe | `progression.ts:112-123,132` | AMRAP/wide-range/pyramid misfire allHitTop & deload to a nonsensical reps:1 |
| med | simulation | `progression.ts:143,171` | Maxed-out bodyweight lift (pullup 12/12) gets no progression and no coaching cue |
| med | recording | `generator.ts:312-314` | Free-generated sessions drop `incWeight` → '+X lb' cue never renders |

## Details & fixes

### 1 (critical) — 5/3/1 / AMRAP / ascending lift misread as a stall
**Problem.** `allHitTop = last.every(s => s.reps >= repMax)` (L113) and the stall-loop break `if (sets.every(s => s.reps >= repMax)) break` (L121) both require *every* working set to reach `repMax`. On a 5/3/1 wave the lower-rep ramp sets never reach `repMax`, so a perfectly-progressing session counts as a stall. `bestReps` (L114) — which would capture the climbing AMRAP — is computed and then never used. After `STALL_SESSIONS=3` the deload branch (L124-140) fires.
**Repro (verified live).** OHP, `repRange [1,5]`, 3 sessions each `[95×5, 105×3, 115×AMRAP]` with AMRAP `8→9→10`. `prescribe()` returns `{weight:105, reps:1, deload:true, note:'Deload −10% · rebuild from here'}`. A climbing AMRAP is unambiguous progression; the spec (Wendler 5/3/1) says a stall is *missing the minimum AMRAP reps*. Reachable on every built-in 5/3/1 day (`plans.ts:487,497,507,517`).
**Fix.** Identify the top/working set (sets at `curWeight`, or the max-weight set) and evaluate `allHitTop` and the stall break on the **best/AMRAP rep count of those sets only**; treat ramp/back-off sets as non-gating.

### 2 (critical) — mid-range rep progression misread as a stall (default hypertrophy)
**Problem.** The stall loop (L116-123) counts any same-load session that didn't hit `repMax` on every set as a stall. The engine adds only one rep per session (L165 `nextReps = min(repMax, bestReps+1)`), so climbing `repMin → repMax` takes `(repMax − repMin)` sessions. When `(repMax − repMin) >= 3`, the 3rd session deloads **before** the lifter can ever reach `repMax`, making the 'all hit top → add load' branch (L143) unreachable. The default profile goal is hypertrophy → compound `[8,12]` (span 4) and isolation `[10,15]` (span 5), both ≥3.
**Repro (verified live).** lat-pulldown, intermediate, hypertrophy `[8,12]`, 120 lb, +1 rep/session (8→9→10). Session 3 `prescribe()` returns `{weight:110, deload:true}`. It then descends 110→100→90… and never reaches 12 reps or adds load. The test at `progression.test.ts:115-126` asserts this very behavior as correct.
**Fix.** Make the stall counter measure **failure-to-improve**: only increment `stalls` when the current same-load session did not beat the prior same-load session's reps, OR only detect a stall once the lifter has reached `repMax` and failed to add load. Per spec a stall is "repeated FAILURE to hit prescribed reps at a fixed load" (StrongLifts/Starting Strength), not "not yet at the top of the range".

### 3 (high) — back-off / First-Set-Last sets veto the load increase
**Problem.** `allHitTop` (L113) spans all working sets including deliberately-lighter back-off sets; one back-off set below `repMax` suppresses the add-load branch.
**Repro (verified live).** back-squat `[3,5]`, logged `[225×5, 225×5, 185×3 back-off]` → `{weight:225, note:'Add a rep this session'}`. Control with no back-off → `{weight:230, incWeight:5}`. Built-in shape (Texas Method `plans.ts:328`; FSL 5x5).
**Fix.** Filter to sets at `curWeight` before computing `allHitTop` (the same fix as #1).

### 4 (high) — same lift twice in a day (5/3/1 BBB) conflated
**Problem.** `workingSets()` does `w.exercises.find(e => e.exerciseId === exerciseId)` (L79) — first match only. A day with two same-`exerciseId` blocks (heavy wave + BBB 5x10) feeds **both** prescriptions from the first block; the second block's logged reps/weight are invisible. `prescribe` has no `instanceId` parameter, though `WorkoutExercise.instanceId` exists (`types.ts:90`) and the store's set handlers already key on it (`byKey`, `useStore.ts:184`).
**Repro (verified live).** 5/3/1 BBB OHP day: block A `3×1-5 @115`, block B `5×10 @65`. The BBB block's `prescribe([10,10])` reads block A's 115 lb history and returns `{weight:115, reps:9}` instead of ~65×10. Ships in `wendler-531-bbb` (`plans.ts:487/488, 497/498, 507/508, 517/518`).
**Fix.** Thread `instanceId` into `prescribe`/`workingSets` and match on it, falling back to `exerciseId` for legacy sessions. Thread it through `buildPlanDayExercises` and the generator.

### 5 (high) — `increment()` loadStep floor overrides the 10% cap
**Problem.** `increment() = Math.max(loadStep, Math.min(base, weight*PCT_CEILING))` (L74). The inner `Math.min` applies the 10% cap; the outer `Math.max(loadStep,…)` re-floors at the 5 lb / 2.5 kg dumbbell/machine notch, so for any light lift where `loadStep > 10%·weight` (under 50 lb / 25 kg) the cap is defeated. There is **no** double-progression fallback once `allHitTop` is true. This violates the in-code `PCT_CEILING` comment and `docs/research-progressive-overload.md` ("caps a single jump at ≤10%").
**Repro (verified live).** lateral-raise, 15 lb, all sets at `repMax` → `{weight:20, incWeight:5}` = **+33%**. kg mirrors (7.5→10).
**Fix.** When `loadStep > weight*PCT_CEILING`, hold the load and add a rep (double progression) instead of forcing the notch. Note the deeper cause is hardware granularity: a 5 lb dumbbell step is itself >10% of any sub-50-lb load, so the cap is unsatisfiable there — rep-banking is the correct behavior (ACSM 2–5% for isolation; Legion double-progression).

### 6 (med) — AMRAP/wide-range/pyramid misfire, deload resets reps to 1
**Problem.** `curWeight = Math.max(all weights)` (L112) and `allHitTop`/stall use `every(reps>=repMax)` against a single fixed `repMax`. A `[1,5]` block's '5s week' (5,5,8) adds load while its '3s week' (3,3,5) is mislabeled a stall — opposite verdicts. The deload (L132-134) resets reps to `repMin`, giving a nonsensical `reps:1` for a `[1,5]` block. Pyramids (12,10,8 in `[8,12]`) never satisfy `allHitTop`.
**Repro (verified live).** 5/3/1 OHP `[1,5]`: 5,5,8 → adds load; 3,3,5 → 'Add a rep'; three declining 3s sessions → deload to `reps:1`.
**Fix.** Gate on the top set; clamp the deload rep reset to `max(repMin, prior reps)`; progress 5/3/1 per-cycle (Wendler).

### 7 (med) — maxed-out bodyweight lift never progresses or coaches
**Problem.** The add-load branch is gated on `curWeight > 0` (L143) and the reps-first branch caps `nextReps` at `repMax` and suppresses the note when `curWeight===0` (L171). A bodyweight lift at the top of its range returns `{weight:0, repsDir:'same', note:undefined}`; the session UI render gate then shows nothing.
**Repro (verified live).** pullup `[8,12]`, logged `1×12 @0` → `{weight:0, reps:12, weightDir:'same', repsDir:'same', note:undefined}`. Idempotent — stuck forever. Built-in plans schedule pullup/hanging-leg-raise with rep ranges.
**Fix.** For bodyweight at `allHitTop`, allow `nextReps` to exceed `repMax` or emit an 'add a rep / add weight via belt' note (rep progression is first-class — Plotkin 2022).

### 8 (med) — free-generated sessions drop `incWeight`
**Problem.** `generator.ts:312-314` builds `coaching` without `presc.incWeight`, so the UI '+X lb' cue (`session/[id]/page.tsx:152`) never renders on freely-generated workouts, while plan-day (`useStore.ts:222`) and add-exercise (`useStore.ts:173`) paths show it. Cosmetic only — set weights are correct.
**Fix.** Add `incWeight: presc.incWeight` at `generator.ts:313`.

## Spec conformance

**Matches evidence-based practice:**
- The `INCREMENTS` table (`progression.ts:34-53`) is well-calibrated: beginner upper-compound 5/2.5, upper-isolation 2.5/1.25, lower-compound 10/5; advanced micro values — consistent with **NSCA** absolute increments (upper +2–5 lb, lower +5–10 lb less-trained) and **StrongLifts/Starting Strength**. The defects are in how `increment()` and the stall logic *consume* it, not the table itself.
- Plate/dumbbell/machine rounding (`weights.ts:177-201`) keeps prescriptions loadable (no "47 lb barbell"), matching the **StrongLifts/Hevy/Liftosaur** rounding requirement.
- The intended design is **double progression** (reps within a range, then load) — the right model per **Plotkin 2022 (PeerJ e14142)**, **ACSM 2009 (Ratamess)**, **Legion/Hevy/Boostcamp**. The implementation just never lets reps climb the range before deloading.
- A deload-on-stall path exists (10% drop) — directionally correct per **StrongLifts/Starting Strength 'The Reset'**.

**Diverges (defensible-but-worth-noting):**
- **Stateless increment / no reset-shrink.** Per **Starting Strength 'The Reset'** and **Bell et al. 2025**, a reset should also cut the per-session jump and, after 2–3 resets at the same wall, flag that linear progression is exhausted (Andy Baker / Rippetoe 'Limits of Linear Progression'). Neither exists.
- **No frequency awareness.** Same per-session jump regardless of training frequency; 5/3/1 blocks progress per session, not per 4-week cycle (Wendler 5/3/1).
- **No form/RIR gate.** Load is added purely on rep count (ACSM one-variable principle; Helms et al. 2016 RIR). The engine can't see form, so it should solicit it.
- **No micro-loading model.** Flat 5 lb / 2.5 kg `loadStep` per class, no fractional plates / PlateMate / PowerBlock adders — the root reason the 10% cap is unsatisfiable on light lifts (TriageMethod; Legion).
- **Lossy unit-switch mutation.** `convertWeight` re-rounds stored history each way (e.g. 145 lb → 146 lb after one round-trip), perturbing `prescribe`'s `Math.max` baseline. Bounded and documented as a trade-off, but it's history mutation, not display formatting — store a canonical unit or snap through `roundToAchievable`.

## Recommendations

1. **Fix the stall/top-set logic first (findings 1, 2, 3, 6).** A single refactor — define the top working set as the sets at `curWeight`, evaluate `allHitTop` and the stall break on their best/AMRAP rep count, and make the stall counter measure failure-to-improve — resolves the two critical bugs and two highs. This is the gating change before the feature can be trusted.
2. **Thread `instanceId` through `prescribe`/`workingSets` (finding 4)** so duplicate-block plans progress independently; the field and `byKey` helper already exist.
3. **Add the double-progression fallback in `increment()` (finding 5):** when the smallest loadable step exceeds the % ceiling, hold load and bank a rep instead of forcing the notch.
4. **Handle bodyweight at the top of range (finding 7)** — let reps exceed `repMax` or emit an added-load cue.
5. **One-line fix for the missing `incWeight` cue (finding 8).**
6. **Rewrite the progression tests.** `progression.test.ts:115-126` and `:60-66` currently lock in defective behavior; replace with cases covering 5/3/1 waves, AMRAP, back-off sets, wide-range rep climbing, BBB duplicate blocks, and bodyweight — the schemes the engine actually ships.
7. **Backlog the spec gaps:** per-lift stall state with reset-shrink and an 'LP exhausted → switch program' nudge, frequency-aware/per-cycle increments, an optional form/RIR flag, and a canonical storage unit.
