import type {
  Equipment,
  Exercise,
  Goal,
  MuscleGroup,
  Profile,
  RecoveryMap,
  Workout,
  WorkoutExercise,
  LoggedSet,
  Unit,
} from '../types'
import { EXERCISES, getExercise } from '../data/exercises'
import { MUSCLES, ALL_MUSCLES } from '../data/muscles'
import { computeRecovery, freshnessFromFatigue } from './recovery'
import { isExerciseDoable } from './equipment'
import { prescribe, type Prescription } from './progression'
import { roundToAchievable, startingWeight } from './weights'
import { uid } from './format'

// Larger muscles anchor a session, so give them a small selection nudge — balanced
// across push/pull/legs rather than skewing toward any one region.
const LARGE_MUSCLES = new Set<MuscleGroup>(['chest', 'back', 'lats', 'quads', 'hamstrings', 'glutes'])

interface RepScheme {
  sets: number
  reps: [number, number]
}

// Goal-driven set/rep prescription, split by movement type.
function scheme(goal: Goal, category: Exercise['category'], experience: Profile['experience']): RepScheme {
  const compound = category === 'compound'
  let base: RepScheme
  switch (goal) {
    case 'strength':
      base = compound ? { sets: 5, reps: [3, 5] } : { sets: 3, reps: [6, 8] }
      break
    case 'powerlifting':
      base = compound ? { sets: 5, reps: [2, 4] } : { sets: 3, reps: [5, 8] }
      break
    case 'hypertrophy':
      base = compound ? { sets: 4, reps: [8, 12] } : { sets: 3, reps: [10, 15] }
      break
    case 'endurance':
      base = compound ? { sets: 3, reps: [15, 20] } : { sets: 3, reps: [15, 25] }
      break
    default: // general
      base = compound ? { sets: 3, reps: [8, 12] } : { sets: 3, reps: [10, 15] }
  }
  if (experience === 'beginner') base = { ...base, sets: Math.max(2, base.sets - 1) }
  if (experience === 'advanced' && compound) base = { ...base, sets: base.sets + 1 }
  if (category === 'core' || category === 'cardio') base = { sets: 3, reps: [12, 20] }
  return base
}

// Rough minutes an exercise consumes (sets * (work + rest)).
function exerciseMinutes(s: RepScheme, goal: Goal): number {
  const restSec = goal === 'strength' || goal === 'powerlifting' ? 165 : goal === 'endurance' ? 50 : 90
  const workSec = 35
  return (s.sets * (restSec + workSec)) / 60 + 0.5 // +0.5 setup
}

function difficultyCap(experience: Profile['experience']): number {
  if (experience === 'beginner') return 2
  return 3
}

/** Whether a compound lift gets auto warm-up sets, by goal. Shared by the generator and the
 *  plan-day builder so the two build paths can't drift. */
export function shouldWarmup(goal: Goal): boolean {
  return goal === 'strength' || goal === 'powerlifting' || goal === 'hypertrophy'
}

/** The standard ramp of warm-up sets toward a working load: ≈50% then ≈75%, each rounded to the
 *  lift's loadable increment, with descending reps. Shared by the generator, the plan-day builder,
 *  AND the manual "add warm-up" action so no path can drift. Empty when there's no real load to
 *  ramp toward (e.g. a pure bodyweight set at weight 0). */
export function warmupSets(weight: number, ex: Exercise, unit: Unit, workReps: number): LoggedSet[] {
  if (!(weight > 0)) return []
  // Floor the working reps at a sane 1 so a blank/0/negative/NaN-rep work set (e.g. reps not entered
  // yet) still produces a real ramp instead of [3,3]. The ramp must DESCEND in reps as the weight
  // climbs (lighter→more reps, heavier→fewer), so the heavier set is also capped below the first —
  // otherwise high working reps invert it (workReps 12 → first 8, second 11). Together this guarantees
  // reps[0] > reps[1] for every input.
  const wr = Number.isFinite(workReps) ? Math.max(1, workReps) : 1
  const firstReps = Math.min(8, wr + 3) // lighter set: a little above the work reps, capped at 8
  const secondReps = Math.min(firstReps - 1, Math.max(3, wr - 1)) // heavier set: fewer, ≥3, < firstReps
  return [
    { id: uid('s'), weight: roundToAchievable(weight * 0.5, ex, unit), reps: firstReps, done: false, warmup: true },
    { id: uid('s'), weight: roundToAchievable(weight * 0.75, ex, unit), reps: secondReps, done: false, warmup: true },
  ]
}

