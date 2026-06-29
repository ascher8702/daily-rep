import { describe, it, expect } from 'vitest'
import type { Workout } from '../types'
import { prescribe } from '../lib/progression'
import { barWeight } from '../lib/weights'
import { getExercise } from '../data/exercises'
import { fullGymProfile, NOW } from './fixtures'

const bench = getExercise('barbell-bench-press')!
const squat = getExercise('back-squat')!
const DAY = 86400000

/** A session where every working set is at the same weight. `target` = the rep range it was
 *  prescribed for (must match the range you later call prescribe() with, as the real app does). */
function session(exerciseId: string, weight: number, reps: number[], when: number, target: [number, number] = [8, 12]): Workout {
  return sessionSets(exerciseId, reps.map((r) => ({ weight, reps: r })), when, target)
}

/** A session with explicit per-set {weight, reps} — for ascending ramps, AMRAP top sets, back-offs. */
function sessionSets(exerciseId: string, sets: { weight: number; reps: number }[], when: number, target: [number, number] = [8, 12]): Workout {
  return {
    id: 'w' + when + exerciseId,
    date: when,
    status: 'completed',
    title: 't',
    focus: [],
    completedAt: when,
    exercises: [
      {
        exerciseId,
        targetReps: target,
        sets: sets.map((s, i) => ({ id: String(i), weight: s.weight, reps: s.reps, done: true })),
      },
    ],
  }
}

describe('prescribe — double progression', () => {
  it('returns null with no history', () => {
    expect(prescribe(bench, [], [8, 12], fullGymProfile)).toBeNull()
  })

  it('adds load and resets reps when all sets hit the top', () => {
    const p = prescribe(bench, [session('barbell-bench-press', 135, [12, 12, 12], NOW)], [8, 12], fullGymProfile)!
    expect(p.deload).toBe(false)
    expect(p.weight).toBeGreaterThan(135)
    expect(p.reps).toBe(8)
    expect(p.incWeight).toBeGreaterThan(0)
  })

  it('keeps load and adds a rep when below the top', () => {
    const p = prescribe(bench, [session('barbell-bench-press', 135, [9, 9, 8], NOW)], [8, 12], fullGymProfile)!
    expect(p.weight).toBe(135)
    expect(p.reps).toBe(10) // bestReps (9) + 1
    expect(p.deload).toBe(false)
  })

  it('deloads ~10% only after a GENUINE plateau (3 same-load sessions with no rep improvement)', () => {
    const hist = [
      session('barbell-bench-press', 135, [10, 10, 10], NOW),
      session('barbell-bench-press', 135, [10, 10, 10], NOW - 3 * DAY),
      session('barbell-bench-press', 135, [10, 10, 10], NOW - 6 * DAY),
    ]
    const p = prescribe(bench, hist, [8, 12], fullGymProfile)!
    expect(p.deload).toBe(true)
    expect(p.weight).toBeLessThan(135)
    expect(p.weight).toBeGreaterThanOrEqual(120) // ~10% off
  })

  it('does NOT deload while reps are still climbing toward the top (the critical bug)', () => {
    // 8 → 9 → 10 at the same load is textbook progress, not a stall
    const hist = [
      session('lat-pulldown', 120, [10, 10, 10], NOW),
      session('lat-pulldown', 120, [9, 9, 9], NOW - 3 * DAY),
      session('lat-pulldown', 120, [8, 8, 8], NOW - 6 * DAY),
    ]
    const p = prescribe(getExercise('lat-pulldown')!, hist, [8, 12], fullGymProfile)!
    expect(p.deload).toBe(false)
    expect(p.weight).toBe(120)
    expect(p.reps).toBe(11) // keep climbing
    expect(p.repsDir).toBe('up')
  })

  it('caps the load jump at ~10% of current weight on light lifts', () => {
    const beginner = { ...fullGymProfile, experience: 'beginner' as const }
    const p = prescribe(squat, [session('back-squat', 50, [12, 12, 12], NOW)], [8, 12], beginner)!
    expect(p.weight - 50).toBeLessThanOrEqual(5)
    expect(p.weight).toBeGreaterThan(50)
  })

  it('uses larger increments for lower-body compounds than upper isolation', () => {
    const beginnerProfile = { ...fullGymProfile, experience: 'beginner' as const }
    const squatP = prescribe(squat, [session('back-squat', 200, [12, 12, 12], NOW)], [8, 12], beginnerProfile)!
    const benchP = prescribe(bench, [session('barbell-bench-press', 200, [12, 12, 12], NOW)], [8, 12], beginnerProfile)!
    expect(squatP.weight - 200).toBeGreaterThan(benchP.weight - 200)
  })
})

