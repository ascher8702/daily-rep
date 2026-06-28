import type { Equipment, Exercise, Goal } from '../types'
import { getExercise, getExercisePool } from '../data/exercises'
import { isExerciseDoable } from './equipment'

/**
 * Equipment-aware exercise substitution.
 *
 * Grounded in the verified research (docs/research-program-library.md): free weights and
 * machines are equivalent for HYPERTROPHY (Haugen 2023), but strength is modality-specific
 * (SAID — Schwanbeck 2021), so swaps are kept tight for strength/powerlifting and liberal for
 * hypertrophy/general. A valid substitute always preserves the MUSCLE GROUP and MOVEMENT
 * PATTERN (Kassiano & Schoenfeld 2022). Falls back along a barbell→dumbbell→bodyweight ladder.
 */

export type MovementPattern =
  | 'horizontal-push'
  | 'vertical-push'
  | 'horizontal-pull'
  | 'vertical-pull'
  | 'squat'
  | 'hinge'
  | 'lateral-raise'
  | 'rear-delt'
  | 'face-pull'
  | 'shrug'
  | 'curl'
  | 'triceps-ext'
  | 'leg-ext'
  | 'leg-curl'
  | 'calf'
  | 'core'
  | 'wrist'
  | 'cardio'

/** Movement pattern per exercise — the substitution invariant (preserve pattern + muscle). */
export const PATTERN: Record<string, MovementPattern> = {
  // chest / horizontal push
  'barbell-bench-press': 'horizontal-push',
  'incline-bench-press': 'horizontal-push',
  'incline-db-press': 'horizontal-push',
  'db-bench-press': 'horizontal-push',
  'machine-chest-press': 'horizontal-push',
  pushup: 'horizontal-push',
  dips: 'horizontal-push',
  'cable-fly': 'horizontal-push',
  'close-grip-bench': 'horizontal-push',
  // vertical push
  'overhead-press': 'vertical-push',
  'db-shoulder-press': 'vertical-push',
  'pike-pushup': 'vertical-push',
  'kb-clean-press': 'vertical-push',
  // horizontal pull
  'barbell-row': 'horizontal-pull',
  'db-row': 'horizontal-pull',
  'seated-cable-row': 'horizontal-pull',
  'inverted-row': 'horizontal-pull',
  // vertical pull
  pullup: 'vertical-pull',
  chinup: 'vertical-pull',
  'lat-pulldown': 'vertical-pull',
  // squat / knee-dominant
  'back-squat': 'squat',
  'front-squat': 'squat',
  'leg-press': 'squat',
  'goblet-squat': 'squat',
  lunge: 'squat',
  'bulgarian-split-squat': 'squat',
  'bodyweight-squat': 'squat',
  // hinge / hip-dominant
  deadlift: 'hinge',
  'romanian-deadlift': 'hinge',
  'hip-thrust': 'hinge',
  'glute-bridge': 'hinge',
  'kb-swing': 'hinge',
  // isolations
  'lateral-raise': 'lateral-raise',
  'rear-delt-fly': 'rear-delt',
  'face-pull': 'face-pull',
  shrug: 'shrug',
  'barbell-curl': 'curl',
  'db-curl': 'curl',
  'hammer-curl': 'curl',
  'cable-curl': 'curl',
  'triceps-pushdown': 'triceps-ext',
  'overhead-triceps': 'triceps-ext',
  'bench-dip': 'triceps-ext',
  'leg-extension': 'leg-ext',
  'leg-curl': 'leg-curl',
  'standing-calf-raise': 'calf',
  'seated-calf-raise': 'calf',
  'wrist-curl': 'wrist',
  // core / cardio
  plank: 'core',
  'hanging-leg-raise': 'core',
  'cable-crunch': 'core',
  'bicycle-crunch': 'core',
  'turkish-get-up': 'core', // full-body, but its defining demand is trunk + shoulder stability
  'rowing-machine': 'cardio',
  burpee: 'cardio',
}

type Modality = 'barbell' | 'dumbbell' | 'machine' | 'bodyweight'

function modality(ex: Exercise): Modality {
  const eq = ex.equipment
  if (eq.includes('barbell') || eq.includes('ezbar')) return 'barbell'
  if (eq.includes('dumbbell') || eq.includes('kettlebell')) return 'dumbbell'
  if (eq.includes('machine') || eq.includes('cable')) return 'machine'
  return 'bodyweight'
}

function sharesPrimary(a: Exercise, b: Exercise): boolean {
  return a.primary.some((m) => b.primary.includes(m))
}

/** How tightly we must preserve the original modality, by goal (SAID). */
function modalityScore(goal: Goal, from: Modality, to: Modality): number {
  if (from === to) return 6
  // strength & powerlifting transfer is modality-specific — penalize drifting off the bar
  if (goal === 'strength' || goal === 'powerlifting') {
    if (from === 'barbell') return to === 'dumbbell' ? 2 : -2 // machine/bodyweight under-transfer to a barbell 1RM
    return 1
  }
  // hypertrophy / general / endurance — modalities are interchangeable
  return 4
}