function categoryBias(goal: Goal, category: Exercise['category']): number {
  if (category === 'compound') {
    if (goal === 'strength' || goal === 'powerlifting') return 14
    return 8
  }
  if (category === 'cardio') return goal === 'endurance' ? 8 : -6
  return 0
}

/** Most recent working weight the user used on an exercise, for weight suggestion. */
export function lastWorkingWeight(
  exerciseId: string,
  history: Workout[],
): { weight: number; reps: number } | null {
  const completed = history
    .filter((w) => w.status === 'completed')
    .sort((a, b) => (b.completedAt ?? b.date) - (a.completedAt ?? a.date))
  for (const w of completed) {
    const we = w.exercises.find((e) => e.exerciseId === exerciseId)
    if (!we) continue
    const working = we.sets.filter((s) => s.done && !s.warmup && s.weight > 0)
    if (working.length) {
      const top = working.reduce((a, b) => (b.weight > a.weight ? b : a))
      return { weight: top.weight, reps: top.reps }
    }
  }
  return null
}

/** The exact working sets (weight + reps) the user last logged for an exercise. */
export function lastPerformance(
  exerciseId: string,
  history: Workout[],
): { weight: number; reps: number }[] | null {
  const completed = history
    .filter((w) => w.status === 'completed')
    .sort((a, b) => (b.completedAt ?? b.date) - (a.completedAt ?? a.date))
  for (const w of completed) {
    const we = w.exercises.find((e) => e.exerciseId === exerciseId)
    if (!we) continue
    const working = we.sets.filter((s) => s.done && !s.warmup)
    if (working.length) return working.map((s) => ({ weight: s.weight, reps: s.reps }))
  }
  return null
}

function buildSets(
  ex: Exercise,
  s: RepScheme,
  presc: Prescription | null,
  profile: Profile,
): LoggedSet[] {
  const sets: LoggedSet[] = []

  // Autofill from last session AND apply evidence-based progression (double
  // progression, safe increments, stall → deload). Falls back to the goal scheme
  // for a brand-new exercise.
  const working = presc
    ? Array.from({ length: presc.setCount }, () => ({ weight: presc.weight, reps: presc.reps }))
    : Array.from({ length: s.sets }, () => ({
        // no history yet — seed a sensible starting load instead of 0
        weight: startingWeight(ex, profile),
        reps: Math.round((s.reps[0] + s.reps[1]) / 2),
      }))

  const workWeight = working[0]?.weight ?? 0
  const targetReps = working[0]?.reps ?? Math.round((s.reps[0] + s.reps[1]) / 2)
  const goal = profile.goal

  // auto warm-up sets for heavier compound lifts with a known load
  if (ex.category === 'compound' && shouldWarmup(goal)) {
    sets.push(...warmupSets(workWeight, ex, profile.unit, targetReps))
  }

  for (const wset of working) {
    sets.push({ id: uid('s'), weight: wset.weight, reps: wset.reps, done: false })
  }
  return sets
}

export interface GenerateOptions {
  /** explicit muscle focus overriding the recovery-based pick */
  focusOverride?: MuscleGroup[]
  /** override target session length in minutes */
  durationMin?: number
  /** seed offset to vary picks on "regenerate" */
  shuffle?: number
  /** restrict the equipment pool (e.g. a bodyweight plan), intersected with what's owned */
  equipmentOverride?: Equipment[]
  /** override the goal-driven set/rep scheme for this session (e.g. a plan's strength day) */
  goalOverride?: Goal
}

/**
 * Personalized session builder. Targets the freshest + most-prioritized muscles,
 * respects equipment & experience, fits the time budget, and prescribes sets/reps
 * from the user's goal — mirroring Fitbod's recovery-aware generation.
 */
