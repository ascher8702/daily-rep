import { describe, it, expect } from 'vitest'
import type { Avoidance, Equipment, MuscleGroup, Workout } from '../types'
import { generateWorkout, suggestedFocus, shouldWarmup, lastPerformance, warmupSets } from '../lib/generator'
import { getExercise } from '../data/exercises'
import { fullGymProfile, PUSH, NOW, completedWorkout } from './fixtures'

// muscle preferences live in the unified `avoiding` list now (see injuries.test.ts for full coverage)
const skip = (...muscles: MuscleGroup[]): Avoidance[] =>
  muscles.map((muscle) => ({ id: `p-${muscle}`, kind: 'preference', muscle, createdAt: NOW, includeInPlans: false }))

describe('generateWorkout — avoid areas (injury/preference)', () => {
  it('never programs an exercise whose PRIMARY muscle is an avoided area', () => {
    const w = generateWorkout({ ...fullGymProfile, avoiding: skip('chest') }, [], NOW)
    for (const we of w.exercises) {
      const ex = getExercise(we.exerciseId)!
      expect(ex.primary, `${ex.name} primarily trains an avoided muscle`).not.toContain('chest')
    }
    expect(w.exercises.length).toBeGreaterThan(0) // still a full session
  })

  it('still builds a non-empty session even with several avoided areas', () => {
    const avoid: MuscleGroup[] = ['chest', 'quads', 'back']
    const w = generateWorkout({ ...fullGymProfile, avoiding: skip(...avoid) }, [], NOW)
    expect(w.exercises.length).toBeGreaterThan(0)
    for (const we of w.exercises) {
      const ex = getExercise(we.exerciseId)!
      expect(avoid.some((m) => ex.primary.includes(m))).toBe(false)
    }
  })
})

describe('lastPerformance (set-row "last time" reference)', () => {
  it('returns the working sets of the most recent completed session with the lift', () => {
    const older = completedWorkout('barbell-bench-press', NOW - 7 * 86400000, 135)
    const newer = completedWorkout('barbell-bench-press', NOW - 2 * 86400000, 145)
    // order in history should not matter — it sorts by recency
    const last = lastPerformance('barbell-bench-press', [older, newer])
    expect(last).not.toBeNull()
    expect(last!.every((s) => s.weight === 145)).toBe(true)
    expect(last).toHaveLength(3)
  })

  it('returns null when no completed session has the lift', () => {
    expect(lastPerformance('barbell-bench-press', [])).toBeNull()
    const other = completedWorkout('barbell-squat', NOW, 225)
    expect(lastPerformance('barbell-bench-press', [other])).toBeNull()
  })

  it('ignores warm-up and unfinished sets', () => {
    const w: Workout = {
      id: 'w1', date: NOW, status: 'completed', title: 't', focus: [], completedAt: NOW, startedAt: NOW,
      exercises: [
        {
          exerciseId: 'barbell-bench-press',
          targetReps: [5, 5],
          sets: [
            { id: 'a', weight: 95, reps: 5, done: true, warmup: true }, // warm-up — excluded
            { id: 'b', weight: 185, reps: 5, done: true }, // counts
            { id: 'c', weight: 185, reps: 4, done: false }, // not done — excluded
          ],
        },
      ],
    }
    const last = lastPerformance('barbell-bench-press', [w])
    expect(last).toEqual([{ weight: 185, reps: 5 }])
  })
})

describe('shouldWarmup (shared warm-up gate)', () => {
  it('warms up strength/powerlifting/hypertrophy but not general/endurance', () => {
    expect(shouldWarmup('strength')).toBe(true)
    expect(shouldWarmup('powerlifting')).toBe(true)
    expect(shouldWarmup('hypertrophy')).toBe(true)
    expect(shouldWarmup('general')).toBe(false)
    expect(shouldWarmup('endurance')).toBe(false)
  })
})

describe('suggestedFocus', () => {
  it('only suggests muscles the user can actually train with their equipment', () => {
    // bodyweight-only: traps has no doable exercise (shrug/face-pull need weights)
    const bw = { ...fullGymProfile, equipment: ['bodyweight'] as Equipment[] }
    const muscles = suggestedFocus([], NOW, bw).map((s) => s.muscle)
    expect(muscles).not.toContain('traps')
    expect(muscles).toContain('chest') // push-ups exist
  })

  it('suggests all muscles when no profile is given', () => {
    expect(suggestedFocus([], NOW).length).toBe(14)
  })
})

