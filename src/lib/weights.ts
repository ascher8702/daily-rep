import type { Equipment, Exercise, Profile, Unit } from '../types'

/**
 * Snap a target weight to a value you could actually load in a gym, based on how the
 * exercise is loaded: a barbell rounds to the bar plus symmetric plate pairs; dumbbells,
 * machines and cables round to their real increments. Keeps prescriptions believable
 * (no "47 lb barbell") — see docs/research-progressive-overload.md.
 */

type LoadType = 'barbell' | 'dumbbell' | 'machine' | 'bodyweight'

function loadType(ex: Exercise): LoadType {
  const eq = ex.equipment
  if (eq.includes('barbell') || eq.includes('ezbar')) return 'barbell'
  if (eq.includes('dumbbell') || eq.includes('kettlebell')) return 'dumbbell'
  if (eq.includes('machine') || eq.includes('cable')) return 'machine'
  return 'bodyweight'
}

/** Bar weight by unit (standard Olympic bar). */
export function barWeight(unit: Unit): number {
  return unit === 'kg' ? 20 : 45
}

/**
 * Whether a movement is performed against bodyweight, so a logged set with no external
 * load should read "BW" rather than "—". Intentionally category-agnostic: core moves
 * (plank, hanging leg raise) are bodyweight too, even though they add no tonnage.
 */
export function isBodyweightExercise(ex: Exercise): boolean {
  return ex.equipment.includes('bodyweight')
}

function roundToStep(weight: number, step: number): number {
  return Math.round(weight / step) * step
}

const PLATES_LB = [45, 35, 25, 10, 5, 2.5]
const PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25]

/**
 * The plates to load on EACH side of the bar for a barbell weight (heaviest first),
 * or null if the exercise isn't barbell-loaded. Used to show "= bar + 45, 25 / side".
 */
export function platesPerSide(weight: number, ex: Exercise, unit: Unit): number[] | null {
  if (loadType(ex) !== 'barbell') return null
  const bar = barWeight(unit)
  if (weight <= bar) return []
  let perSide = (weight - bar) / 2
  const plates = unit === 'kg' ? PLATES_KG : PLATES_LB
  const result: number[] = []
  for (const p of plates) {
    while (perSide >= p - 1e-6) {
      result.push(p)
      perSide -= p
    }
  }
  return result
}

export interface PlateLoad {
  /** the bar's own weight in `unit` */
  bar: number
  /** plates to add on EACH side, grouped by size, heaviest first */
  perSide: { plate: number; count: number }[]
  /** weight actually on the bar = bar + 2 × Σ(plate × count) */
  loaded: number
  /** per-side weight the standard plate set can't make up (>0 when the target isn't exactly loadable) */
  remainderPerSide: number
}

/** Structured plate breakdown for the plate-calculator sheet: the bar, the grouped per-side plates,
 *  the exact loaded total, and any per-side remainder standard plates can't reach. Returns null for a
 *  non-barbell lift (dumbbell / machine / cable / bodyweight) — those have nothing to load on a bar. */
export function plateLoad(weight: number, ex: Exercise, unit: Unit): PlateLoad | null {
  const plates = platesPerSide(weight, ex, unit)
  if (plates === null) return null // not a barbell lift
  const bar = barWeight(unit)
  const perSide: { plate: number; count: number }[] = []
  for (const p of plates) {
    const last = perSide[perSide.length - 1]
    if (last && last.plate === p) last.count += 1
    else perSide.push({ plate: p, count: 1 })
  }
  const sideSum = plates.reduce((a, b) => a + b, 0)
  const loaded = bar + 2 * sideSum
  const remainderPerSide = Math.max(0, Math.round(((weight - loaded) / 2) * 100) / 100)
  return { bar, perSide, loaded, remainderPerSide }
}

// Reasonable starting working-loads (lb) for an intermediate lifter, before
// experience scaling. Used to seed sensible first-session weights instead of 0,
// so suggestions are usable from day one (avoids the long cold-start ramp).
const BASE_LB: Record<string, number> = {
  'barbell-bench-press': 135,
  'incline-bench-press': 115,
  'db-bench-press': 50, // per-hand, matches incline-db-press
  'incline-db-press': 50,
  'machine-chest-press': 110,
  'cable-fly': 25,
  deadlift: 225,
  'romanian-deadlift': 155,
  'lat-pulldown': 120,
  'barbell-row': 135,
  'db-row': 60,
  'seated-cable-row': 130,
  'face-pull': 40,
  shrug: 60,
  'overhead-press': 85,
  'db-shoulder-press': 45,
  'lateral-raise': 15,
  'rear-delt-fly': 15,
  'barbell-curl': 65,
  'db-curl': 30,
  'hammer-curl': 30,
  'cable-curl': 40,
  'close-grip-bench': 115,
  'triceps-pushdown': 50,
  'overhead-triceps': 35,
  'back-squat': 185,
  'front-squat': 135,
  'leg-press': 270,
  'goblet-squat': 50,
  'bulgarian-split-squat': 35, // per-hand, lighter than goblet (unilateral)
  lunge: 40,
  'leg-extension': 90,
  'hip-thrust': 185,
  'leg-curl': 80,
  'kb-swing': 45,
  'standing-calf-raise': 120,
  'seated-calf-raise': 90,
  'cable-crunch': 60,
  'wrist-curl': 30,
}