export function generateWorkout(
  profile: Profile,
  history: Workout[],
  now: number,
  opts: GenerateOptions = {},
): Workout {
  const fatigue = computeRecovery(history, now)
  const freshness = freshnessFromFatigue(fatigue)
  // a plan can narrow the pool (bodyweight/minimal); bodyweight is always available
  const ownedList = opts.equipmentOverride
    ? profile.equipment.filter((e) => opts.equipmentOverride!.includes(e) || e === 'bodyweight')
    : profile.equipment
  const owned = new Set<Equipment>([...ownedList, 'bodyweight'])
  const cap = difficultyCap(profile.experience)
  const shuffle = opts.shuffle ?? 0
  // a plan day can override the goal-driven scheme (e.g. a strength vs hypertrophy day)
  const effProfile = opts.goalOverride ? { ...profile, goal: opts.goalOverride } : profile

  // ---- 1. Score muscles for targeting ----
  const muscleScore: RecoveryMap = { ...freshness }
  for (const m of ALL_MUSCLES) {
    let sc = freshness[m] // fresher = more eligible
    if (profile.focusMuscles.includes(m)) sc += 35 // user emphasis
    // slightly favor large muscles as the session backbone (balanced across regions)
    if (LARGE_MUSCLES.has(m)) sc += 4
    // pseudo-random jitter so regenerate produces variety, deterministic-ish per shuffle
    sc += ((Math.sin((ALL_MUSCLES.indexOf(m) + 1) * 99.7 + shuffle * 7.13) + 1) / 2) * 14
    muscleScore[m] = sc
  }

  let targetMuscles: MuscleGroup[]
  if (opts.focusOverride && opts.focusOverride.length) {
    targetMuscles = opts.focusOverride
  } else {
    // pick muscles that are recovered enough to train (freshness >= 45) — fall back to top freshest
    const eligible = ALL_MUSCLES.filter((m) => freshness[m] >= 45)
    const pool = (eligible.length >= 4 ? eligible : [...ALL_MUSCLES]).sort(
      (a, b) => muscleScore[b] - muscleScore[a],
    )
    targetMuscles = pool.slice(0, 6)
  }
  const targetSet = new Set(targetMuscles)
  // When the user pins an explicit focus (a plan day or a tapped muscle), keep the
  // session on-topic: only program exercises that actually train a target muscle.
  const strictFocus = !!(opts.focusOverride && opts.focusOverride.length)
  const hitsTarget = (ex: Exercise): boolean =>
    ex.primary.some((m) => targetSet.has(m)) || ex.secondary.some((m) => targetSet.has(m))
  const hitsTargetPrimary = (ex: Exercise): boolean => ex.primary.some((m) => targetSet.has(m))

  // ---- 2. Decide how many exercises fit the time budget ----
  const rawDuration = opts.durationMin ?? profile.sessionLength
  const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 45
  const targetCount = Math.max(3, Math.min(9, Math.round(duration / 11)))

  // ---- 3. Score & greedily select exercises ----
  // areas the user flagged to avoid (injury/preference): never program a lift that PRIMARILY trains one
  const avoid = new Set<MuscleGroup>(profile.avoidMuscles ?? [])
  const avoidsArea = (ex: Exercise): boolean => avoid.size > 0 && ex.primary.some((m) => avoid.has(m))
  let candidates = EXERCISES.filter(
    (ex) =>
      ex.difficulty <= cap &&
      isExerciseDoable(ex, owned) &&
      !avoidsArea(ex) &&
      // under an explicit focus, drop exercises that train none of the target muscles
      (!strictFocus || hitsTarget(ex)),
  )
  // Never return an empty session: relax the focus filter first (still honoring avoided areas), then
  // — only if there is still nothing doable — drop the avoid filter as a last resort.
  if (candidates.length === 0) {
    candidates = EXERCISES.filter((ex) => ex.difficulty <= cap && isExerciseDoable(ex, owned) && !avoidsArea(ex))
  }
  if (candidates.length === 0) {
    candidates = EXERCISES.filter((ex) => ex.difficulty <= cap && isExerciseDoable(ex, owned))
  }

  // running coverage so we diversify muscles rather than hammering one
  const coverage: Record<string, number> = {}

  // off-target muscles contribute much less, so sessions stay on-theme
  const offTargetPrimary = strictFocus ? 0.12 : 0.3
  const offTargetSecondary = strictFocus ? 0.1 : 0.25

  function exerciseScore(ex: Exercise): number {
    let sc = categoryBias(effProfile.goal, ex.category)
    for (const m of ex.primary) {
      const base = targetSet.has(m) ? muscleScore[m] : muscleScore[m] * offTargetPrimary
      sc += base / (1 + (coverage[m] ?? 0) * 1.2)
    }
    for (const m of ex.secondary) {
      const base = targetSet.has(m) ? muscleScore[m] : muscleScore[m] * offTargetSecondary
      sc += (base * 0.4) / (1 + (coverage[m] ?? 0) * 1.2)
    }
    // prefer movements that train a target muscle as their primary mover
    if (hitsTargetPrimary(ex)) sc += 18
    // mild jitter for regenerate variety
    sc += ((Math.sin(hashString(ex.id) + shuffle * 3.1) + 1) / 2) * 10
    return sc
  }

  const chosen: Exercise[] = []
  const usedIds = new Set<string>()
  let minutesBudget = duration

  while (chosen.length < targetCount && usedIds.size < candidates.length) {
    let best: Exercise | null = null
    let bestScore = -Infinity
    for (const ex of candidates) {
      if (usedIds.has(ex.id)) continue
      const s = exerciseScore(ex)
      if (s > bestScore) {
        bestScore = s
        best = ex
      }
    }
    if (!best) break
    usedIds.add(best.id)

    const sch = scheme(effProfile.goal, best.category, profile.experience)
    const mins = exerciseMinutes(sch, effProfile.goal)
    if (minutesBudget - mins < -6 && chosen.length >= 3) break
    minutesBudget -= mins

    chosen.push(best)
    for (const m of best.primary) coverage[m] = (coverage[m] ?? 0) + 1
    for (const m of best.secondary) coverage[m] = (coverage[m] ?? 0) + 0.5
  }

  // ---- 4. Order: compounds first, then isolation, core/cardio last ----
  const order: Record<Exercise['category'], number> = { compound: 0, isolation: 1, core: 2, cardio: 3 }
  chosen.sort((a, b) => order[a.category] - order[b.category])

  // ---- 5. Build workout exercises with sets ----
  const exercises: WorkoutExercise[] = chosen.map((ex) => {
    const sch = scheme(effProfile.goal, ex.category, profile.experience)
    const presc = prescribe(ex, history, sch.reps, effProfile)
    return {
      exerciseId: ex.id,
      instanceId: uid('we'),
      targetReps: sch.reps,
      sets: buildSets(ex, sch, presc, effProfile),
      coaching: presc
        ? { note: presc.note, incWeight: presc.incWeight, weightDir: presc.weightDir, repsDir: presc.repsDir }
        : undefined,
    }
  })

  // ---- 6. Derive a focus list & title from what we actually selected ----
  const focusCount: Record<string, number> = {}
  for (const ex of chosen) for (const m of ex.primary) focusCount[m] = (focusCount[m] ?? 0) + 1
  const focus = (Object.keys(focusCount) as MuscleGroup[])
    .sort((a, b) => focusCount[b] - focusCount[a])
    .slice(0, 3)

  return {
    id: uid('w'),
    date: now,
    status: 'planned',
    title: titleFor(focus),
    exercises,
    focus,
    durationMin: Math.round(duration - Math.max(0, minutesBudget)),
    genFocus: opts.focusOverride,
  }
}