describe('generateWorkout robustness', () => {
  it('produces a usable session even when the duration is non-finite', () => {
    const w = generateWorkout({ ...fullGymProfile, sessionLength: NaN }, [], NOW)
    expect(w.exercises.length).toBeGreaterThanOrEqual(3)
  })
})

describe('generateWorkout — explicit focus', () => {
  it('only programs exercises that train a target muscle', () => {
    const w = generateWorkout(fullGymProfile, [], NOW, { focusOverride: PUSH })
    expect(w.exercises.length).toBeGreaterThan(0)
    for (const we of w.exercises) {
      const ex = getExercise(we.exerciseId)!
      const hits = [...ex.primary, ...ex.secondary].some((m) => PUSH.includes(m))
      expect(hits, `${we.exerciseId} should train a push muscle`).toBe(true)
    }
  })

  // Regression: a "Push" day must not pull in deadlifts, rows or leg presses.
  it('excludes clearly off-target compounds on a push day', () => {
    for (let s = 0; s < 10; s++) {
      const w = generateWorkout(fullGymProfile, [], NOW, { focusOverride: PUSH, shuffle: s })
      const ids = w.exercises.map((e) => e.exerciseId)
      expect(ids).not.toContain('deadlift')
      expect(ids).not.toContain('barbell-row')
      expect(ids).not.toContain('leg-press')
      expect(ids).not.toContain('back-squat')
    }
  })
})

describe('generateWorkout — constraints', () => {
  it('only programs exercises the user has equipment for', () => {
    const dbProfile = { ...fullGymProfile, equipment: ['dumbbell', 'bench', 'bodyweight'] as Equipment[] }
    const w = generateWorkout(dbProfile, [], NOW)
    for (const we of w.exercises) {
      const ex = getExercise(we.exerciseId)!
      const ok = ex.equipment.some((eq) => eq === 'bodyweight' || dbProfile.equipment.includes(eq))
      expect(ok, `${we.exerciseId} needs equipment the user lacks`).toBe(true)
    }
  })

  it('does not give beginners difficulty-3 lifts', () => {
    const beginner = { ...fullGymProfile, experience: 'beginner' as const }
    for (let s = 0; s < 6; s++) {
      const w = generateWorkout(beginner, [], NOW, { shuffle: s })
      for (const we of w.exercises) {
        expect(getExercise(we.exerciseId)!.difficulty).toBeLessThanOrEqual(2)
      }
    }
  })

  it('fits more exercises into longer sessions', () => {
    const short = generateWorkout({ ...fullGymProfile, sessionLength: 25 }, [], NOW)
    const long = generateWorkout({ ...fullGymProfile, sessionLength: 85 }, [], NOW)
    expect(long.exercises.length).toBeGreaterThanOrEqual(short.exercises.length)
    expect(short.exercises.length).toBeGreaterThanOrEqual(3)
  })

  it('orders compounds before isolation/accessory work', () => {
    const w = generateWorkout(fullGymProfile, [], NOW)
    const rank: Record<string, number> = { compound: 0, isolation: 1, core: 2, cardio: 3 }
    const ranks = w.exercises.map((e) => rank[getExercise(e.exerciseId)!.category])
    const sorted = [...ranks].sort((a, b) => a - b)
    expect(ranks).toEqual(sorted)
  })

  // Regression: a strict focus that no available exercise can satisfy must still
  // return a usable session rather than an empty 'Full Body' shell.
  it('never returns an empty session under an unsatisfiable strict focus', () => {
    const bodyweightOnly = { ...fullGymProfile, equipment: ['bodyweight'] as Equipment[] }
    const w = generateWorkout(bodyweightOnly, [], NOW, { focusOverride: ['traps'] })
    expect(w.exercises.length).toBeGreaterThan(0)
  })

  it('applies a goal override (a plan strength day prescribes low reps)', () => {
    const strengthDay = generateWorkout(fullGymProfile, [], NOW, {
      focusOverride: PUSH,
      goalOverride: 'strength',
    })
    const enduranceDay = generateWorkout(fullGymProfile, [], NOW, {
      focusOverride: PUSH,
      goalOverride: 'endurance',
    })
    const avgTop = (w: typeof strengthDay) =>
      w.exercises.reduce((a, e) => a + e.targetReps[1], 0) / w.exercises.length
    // strength day should target meaningfully fewer reps than an endurance day
    expect(avgTop(strengthDay)).toBeLessThan(avgTop(enduranceDay))
  })

  it('honors an equipment override (bodyweight plan stays bodyweight-doable)', () => {
    const w = generateWorkout(fullGymProfile, [], NOW, {
      focusOverride: ['chest', 'lats', 'triceps', 'biceps'],
      equipmentOverride: ['bodyweight', 'pullupbar', 'bands'],
    })
    const ownedBw = new Set<Equipment>(['bodyweight', 'pullupbar', 'bands'])
    for (const we of w.exercises) {
      const ex = getExercise(we.exerciseId)!
      const co = ex.equipment.filter((e) => e === 'bench')
      expect(co.length, `${we.exerciseId} needs a bench, not in a bodyweight plan`).toBe(0)
      const ok = ex.equipment.every(
        (e) => e === 'bodyweight' || e === 'pullupbar' || ownedBw.has(e) || e === 'bands',
      )
      expect(ok || ex.equipment.some((e) => e === 'bodyweight' || ownedBw.has(e))).toBe(true)
    }
  })
})

