# Research: Safe progressive overload

Sourced findings behind Daily Rep's auto-progression (`src/lib/progression.ts`). Conducted via multi-source web research with an adversarial verification pass; confidence is flagged where evidence is weak.

## What the app implements

`prescribe(exercise, history, repRange, profile, occurrence?)` returns the next session's `{ weight, reps, setCount, deload, note, incWeight }` using **double progression** plus experience/body/type-scaled load increments, a safety cap, plate snapping, and a stall→deload rule.

Decision order (first match wins) — **corrected 2026-06-23** after an audit found the original logic auto-deloaded correctly-progressing lifters (see `docs/archived/progression-audit-2026-06-23.md`):
0. **Rep target changed → translate the load.** When the prescribed rep range for this lift differs from what the last session was prescribed for (goal switch, plan switch, undulating day — e.g. 5×5 → 5×15), the old weight no longer fits. Re-anchor the load via the demonstrated **estimated 1RM** (Epley) to the middle of the new range — lighter for higher reps, heavier for lower reps — then normal progression resumes. Each block stores its `targetReps`, so this never misfires on an AMRAP overshoot within the *same* scheme.
1. **Top of range reached → progress.** When every set **at the top working load** (back-off/ramp/AMRAP-lower sets don't gate) hits `repMax`: add load (reset reps to `repMin`). On a **light dumbbell/machine lift** where the smallest loadable jump would exceed the 10% cap, **bank reps past `repMax`** (up to +5) before taking the coarse jump. A **bodyweight** lift maxed out suggests an added rep / external load instead.
2. **Genuine plateau → deload.** Only when **3 consecutive same-load sessions fail to IMPROVE the top-set reps** (a true plateau — *not* merely "didn't hit `repMax`") → back off 10%, reset reps. Normal mid-range rep climbing (8→9→10 in an 8–12 range) is **progress, not a stall**.
3. **Otherwise → keep load, add a rep** (reps-first).

Per-day **occurrence** disambiguates a lift listed twice (5/3/1 main + BBB) so each block progresses from its own history. The threshold is evaluated on the **top working set(s)** only, so ascending ramps, AMRAP top sets, and back-off sets no longer veto or mislabel a session.

## Key evidence

- **Double progression** ("reps first, then load") is the consensus model; rep-progression at fixed load and load-progression yield comparable adaptations ([Plotkin 2022, PMC9528903](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9528903/)).
- **NSCA "2-for-2 rule":** add weight after exceeding the rep goal by ≥2 on the last set of two consecutive sessions ([NSCA CSCS Ch.17](https://www.ptpioneer.com/personal-training/certifications/nsca-cscs/cscs-chapter-17/)).
- **ACSM 2009 position stand:** **2–10%** load increase once 1–2 reps over target on two sessions ([Ratamess 2009, PMID 19204579](https://pubmed.ncbi.nlm.nih.gov/19204579/)).
- **Absolute increments (NSCA):** upper-body +2–5 lb (less-trained) / +5–10 lb (trained); lower-body +5–10 / +10–15. StrongLifts/Starting Strength use +5 lb most lifts, +10 lb deadlift, +2.5 lb presses, descending as you advance.
- **Stall/deload:** 3 failed sessions → −10% reset (StrongLifts, [Starting Strength reset](https://www.progressiverehabandstrength.com/articles/barbell-training-reset)). Halving the increment after a reset reduces re-stalling.
- **RPE/RIR:** RPE 10 = 0 RIR, 8 = 2 RIR, 7 = 3 RIR ([Helms/Zourdos, PMC4961270](https://pmc.ncbi.nlm.nih.gov/articles/PMC4961270/)). Strength gains are largely independent of proximity-to-failure, so you don't need to grind near failure — a safety win.
- **1RM:** Epley `1RM = w·(1 + reps/30)`; accurate ≤10 reps. (Used by `estimate1RM` for PRs.)
- **Safety:** never add load on a missed-rep session; the strict "10%/week" injury rule is **unsupported** — the better-evidenced danger line is **>30%/week** ([Nielsen, PMC6253751](https://pmc.ncbi.nlm.nih.gov/articles/PMC6253751/)). The app caps a single jump at ≤10%.

## Increment table (used by `INCREMENTS` in code)

| Experience | Upper compound | Upper isolation | Lower compound | Lower isolation |
|---|---|---|---|---|
| Beginner | +5 lb / 2.5 kg | +2.5 / 1.25 | +10 / 5 | +5 / 2.5 |
| Intermediate | +5 / 2.5 | +2.5 / 1.25 | +5 / 2.5 | +5 / 2.5 |
| Advanced | +2.5 / 1.25 | +1.25 / 0.5 | +5 / 2.5 | +2.5 / 1.25 |

All jumps additionally clamped to ≤10% of current load and snapped to plate increments (1 lb / 0.5 kg).

## Flagged / tunable
- The ACSM small-vs-large-muscle % direction is **unverified**; the upper/lower split is a reasonable proxy.
- The classic %1RM→reps table **underestimates reps at light loads** (70% ≈ 15 reps, not 11; [Nuzzo 2024, PMC10933212](https://pmc.ncbi.nlm.nih.gov/articles/PMC10933212/)) and is exercise-specific — prefer RPE below ~80% 1RM.

## Known divergences / deferred
Spec gaps the engine knowingly doesn't model yet (rationale preserved here as the source audit is archived):
- **Per-cycle 5/3/1 waves.** 5/3/1 blocks should progress per 4-week cycle, not per session ([Wendler 5/3/1](https://www.jimwendler.com/blogs/jimwendler-com/101065094-5-3-1-for-a-raw-strength); supported by Bell et al. 2025).
- **Reset-shrink / LP-exhausted state.** A reset should also cut the per-session jump, and after 2–3 resets at the same wall flag that linear progression is exhausted (Starting Strength "The Reset"; Andy Baker / Mark Rippetoe, "Limits of Linear Progression"). The increment is currently stateless.
- **RIR gate.** Load is added on rep count alone; a form/RIR flag would let the lifter veto a jump (ACSM one-variable principle; Helms/Zourdos RIR).
- **Micro-loading.** Flat per-class `loadStep`, no fractional plates — the root reason the 10% cap is unsatisfiable on light lifts, where the smallest plate jump exceeds the cap (TriageMethod, Legion; PlateMate / PowerBlock fractional adders).