// Regression suite for the 2026-06-23 progression audit — each is a verified live repro of a bug
// where a CORRECTLY-progressing lifter was punished. These must never regress.
describe('prescribe — audit regressions (progressing lifters must progress)', () => {
  const ohp = getExercise('overhead-press')!
  const lat = getExercise('lateral-raise')!

  it('a 5/3/1-style ascending+AMRAP wave ADDS load (not deloads) when the top set beats the range', () => {
    // [95×5, 105×3, 115×AMRAP] with AMRAP climbing 8→9→10 over 3 sessions, range [1,5]
    const mk = (amrap: number, when: number) =>
      sessionSets('overhead-press', [{ weight: 95, reps: 5 }, { weight: 105, reps: 3 }, { weight: 115, reps: amrap }], when, [1, 5])
    const hist = [mk(10, NOW), mk(9, NOW - 3 * DAY), mk(8, NOW - 6 * DAY)]
    const p = prescribe(ohp, hist, [1, 5], fullGymProfile)!
    expect(p.deload).toBe(false)
    expect(p.weight).toBeGreaterThan(115) // progresses UP from the working load
    expect(p.weightDir).toBe('up')
  })

  it('a deliberately lighter back-off set does not veto the load increase the top sets earned', () => {
    // top sets 225×5,225×5 (hit the [3,5] range) + a 185×3 back-off
    const p = prescribe(squat, [sessionSets('back-squat', [{ weight: 225, reps: 5 }, { weight: 225, reps: 5 }, { weight: 185, reps: 3 }], NOW, [3, 5])], [3, 5], fullGymProfile)!
    expect(p.weight).toBeGreaterThan(225)
    expect(p.deload).toBe(false)
    expect(p.incWeight).toBeGreaterThan(0)
  })

  it('the same lift listed twice in a day progresses each block from its OWN history (occurrence)', () => {
    // a 5/3/1 + BBB OHP day: block 0 heavy @115, block 1 BBB @65
    const day: Workout = {
      id: 'wbbb', date: NOW, status: 'completed', title: 't', focus: [], completedAt: NOW,
      exercises: [
        { exerciseId: 'overhead-press', instanceId: 'A', targetReps: [1, 5], sets: [
          { id: 'a1', weight: 115, reps: 5, done: true }, { id: 'a2', weight: 115, reps: 5, done: true }, { id: 'a3', weight: 115, reps: 5, done: true } ] },
        { exerciseId: 'overhead-press', instanceId: 'B', targetReps: [10, 10], sets: [
          { id: 'b1', weight: 65, reps: 10, done: true }, { id: 'b2', weight: 65, reps: 10, done: true } ] },
      ],
    }
    const heavy = prescribe(ohp, [day], [1, 5], fullGymProfile, 0)!
    const bbb = prescribe(ohp, [day], [10, 10], fullGymProfile, 1)!
    expect(heavy.weight).toBeGreaterThan(115) // progressed from the 115 block
    expect(bbb.weight).toBeGreaterThan(65) // progressed from the 65 block…
    expect(bbb.weight).toBeLessThan(heavy.weight) // …NOT conflated with the heavy block
  })

  it('a dropped (un-logged) block of a repeated lift cold-starts, not inherits the sibling block', () => {
    // a repeated-lift day where ONLY the supplemental block (planSlot 1) was logged — finishWorkout
    // drops the un-logged main block, so history carries a single block tagged planSlot:1
    const day: Workout = {
      id: 'wdrop', date: NOW, status: 'completed', title: 't', focus: [], completedAt: NOW,
      exercises: [
        { exerciseId: 'overhead-press', instanceId: 'B', planSlot: 1, targetReps: [10, 10], sets: [
          { id: 'b1', weight: 65, reps: 10, done: true }, { id: 'b2', weight: 65, reps: 10, done: true } ] },
      ],
    }
    // the main block (slot 0) has no logged history → cold start (null → caller seeds a starting load)
    expect(prescribe(ohp, [day], [1, 5], fullGymProfile, 0)).toBeNull()
    // the supplemental block (slot 1) reads its OWN history and progresses from 65
    const supp = prescribe(ohp, [day], [10, 10], fullGymProfile, 1)!
    expect(supp.weight).toBeGreaterThan(65)
  })

  it('a light dumbbell banks reps past the range instead of taking a >10% jump', () => {
    // 15 lb laterals hitting 12 reps: next dumbbell is 20 lb (+33%) — bank reps first
    const p = prescribe(lat, [session('lateral-raise', 15, [12, 12, 12], NOW)], [8, 12], fullGymProfile)!
    expect(p.weight).toBe(15) // held, not jumped
    expect(p.reps).toBe(13) // banking a rep beyond repMax
    expect(p.incWeight).toBeUndefined()
  })

  it('takes the dumbbell jump once enough reps are banked', () => {
    const p = prescribe(lat, [session('lateral-raise', 15, [17, 17, 17], NOW)], [8, 12], fullGymProfile)!
    expect(p.weight).toBeGreaterThan(15) // now the jump is earned
    expect(p.reps).toBe(8) // reset to the bottom of the range
  })

  it('a maxed-out bodyweight lift still gets a progression cue (add a rep / add load)', () => {
    const pullup = getExercise('pullup')!
    const p = prescribe(pullup, [session('pullup', 0, [12, 12], NOW)], [8, 12], fullGymProfile)!
    expect(p.weight).toBe(0)
    expect(p.reps).toBe(13) // suggest a rep beyond the top
    expect(p.repsDir).toBe('up')
    expect(p.note).toBeTruthy() // never a silent "nothing" cue
  })
})