describe('warmupSets (shared warm-up ramp)', () => {
  const bench = getExercise('barbell-bench-press')!

  it('is empty when there is no working load to ramp toward', () => {
    expect(warmupSets(0, bench, 'lb', 5)).toEqual([])
    expect(warmupSets(-10, bench, 'lb', 5)).toEqual([])
  })

  it('ramps ~50% then ~75% with descending reps, all flagged warm-up + not done', () => {
    const w = warmupSets(100, bench, 'lb', 5)
    expect(w).toHaveLength(2)
    expect(w.every((s) => s.warmup === true && s.done === false)).toBe(true)
    expect(w.map((s) => s.reps)).toEqual([8, 4]) // min(8,5+3)=8 ; max(3,5-1)=4
    expect(w[0].weight).toBeGreaterThan(40) // ≈50% of 100, plate-rounded
    expect(w[0].weight).toBeLessThan(w[1].weight) // ascending ramp
    expect(w[1].weight).toBeLessThan(100) // below the working load
    expect(new Set(w.map((s) => s.id)).size).toBe(2) // unique ids
  })

  it('caps the first warm-up at 8 reps and keeps the second strictly below it (no inversion)', () => {
    // high working reps must NOT invert the ramp — heavier set always has FEWER reps than the lighter
    expect(warmupSets(100, bench, 'lb', 20).map((s) => s.reps)).toEqual([8, 7]) // first 8 ; second min(7,…)=7
    expect(warmupSets(100, bench, 'lb', 12).map((s) => s.reps)).toEqual([8, 7])
    expect(warmupSets(100, bench, 'lb', 1).map((s) => s.reps)).toEqual([4, 3]) // min(8,4)=4 ; max(3,0)→3
  })

  it('floors a 0/negative/non-finite work-rep set to a sane descending ramp (not [3,3])', () => {
    expect(warmupSets(100, bench, 'lb', 0).map((s) => s.reps)).toEqual([4, 3])
    expect(warmupSets(100, bench, 'lb', -5).map((s) => s.reps)).toEqual([4, 3])
    expect(warmupSets(100, bench, 'lb', NaN).map((s) => s.reps)).toEqual([4, 3])
  })

  it('always ramps reps strictly downward as weight rises, across the rep range', () => {
    for (let wr = -2; wr <= 25; wr++) {
      const reps = warmupSets(100, bench, 'lb', wr).map((s) => s.reps)
      expect(reps[0]).toBeGreaterThan(reps[1]) // lighter set has more reps than the heavier set
      expect(reps[1]).toBeGreaterThanOrEqual(3) // never below the floor
    }
  })
})
