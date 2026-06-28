import type { MuscleGroup, RecoveryMap, Workout } from '../types'
import { getExercise } from '../data/exercises'
import { ALL_MUSCLES } from '../data/muscles'

const HOUR = 1000 * 60 * 60

// Recovery half-life in hours. Larger muscles take longer to recover.
const HALF_LIFE: Record<MuscleGroup, number> = {
  chest: 26,
  back: 26,
  lats: 26,
  quads: 28,
  hamstrings: 26,
  glutes: 26,
  lowerback: 30,
  shoulders: 20,
  traps: 20,
  biceps: 18,
  triceps: 18,
  forearms: 16,
  calves: 18,
  abs: 16,
}

// Fatigue points contributed per completed working set.
const PRIMARY_PER_SET = 11
const SECONDARY_PER_SET = 5

function emptyMap(value = 0): RecoveryMap {
  return ALL_MUSCLES.reduce((acc, m) => {
    acc[m] = value
    return acc
  }, {} as RecoveryMap)
}

/**
 * Fatigue a single workout deposits on each muscle, before time-decay.
 * Counts only completed, non-warmup sets. Intensity scales with reps and RPE.
 */
function workoutFatigue(w: Workout): RecoveryMap {
  const map = emptyMap()
  for (const we of w.exercises) {
    const ex = getExercise(we.exerciseId)
    if (!ex) continue
    // Rehab/therapeutic work is restorative by design — it shouldn't deposit training fatigue (and so
    // shouldn't make the engine think the injured area now needs MORE rest before it can be trained).
    if (ex.category === 'rehab') continue
    const workingSets = (we.sets ?? []).filter((s) => s.done && !s.warmup)
    if (workingSets.length === 0) continue

    // light intensity modifier: a higher exercise RPE fatigues more (unrated → neutral 1.0)
    const rpe = typeof we.rpe === 'number' && Number.isFinite(we.rpe) ? we.rpe : null
    const rpeFactor = rpe != null ? 0.7 + (rpe / 10) * 0.5 : 1
    const setUnits = workingSets.length * rpeFactor // ~= number of sets, RPE-weighted

    for (const m of ex.primary) {
      map[m] += setUnits * PRIMARY_PER_SET
    }
    for (const m of ex.secondary) {
      map[m] += setUnits * SECONDARY_PER_SET
    }
  }
  return map
}

/**
 * Build the current fatigue map (0 = fresh, 100 = fully fatigued) by summing
 * decayed contributions from every completed workout in the recent window.
 */
export function computeRecovery(workouts: Workout[], now: number): RecoveryMap {
  const fatigue = emptyMap()
  const completed = workouts.filter((w) => w.status === 'completed')

  for (const w of completed) {
    const when = w.completedAt ?? w.date
    const ageH = Math.max(0, (now - when) / HOUR)
    if (ageH > 14 * 24) continue // ignore anything older than 2 weeks

    const raw = workoutFatigue(w)
    for (const m of ALL_MUSCLES) {
      if (raw[m] === 0) continue
      const decay = Math.pow(0.5, ageH / HALF_LIFE[m])
      fatigue[m] += raw[m] * decay
    }
  }

  // clamp to 0..100
  for (const m of ALL_MUSCLES) {
    fatigue[m] = Math.min(100, Math.round(fatigue[m]))
  }
  return fatigue
}

/** Freshness = how recovered / ready a muscle is (0 fatigued .. 100 fresh). */
export function freshnessFromFatigue(fatigue: RecoveryMap): RecoveryMap {
  const out = emptyMap()
  for (const m of ALL_MUSCLES) out[m] = 100 - fatigue[m]
  return out
}

export function recoveryLabel(freshness: number): string {
  if (freshness >= 80) return 'Fresh'
  if (freshness >= 55) return 'Ready'
  if (freshness >= 30) return 'Fatigued'
  return 'Needs rest'
}

/** A discrete recovery tier mapped to a Charge/Blaze color TOKEN name (for token-driven bars/rings —
 *  no inline hex). ≥70 → fresh (lime), ≥40 → moderate (amber), else → needs-rest (rose). The continuous
 *  `recoveryColor` ramp below is kept for the body diagram's smooth per-muscle gradient. */
export type RecoveryTone = 'recovery-fresh' | 'recovery-moderate' | 'recovery-rest'
export function recoveryToken(freshness: number): RecoveryTone {
  if (freshness >= 70) return 'recovery-fresh'
  if (freshness >= 40) return 'recovery-moderate'
  return 'recovery-rest'
}

/** Color ramp from red (fatigued) -> amber -> green (fresh). */
export function recoveryColor(freshness: number): string {
  // 0 -> red, 50 -> amber, 100 -> green
  const f = Math.max(0, Math.min(100, freshness)) / 100
  const hue = f * 130 // 0 red .. 130 green
  const sat = 70
  const light = 45 + (1 - Math.abs(f - 0.5) * 2) * 6
  return `hsl(${hue} ${sat}% ${light}%)`
}