export interface SubResult {
  /** the exercise id to actually use (== input id when nothing was substituted) */
  id: string
  substituted: boolean
  /** the original id, when substituted */
  from?: string
}

/**
 * Resolve an exercise to one the user can perform with `owned`. Returns the original when it's
 * already doable; otherwise the best pattern- and muscle-preserving alternative, goal-aware.
 * `exclude` ids are skipped when choosing a substitute, so several undoable lifts in one day don't
 * all collapse onto the same equippable exercise. When nothing suitable can be equipped, returns
 * the original unchanged (substituted: false).
 */
export function substituteExercise(
  exerciseId: string,
  owned: Set<Equipment>,
  goal: Goal,
  exclude: Set<string> = new Set(),
): SubResult {
  const ex = getExercise(exerciseId)
  if (!ex) return { id: exerciseId, substituted: false }
  // a doable original is kept as-is even if it repeats in the day (intentional, e.g. 5/3/1 main +
  // supplemental); only UNDOABLE lifts get substituted, and those avoid already-used substitutes
  if (isExerciseDoable(ex, owned)) return { id: exerciseId, substituted: false }

  const fromPattern = PATTERN[exerciseId]
  const fromMod = modality(ex)

  const score = (c: Exercise): number => {
    let s = 0
    const samePattern = PATTERN[c.id] === fromPattern
    if (samePattern) s += 20
    // shared primary muscles are the core requirement
    s += ex.primary.filter((m) => c.primary.includes(m)).length * 8
    s += ex.secondary.filter((m) => c.primary.includes(m)).length * 2
    if (c.category === ex.category) s += 4
    s += modalityScore(goal, fromMod, modality(c))
    if (c.difficulty <= ex.difficulty + 1) s += 1
    return s
  }

  // candidate pool: doable, not already used in this day, and either the same movement pattern or
  // sharing a primary muscle
  const candidates = getExercisePool().filter(
    (c) =>
      c.id !== exerciseId &&
      !exclude.has(c.id) &&
      isExerciseDoable(c, owned) &&
      (PATTERN[c.id] === fromPattern || sharesPrimary(c, ex)),
  )
  // A valid substitute MUST train at least one of the original's primary muscles — this is a
  // hard gate, not a score weight, so the same-pattern bonus can never pick an off-target lift
  // (e.g. a chest push-up for a triceps press, or a burpee for a row). If nothing shares the
  // muscle, keep the original rather than mis-target.
  const eligible = candidates.filter((c) => sharesPrimary(c, ex))
  if (eligible.length === 0) return { id: exerciseId, substituted: false }

  let best = eligible[0]
  let bestScore = score(best)
  for (const c of eligible) {
    const sc = score(c)
    if (sc > bestScore) {
      bestScore = sc
      best = c
    }
  }
  return { id: best.id, substituted: true, from: exerciseId }
}

export interface ResolvedLift<T> {
  lift: T
  sub: SubResult
}

/**
 * Apply substitution across a plan day's lifts. Returns each lift with its resolved exercise id
 * and a flat list of the swaps made (for surfacing "substituted X → Y" to the user). Drops a lift
 * only if it can't be performed AND has no substitute (rare — keeps the day non-empty otherwise).
 */
export function resolvePlanLifts<T extends { exerciseId: string }>(
  lifts: T[],
  owned: Set<Equipment>,
  goal: Goal,
): { resolved: { lift: T; exerciseId: string }[]; swaps: { from: string; to: string }[] } {
  const resolved: { lift: T; exerciseId: string }[] = []
  const swaps: { from: string; to: string }[] = []
  // exercises already placed this day — undoable lifts substitute AROUND these so a day can't show
  // the same equippable exercise four times (e.g. a barbell shoulder day collapsing to all Pike-Ups)
  const placed = new Set<string>()
  for (const lift of lifts) {
    // skip a null / malformed lift so it can never reach substituteExercise (defensive against
    // corrupt persisted custom plans that slipped past hydration validation)
    if (!lift || typeof lift.exerciseId !== 'string') continue
    const sub = substituteExercise(lift.exerciseId, owned, goal, placed)
    // if the original is undoable and we genuinely couldn't substitute, skip it
    const ex = getExercise(sub.id)
    if (!ex || !isExerciseDoable(ex, owned)) continue
    // a SUBSTITUTION that still lands on an already-placed exercise (no distinct alternative left)
    // would just duplicate it — drop it. An UNSUBSTITUTED original may legitimately repeat.
    if (sub.substituted && placed.has(sub.id)) continue
    placed.add(sub.id)
    resolved.push({ lift, exerciseId: sub.id })
    if (sub.substituted && sub.from) swaps.push({ from: sub.from, to: sub.id })
  }
  return { resolved, swaps }
}