const WEIGHTED: Equipment[] = ['barbell', 'dumbbell', 'machine', 'cable', 'kettlebell', 'ezbar']

/** A sensible first-session working weight for an exercise (0 for bodyweight moves). */
export function startingWeight(ex: Exercise, profile: Profile): number {
  // a movement with no external-weight equipment carries no load by default
  if (!ex.equipment.some((e) => WEIGHTED.includes(e))) return 0
  let w = BASE_LB[ex.id] ?? (ex.category === 'compound' ? 95 : ex.category === 'isolation' ? 35 : 0)
  if (w === 0) return 0
  const expScale =
    profile.experience === 'beginner' ? 0.7 : profile.experience === 'advanced' ? 1.3 : 1
  w *= expScale
  if (profile.unit === 'kg') w /= 2.20462
  return roundToAchievable(w, ex, profile.unit)
}

/**
 * The smallest weight increment actually loadable for an exercise, in the given unit:
 * a symmetric plate pair on a barbell (2.5 kg / 5 lb), one dumbbell/stack notch, or a
 * fine micro-step for added bodyweight load. This is the resolution roundToAchievable
 * snaps to — progression increments finer than this would round away to zero.
 */
export function loadStep(ex: Exercise, unit: Unit): number {
  switch (loadType(ex)) {
    case 'barbell':
    case 'dumbbell':
    case 'machine':
      return unit === 'kg' ? 2.5 : 5
    default:
      return unit === 'kg' ? 0.5 : 1
  }
}

/** The lightest weight you can actually load for an exercise (empty bar, one dumbbell/stack
 * notch, or unloaded bodyweight). roundToAchievable can round a positive target down to this
 * but never below it. */
export function minLoadable(ex: Exercise, unit: Unit): number {
  switch (loadType(ex)) {
    case 'barbell':
      return barWeight(unit)
    case 'dumbbell':
    case 'machine':
      return loadStep(ex, unit) // a single notch — there is no 0 lb dumbbell / empty stack pin
    default:
      return 0 // a bodyweight move can carry no added load
  }
}

/** Smallest achievable weight strictly greater than `weight` for this exercise. */
export function nextLoadableUp(weight: number, ex: Exercise, unit: Unit): number {
  const step = loadStep(ex, unit)
  let w = roundToAchievable(weight, ex, unit)
  let guard = 0
  while (w <= weight && guard++ < 1000) w = roundToAchievable(w + step, ex, unit)
  return w
}

/** Largest achievable weight strictly less than `weight`, floored at the exercise's minimum
 * loadable weight (so a dumbbell/machine never drops to a non-loadable 0). */
export function prevLoadableDown(weight: number, ex: Exercise, unit: Unit): number {
  const step = loadStep(ex, unit)
  const floor = minLoadable(ex, unit)
  let w = roundToAchievable(weight, ex, unit)
  let guard = 0
  while (w > floor && w >= weight && guard++ < 1000) {
    const cand = Math.max(floor, roundToAchievable(w - step, ex, unit))
    if (cand >= w) break // can't get any lower — already at the floor
    w = cand
  }
  return Math.max(floor, w)
}

export function roundToAchievable(weight: number, ex: Exercise, unit: Unit): number {
  // A non-finite input (NaN/Infinity from a corrupt history) slips past a bare `weight <= 0` (NaN <= 0
  // is false), so it would otherwise flow through roundToStep and emit NaN into a prescription — guard it.
  if (!Number.isFinite(weight) || weight <= 0) return 0
  switch (loadType(ex)) {
    case 'barbell': {
      // bar + symmetric plate pairs; smallest pair is 2×2.5 lb (5) or 2×1.25 kg (2.5)
      const bar = barWeight(unit)
      const pair = unit === 'kg' ? 2.5 : 5
      if (weight <= bar) return bar
      return bar + roundToStep(weight - bar, pair)
    }
    case 'dumbbell': {
      // real dumbbell increments: 5 lb / 2.5 kg jumps (per hand)
      const step = unit === 'kg' ? 2.5 : 5
      return Math.max(step, roundToStep(weight, step))
    }
    case 'machine': {
      // weight-stack pin increments: ~5 lb / 2.5 kg
      const step = unit === 'kg' ? 2.5 : 5
      return Math.max(step, roundToStep(weight, step))
    }
    default:
      // bodyweight movements: any added weight, rounded to 1 lb / 0.5 kg
      return roundToStep(weight, unit === 'kg' ? 0.5 : 1)
  }
}
