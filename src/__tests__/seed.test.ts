import { describe, it, expect } from 'vitest'
import { buildSampleHistory } from '../lib/seed'
import { getExercise } from '../data/exercises'
import { defaultBodyweight } from '../lib/stats'
import { fullGymProfile, NOW } from './fixtures'

describe('sample data generator', () => {
  const history = buildSampleHistory(fullGymProfile, NOW)

  it('produces a multi-week completed history', () => {
    expect(history.length).toBeGreaterThan(10)
    for (const w of history) {
      expect(w.status).toBe('completed')
      expect(w.completedAt!).toBeLessThanOrEqual(NOW)
      expect(w.exercises.length).toBeGreaterThan(0)
      expect(w.exercises.some((e) => e.sets.some((s) => s.done))).toBe(true)
    }
  })

  it('stores history newest-first', () => {
    for (let i = 1; i < history.length; i++) {
      expect(history[i - 1].completedAt!).toBeGreaterThanOrEqual(history[i].completedAt!)
    }
  })

  it('is deterministic — same profile + now yields identical stats-relevant data', () => {
    // ids come from uid() and don't affect any stat; compare everything else
    const project = (ws: ReturnType<typeof buildSampleHistory>) =>
      ws.map((w) => ({
        completedAt: w.completedAt,
        durationMin: w.durationMin,
        exercises: w.exercises.map((e) => ({
          exerciseId: e.exerciseId,
          sets: e.sets.map((s) => ({ weight: s.weight, reps: s.reps, done: s.done, warmup: !!s.warmup })),
        })),
      }))
    const a = project(buildSampleHistory(fullGymProfile, NOW))
    const b = project(buildSampleHistory(fullGymProfile, NOW))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('assigns realistic loads to weighted exercises', () => {
    let checkedAWeightedLift = false
    for (const w of history) {
      for (const we of w.exercises) {
        const ex = getExercise(we.exerciseId)!
        // barbell/dumbbell/machine compounds should carry load
        if (['barbell-bench-press', 'back-squat', 'deadlift', 'overhead-press'].includes(ex.id)) {
          for (const s of we.sets) expect(s.weight).toBeGreaterThan(0)
          checkedAWeightedLift = true
        }
      }
    }
    // the seed spans enough sessions that at least one of these lifts appears
    expect(checkedAWeightedLift).toBe(true)
  })

  it('freezes the effective bodyweight on every sample workout (matches finishWorkout)', () => {
    // fullGymProfile has no bodyweight set, so each session should carry the unit default
    const expected = defaultBodyweight(fullGymProfile.unit)
    for (const w of history) {
      expect(w.bodyweight).toBe(expected)
    }

    // when the profile sets a bodyweight, sessions freeze that value instead — so
    // bodyweight-exercise volume/PRs in sample data don't shift if the profile changes later
    const withBw = buildSampleHistory({ ...fullGymProfile, bodyweight: 200 }, NOW)
    for (const w of withBw) {
      expect(w.bodyweight).toBe(200)
    }
  })
})