// When the prescribed REP TARGET changes between sessions (goal switch, plan switch, undulating day)
// the load must follow the rep–load tradeoff — NOT stay anchored to the old weight.
describe('prescribe — rep-target change translates the load (rep–load tradeoff)', () => {
  // a session helper that records the rep range it was prescribed for
  const sessTarget = (exerciseId: string, weight: number, reps: number, sets: number, target: [number, number]): Workout => ({
    id: 'wt' + weight + reps, date: NOW, completedAt: NOW, status: 'completed', title: 't', focus: [],
    exercises: [{ exerciseId, targetReps: target, sets: Array.from({ length: sets }, (_, i) => ({ id: String(i), weight, reps, done: true })) }],
  })

  it('drops the weight when the rep target jumps UP (185×5 → 15-rep scheme is NOT 185)', () => {
    const p = prescribe(bench, [sessTarget('barbell-bench-press', 185, 5, 5, [5, 5])], [15, 15], fullGymProfile)!
    expect(p.weight).toBeLessThan(185) // lighter for 15 reps
    expect(p.weight).toBeGreaterThan(120) // …but in a sane e1RM range (~145), not a collapse
    expect(p.reps).toBe(15)
    expect(p.weightDir).toBe('down')
  })

  it('raises the weight when the rep target drops (high-rep history → a 3–5 scheme is heavier)', () => {
    const p = prescribe(bench, [sessTarget('barbell-bench-press', 145, 15, 5, [12, 15])], [3, 5], fullGymProfile)!
    expect(p.weight).toBeGreaterThan(145)
    expect(p.weightDir).toBe('up')
  })

  it('does NOT re-anchor when the scheme is unchanged — normal double progression continues', () => {
    const p = prescribe(bench, [sessTarget('barbell-bench-press', 135, 12, 3, [8, 12])], [8, 12], fullGymProfile)!
    expect(p.weight).toBeGreaterThan(135) // adds load (hit the top), not an e1RM re-anchor
    expect(p.reps).toBe(8)
    expect(p.incWeight).toBeGreaterThan(0)
  })

  it('the translated load is consistent with the demonstrated 1RM (Epley)', () => {
    // 185×5 ⇒ e1RM ≈ 216; a 15-rep target ⇒ ~216/(1+15/30) ≈ 144 → snaps to a loadable ~145
    const p = prescribe(bench, [sessTarget('barbell-bench-press', 185, 5, 5, [5, 5])], [15, 15], fullGymProfile)!
    expect(p.weight).toBeGreaterThanOrEqual(140)
    expect(p.weight).toBeLessThanOrEqual(150)
  })

  it('clamps Epley reps so a high-rep burnout history does not over-prescribe a heavy load', () => {
    // 135×40 (a burnout/AMRAP set) → switching to a 3-5 scheme. Unclamped Epley would say e1RM≈315
    // and prescribe ~280 lb; clamping reps at 12 keeps it sane (~165 lb), never above the raw weight×~1.4.
    const p = prescribe(bench, [sessTarget('barbell-bench-press', 135, 40, 3, [15, 20])], [3, 5], fullGymProfile)!
    expect(p.weight).toBeGreaterThan(135) // heavier for lower reps…
    expect(p.weight).toBeLessThanOrEqual(190) // …but not a dangerous 280 lb blow-up
  })
})

