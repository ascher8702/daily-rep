import type { MuscleGroup, Profile, Workout } from '../types'
import { generateWorkout } from './generator'
import { startingWeight } from './weights'
import { getExercise } from '../data/exercises'
import { defaultBodyweight } from './stats'

const DAY = 1000 * 60 * 60 * 24

/** Deterministic PRNG so reloading sample data yields stable Progress/PR numbers. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ROTATION: MuscleGroup[][] = [
  ['chest', 'shoulders', 'triceps'],
  ['back', 'lats', 'biceps'],
  ['quads', 'hamstrings', 'glutes', 'calves'],
]

/**
 * Build a realistic, progressively-loaded training history for the last ~8 weeks.
 * Each session is generated with the real generator (so exercise selection is
 * plausible) then its sets are filled in as completed with progressive weights —
 * the generator's own overload nudge compounds week over week.
 */
export function buildSampleHistory(profile: Profile, now: number): Workout[] {
  const weeks = 8
  const sessionsPerWeek = 3
  const history: Workout[] = []
  const rand = mulberry32(0x5eed1234)
  // freeze the profile's effective bodyweight onto each session (matches finishWorkout),
  // so bodyweight-exercise volume/PRs in sample data don't shift when profile.bodyweight changes
  const bodyweight =
    profile.bodyweight && profile.bodyweight > 0
      ? profile.bodyweight
      : defaultBodyweight(profile.unit)

  for (let week = 0; week < weeks; week++) {
    for (let s = 0; s < sessionsPerWeek; s++) {
      const idx = week * sessionsPerWeek + s
      // spread sessions Mon/Wed/Fri-ish through each past week
      const weeksAgo = weeks - week
      const when = now - weeksAgo * 7 * DAY + (s * 2 + 1) * DAY + (idx % 3) * 1000 * 60 * 37
      if (when >= now) continue

      const focus = ROTATION[idx % ROTATION.length]
      const w = generateWorkout(profile, history, when, { focusOverride: focus, shuffle: idx })

      let workingSets = 0
      for (const we of w.exercises) {
        const ex = getExercise(we.exerciseId)
        const fallback = ex ? startingWeight(ex, profile) : 0
        for (const set of we.sets) {
          if (set.weight === 0 && fallback > 0) set.weight = fallback
          // occasional rep variation for realism (deterministic)
          if (!set.warmup && rand() < 0.3) {
            set.reps = Math.max(we.targetReps[0], set.reps - 1 + (rand() < 0.5 ? 0 : 2))
          }
          set.done = true
          if (!set.warmup) {
            workingSets++
            // log an RPE roughly in the working range
            set.rpe = ex?.category === 'compound' ? 8 : 7
          }
        }
      }

      // every generated session has working sets, but guard anyway
      if (workingSets === 0) continue
      const durationMin = w.durationMin ?? 45
      history.push({
        ...w,
        status: 'completed',
        completedAt: when,
        startedAt: when - durationMin * 60000,
        durationMin,
        bodyweight,
        id: 'seed-' + idx,
      })
    }
  }

  // store keeps history newest-first
  return history.sort((a, b) => (b.completedAt ?? b.date) - (a.completedAt ?? a.date))
}