function titleFor(focus: MuscleGroup[]): string {
  if (focus.length === 0) return 'Full Body'
  const regions = new Set(focus.map((m) => MUSCLES[m].region))
  if (regions.size >= 3) return 'Full Body'
  if (regions.has('push') && regions.has('pull')) return 'Upper Body'
  if (regions.has('legs') && regions.size === 1) return 'Leg Day'
  if (regions.has('push') && regions.size === 1) return 'Push Day'
  if (regions.has('pull') && regions.size === 1) return 'Pull Day'
  const labels = focus.slice(0, 2).map((m) => MUSCLES[m].label)
  return labels.join(' & ')
}

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000
  return h
}

/**
 * Suggested next-session focus chips for the Home screen, ranked by freshness.
 * When a profile is supplied, only muscles the user can actually train with their
 * equipment are suggested — so tapping a chip never yields an off-target session.
 */
export function suggestedFocus(
  history: Workout[],
  now: number,
  profile?: Profile,
): { muscle: MuscleGroup; freshness: number }[] {
  const fresh = freshnessFromFatigue(computeRecovery(history, now))
  let muscles: MuscleGroup[] = ALL_MUSCLES
  if (profile) {
    const owned = new Set<Equipment>([...profile.equipment, 'bodyweight'])
    const trainable = new Set<MuscleGroup>()
    for (const ex of EXERCISES) {
      if (!isExerciseDoable(ex, owned)) continue
      for (const m of ex.primary) trainable.add(m)
      for (const m of ex.secondary) trainable.add(m)
    }
    const filtered = ALL_MUSCLES.filter((m) => trainable.has(m))
    if (filtered.length > 0) muscles = filtered
  }
  return muscles.map((m) => ({ muscle: m, freshness: fresh[m] })).sort((a, b) => b.freshness - a.freshness)
}

export { getExercise }