describe('prescribe — never stalls on sub-resolution increments (regression)', () => {
  const curl = getExercise('barbell-curl')! // barbell upper-isolation: advanced inc is 1.25 lb
  const advanced = { ...fullGymProfile, experience: 'advanced' as const }

  it('advances an advanced barbell-isolation lift every session instead of stalling at the same load forever', () => {
    let weight = 65
    for (let i = 0; i < 6; i++) {
      const p = prescribe(curl, [session('barbell-curl', weight, [12, 12, 12], NOW)], [8, 12], advanced)!
      expect(p.weight).toBeGreaterThan(weight) // a real, loadable increase — no infinite stall
      expect((p.weight - barWeight('lb')) % 5).toBe(0) // and it's actually loadable on the bar
      expect(p.weightDir).toBe('up')
      weight = p.weight
    }
  })

  it('never emits a self-contradicting "+0 · hit your reps" cue', () => {
    const p = prescribe(curl, [session('barbell-curl', 65, [12, 12, 12], NOW)], [8, 12], advanced)!
    expect(p.incWeight ?? 0).toBeGreaterThan(0)
    expect(p.note).toBe('hit your reps')
    expect(p.weightDir).toBe('up')
  })

  it('honestly holds (no phantom −10%) when a dumbbell lift is at its lightest notch and still climbing', () => {
    const lat = getExercise('lateral-raise')!
    const p = prescribe(lat, [session('lateral-raise', 5, [9, 9, 8], NOW)], [8, 12], fullGymProfile)!
    expect(p.weight).toBe(5)
    expect(p.deload).toBe(false)
    expect(p.weightDir).toBe('same')
    expect(p.note ?? '').not.toContain('Deload')
  })

  it('deloads a genuinely-plateaued light dumbbell lift by a real notch', () => {
    const lat = getExercise('lateral-raise')!
    const hist = [
      session('lateral-raise', 15, [10, 10, 10], NOW),
      session('lateral-raise', 15, [10, 10, 10], NOW - 3 * DAY),
      session('lateral-raise', 15, [10, 10, 10], NOW - 6 * DAY),
    ]
    const p = prescribe(lat, hist, [8, 12], fullGymProfile)!
    expect(p.weight).toBeLessThan(15)
    expect(p.deload).toBe(true)
    expect(p.weightDir).toBe('down')
  })
})

// A1: roundToAchievable's non-finite guard is the engine's last line of defense — a NaN/Infinity top
// weight (which collapses to topSets=[] → roundToAchievable(NaN)) must never leave a non-finite weight
// in the prescription. (The PRIMARY fix is hydration-time coercion of corrupt set values — see
// mergePersisted-hydration.test.ts, which routes negative/string values through the real adopt path.)
describe('prescribe — non-finite history weight never yields a non-finite prescribed weight', () => {
  it('a NaN set weight does not propagate to the prescribed weight', () => {
    const hist = [sessionSets('barbell-bench-press', [{ weight: NaN, reps: 12 }, { weight: NaN, reps: 12 }], NOW)]
    const p = prescribe(bench, hist, [8, 12], fullGymProfile)!
    expect(Number.isFinite(p.weight)).toBe(true)
    expect(p.weight).toBeGreaterThanOrEqual(0)
  })

  it('an Infinity set weight does not yield a non-finite prescribed weight', () => {
    const hist = [sessionSets('barbell-bench-press', [{ weight: Infinity, reps: 12 }], NOW)]
    const p = prescribe(bench, hist, [8, 12], fullGymProfile)!
    expect(Number.isFinite(p.weight)).toBe(true)
    expect(p.weight).toBeGreaterThanOrEqual(0)
  })
})
