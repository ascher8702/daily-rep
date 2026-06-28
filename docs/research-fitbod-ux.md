# Research: Fitbod UX patterns & pain points

Sourced research informing Daily Rep's UX refinement. Summarized in our own words with citations; no copyrighted text reproduced.

## How Fitbod works (patterns to emulate)
- **Home = the workout.** Opens straight into the current day's exercise list — no start gate. A rotating **Focus Exercise** (a major compound) is pinned at top; the rest of the list adapts around it. ([Focus Exercises](https://help.fitbod.me/hc/en-us/articles/35301260960663-Focus-Exercises))
- **Exercise detail = logging.** Tapping a row opens demo/How-To, history, Replace/Swap, a rest timer, and tappable Reps/Weight fields prefilled from your history. ([Exercise Details](https://help.fitbod.me/hc/en-us/articles/30721437384215-How-to-Navigate-the-Exercise-Details-Screen))
- **Rest timer** auto-starts on logging a set, tuned per exercise, adjustable by tapping. ([Rest Timer](https://fitbod.zendesk.com/hc/en-us/articles/360006340194-Rest-Timer))
- **Real weights.** Recommendations are constrained to your available plates/dumbbells; a **Plate Calculator** rounds to the nearest loadable config (`(target−bar)/2`, heaviest plates first). ([Plate Calculator](https://fitbod.zendesk.com/hc/en-us/articles/360007700013-Plate-Calculator))
- **Warmups** auto-ramp to the first working set, barbell lifts get more steps. ([Warm-Up Sets](https://fitbod.zendesk.com/hc/en-us/articles/360006337634-Warm-Up-Sets))

## Recurring pain points (what to avoid / fix)
1. Weight suggestions land on un-loadable increments or jump illogically. ([dr-muscle](https://dr-muscle.com/fitbods-bodybuilding-workouts/))
2. Rest timer overlays and blocks the reps/weight field; can't preview the next exercise while resting. ([fitnessdrum](https://fitnessdrum.com/fitbod-review/))
3. Adding sets/exercises mid-session is unreliable and can reset completed work. ([fitnessdrum](https://fitnessdrum.com/fitbod-review/))
4. No user-built supersets. 5. Excessive exercise variation breaks per-lift progression tracking. 6. No automatic deload. 7. kg↔lb rounding bugs (toggle-twice workaround). 8. Shallow form coaching. 9. Long (~10–15 session) personalization ramp. ([indiehackers](https://www.indiehackers.com/post/fitbod-app-review-2026-honest-take-after-real-testing-45d5f07a1b))

## Prioritized improvements (→ Daily Rep status)
1. Non-blocking, forward-looking rest timer with "Up next" preview + ±15s/skip. → **done.**
2. Constrain weights to loadable values + show plate breakdown inline. → **done.**
3. Tap-friendly ± steppers with smart per-equipment increments, prefilled from last session. → **to build.**
4. Non-destructive set/exercise editing. → **already immutable.**
5. Explicit per-set progression cues (last value, reps/weight up-down badges, one-line rationale, phase chip). → **`prescribe().note` exists; surface it.**
6. Keep Focus/primary lifts stable; variation opt-in. → backlog.
7. First-class supersets. → backlog.
8. Warmups visually distinct + one-tap collapse. → **done.**
9. Correct unit handling. → done (user chose convert+round).
10. Deeper exercise detail / form cues. → How-To exists; expand later.
11. Quick-calibration onboarding (seed starting weights). → **to build.**
12. Recovery strip on home + deload awareness. → **recovery + deload exist; surface.**
