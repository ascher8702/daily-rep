import type { LoggedSet, MuscleGroup, Workout } from '../types'
import { getExercise } from '../data/exercises'
import { MUSCLES } from '../data/muscles'
import { estimate1RM } from './format'

const DAY = 1000 * 60 * 60 * 24

/** Local calendar-day index, so day boundaries match the user's timezone, not UTC. */
export function localDay(ts: number): number {
  const d = new Date(ts)
  return Math.floor((ts - d.getTimezoneOffset() * 60000) / DAY)
}

/**
 * Consecutive local days (ending today or yesterday) that have a workout.
 * Walks by local-day index — DST-safe, unlike subtracting a fixed 24h in ms.
 */
export function computeStreak(dates: number[], now: number): number {
  if (dates.length === 0) return 0
  const dayKeys = new Set(dates.map(localDay))
  let cursor = localDay(now)
  if (!dayKeys.has(cursor)) cursor -= 1 // streak is still alive if only yesterday has one
  let streak = 0
  while (dayKeys.has(cursor)) {
    streak += 1
    cursor -= 1
  }
  return streak
}

/** Monday-aligned local week index (epoch day 0 was a Thursday, so +3 shifts the boundary to Monday). */
export function localWeek(ts: number): number {
  return Math.floor((localDay(ts) + 3) / 7)
}

/**
 * Consecutive calendar weeks (ending this week or last week) that contain ≥1 workout. A daily streak
 * resets on every planned rest day — so for a 3–4×/week lifter it's almost always 1, punishing the
 * exact rest training depends on. A weekly streak rewards consistency: a normal training week keeps
 * it alive, and one skipped week (not one skipped day) is what breaks it.
 */
export function computeWeeklyStreak(dates: number[], now: number): number {
  if (dates.length === 0) return 0
  const weekKeys = new Set(dates.map(localWeek))
  let cursor = localWeek(now)
  if (!weekKeys.has(cursor)) cursor -= 1 // this week empty so far? last week still keeps the streak
  let streak = 0
  while (weekKeys.has(cursor)) {
    streak += 1
    cursor -= 1
  }
  return streak
}

// Calisthenics move a fraction of bodyweight; a flat estimate keeps it simple while
// still making bodyweight training count toward volume and PRs.
const BW_LOAD_FRACTION = 0.65

/** A sensible default bodyweight (in the given display unit) when the user hasn't set one. */
export function defaultBodyweight(unit: 'lb' | 'kg'): number {
  return unit === 'kg' ? 70 : 155
}

/**
 * The load a set actually moves: external weight, plus an estimated share of bodyweight
 * for bodyweight strength movements (so push-ups / pull-ups / dips aren't counted as zero).
 */
export function effectiveLoad(exerciseId: string, weight: number, bodyweight: number): number {
  const ex = getExercise(exerciseId)
  const isBodyweightLift =
    !!ex &&
    bodyweight > 0 &&
    ex.equipment.includes('bodyweight') &&
    (ex.category === 'compound' || ex.category === 'isolation')
  return isBodyweightLift ? Math.round(bodyweight * BW_LOAD_FRACTION) + weight : weight
}

/** Total working volume (effective-load × reps over completed, non-warmup sets) for a workout. */
export function workoutVolume(w: Workout, bodyweight = 0): number {
  let v = 0
  for (const we of w.exercises) {
    for (const s of we.sets) {
      if (s.done && !s.warmup) v += effectiveLoad(we.exerciseId, s.weight, bodyweight) * s.reps
    }
  }
  return v
}

export type Region = 'push' | 'pull' | 'legs' | 'core'

/**
 * Working sets per training region over recent history. Each set is counted once
 * per DISTINCT region the exercise's primary muscles cover — so a deadlift
 * (hamstrings/glutes/lower-back) adds one to legs and one to core, not three total.
 */
export function regionBalance(workouts: Workout[], sinceTs: number): Record<Region, number> {
  const counts: Record<Region, number> = { push: 0, pull: 0, legs: 0, core: 0 }
  for (const w of workouts) {
    if (w.status !== 'completed') continue
    if ((w.completedAt ?? w.date) < sinceTs) continue
    for (const we of w.exercises) {
      const ex = getExercise(we.exerciseId)
      if (!ex) continue
      const working = we.sets.filter((s) => s.done && !s.warmup).length
      if (working === 0) continue
      const regions = new Set(ex.primary.map((m) => MUSCLES[m].region))
      for (const r of regions) counts[r] += working
    }
  }
  return counts
}

// ---- post-workout summary ----

export interface SummaryTopSet {
  exerciseId: string
  weight: number
  reps: number
  /** estimated 1-rep max for this set (in the workout's stored unit) */
  e1rm: number
  volume: number
}

export interface PersonalRecord {
  exerciseId: string
  /** new best estimated 1-rep max, and the prior all-time best it beat */
  e1rm: number
  previous: number
}

export interface WorkoutSummary {
  durationMin: number
  volume: number
  /** completed working sets / reps (warm-ups excluded) */
  sets: number
  reps: number
  exercises: number
  /** best working set per exercise, by est. 1RM, descending */
  topSets: SummaryTopSet[]
  /** working sets credited to each primary muscle, descending */
  muscles: { muscle: MuscleGroup; sets: number }[]
  /** est-1RM PRs vs prior history (first-ever sessions of a lift are NOT flagged) */
  prs: PersonalRecord[]
  /** this session's volume ÷ the average of prior sessions (e.g. 1.18 = +18%); null when no prior */
  vsAverage: number | null
}

/** Best est-1RM across a workout's completed working sets for one exercise (0 if none). */
function bestE1rm(w: Workout, exerciseId: string, bw: number): number {
  let best = 0
  for (const we of w.exercises) {
    if (we.exerciseId !== exerciseId) continue
    for (const s of we.sets) {
      if (!s.done || s.warmup) continue
      best = Math.max(best, estimate1RM(effectiveLoad(exerciseId, s.weight, bw), s.reps))
    }
  }
  return best
}

/** Best est-1RM for an exercise across a set of workouts (e.g. completed history), in display units.
 *  Each workout uses its OWN frozen bodyweight when present so historical bodyweight lifts stay stable. */
export function allTimeBestE1rm(exerciseId: string, workouts: Workout[], bodyweight: number): number {
  let best = 0
  for (const w of workouts) best = Math.max(best, bestE1rm(w, exerciseId, w.bodyweight ?? bodyweight))
  return best
}

/**
 * Best est-1RM for an exercise in each COMPLETED session that included a real working set of it,
 * oldest → newest. Drives the per-exercise progression chart. Each session uses its own frozen
 * bodyweight so a bodyweight lift's curve doesn't shift when the user later changes their weight.
 */
export function exerciseE1rmSeries(
  exerciseId: string,
  workouts: Workout[],
  bodyweight: number,
): { ts: number; e1rm: number }[] {
  return workouts
    .filter((w) => w.status === 'completed')
    .map((w) => ({ ts: w.completedAt ?? w.date, e1rm: bestE1rm(w, exerciseId, w.bodyweight ?? bodyweight) }))
    .filter((p) => p.e1rm > 0)
    .sort((a, b) => a.ts - b.ts)
}

/** Bodyweight at each completed session, oldest-first, for the Progress bodyweight trend. Reads the
 *  bodyweight frozen onto each workout at finish (so it reflects what the user weighed then, not their
 *  current profile). Sessions without a usable frozen bodyweight are skipped — older blobs that predate
 *  the per-workout stamp simply don't contribute points (the chart shows the <2-point note instead). */
export function bodyweightSeries(workouts: Workout[]): { ts: number; bw: number }[] {
  return workouts
    .filter((w) => w.status === 'completed' && typeof w.bodyweight === 'number' && w.bodyweight > 0)
    .map((w) => ({ ts: w.completedAt ?? w.date, bw: w.bodyweight as number }))
    .sort((a, b) => a.ts - b.ts)
}

export type ProgressRange = 'week' | 'month' | 'all'

/** Progress-page time-range filter. 'week' = last 7 days, 'month' = last 30 days, 'all' = everything.
 *  Pure + windowed off `now` (uses each workout's completedAt, falling back to date) so the CUMULATIVE
 *  Progress stats — total volume, workout count, avg duration, the volume + bodyweight trends, and PRs —
 *  can scope to a period. Streak, recovery, and the 14-day muscle-balance widget keep their own
 *  intrinsic windows and are intentionally NOT routed through this. */
export function filterByRange(workouts: Workout[], range: ProgressRange, now: number): Workout[] {
  if (range === 'all') return workouts
  const cutoff = now - (range === 'week' ? 7 : 30) * 24 * 60 * 60 * 1000
  return workouts.filter((w) => (w.completedAt ?? w.date) >= cutoff)
}

/** Mean RPE across a workout's completed WORKING sets that have an RPE logged (warm-ups and
 *  un-rated sets excluded), to one decimal. null when nothing is rated, so the UI can hide it. */
export function averageRPE(w: Workout): number | null {
  let sum = 0
  let n = 0
  for (const we of w.exercises) {
    for (const s of we.sets) {
      if (!s.done || s.warmup || typeof s.rpe !== 'number' || !Number.isFinite(s.rpe)) continue
      sum += s.rpe
      n += 1
    }
  }
  return n === 0 ? null : Math.round((sum / n) * 10) / 10
}

/**
 * Live PR check for a just-completed working set: does its est-1RM beat the best the user has ever
 * recorded for this lift — across completed `history` AND the live session's OTHER done working sets?
 * Mirrors summarizeWorkout's rule: a first-ever attempt at a lift is NOT a PR (previousBest must be
 * > 0), so the toast celebrates beating a record rather than merely trying a new exercise. Pure +
 * testable; the store calls it the moment a working set is checked off.
 */
export function detectSetPR(
  exerciseId: string,
  setId: string,
  session: Workout,
  history: Workout[],
  bodyweight: number,
): { isPR: boolean; e1rm: number; previousBest: number } {
  let target: LoggedSet | undefined
  for (const we of session.exercises) {
    if (we.exerciseId !== exerciseId) continue
    const found = we.sets.find((x) => x.id === setId)
    if (found) {
      target = found
      break
    }
  }
  if (!target || !target.done || target.warmup || target.reps <= 0) {
    return { isPR: false, e1rm: 0, previousBest: 0 }
  }
  // gate on the EFFECTIVE-load est-1RM, not raw weight, so bodyweight lifts (external weight 0) qualify
  // while a weighted lift logged at 0 lb (e1rm 0) does not
  const e1rm = estimate1RM(effectiveLoad(exerciseId, target.weight, bodyweight), target.reps)
  if (e1rm <= 0) return { isPR: false, e1rm: 0, previousBest: 0 }

  // prior best = completed history ∪ this session's OTHER done working sets of the same lift
  let previousBest = allTimeBestE1rm(exerciseId, history, bodyweight)
  for (const we of session.exercises) {
    if (we.exerciseId !== exerciseId) continue
    for (const s of we.sets) {
      if (s.id === setId || !s.done || s.warmup || s.reps <= 0) continue
      previousBest = Math.max(previousBest, estimate1RM(effectiveLoad(exerciseId, s.weight, bodyweight), s.reps))
    }
  }
  return { isPR: previousBest > 0 && e1rm > previousBest, e1rm, previousBest }
}

/**
 * Rich stats for a just-completed workout: volume, sets/reps, the top set + est-1RM of each lift,
 * muscles trained, est-1RM personal records vs prior history, and how the session's volume compares
 * to the user's recent average. Pure — drives the post-workout summary screen.
 */
export function summarizeWorkout(w: Workout, history: Workout[], bodyweight: number): WorkoutSummary {
  const when = w.completedAt ?? w.date
  const prior = history.filter(
    (o) => o.id !== w.id && o.status === 'completed' && (o.completedAt ?? o.date) < when,
  )

  let sets = 0
  let reps = 0
  const muscleSets = new Map<MuscleGroup, number>()
  const topByEx = new Map<string, SummaryTopSet>()

  for (const we of w.exercises) {
    const ex = getExercise(we.exerciseId)
    for (const s of we.sets) {
      if (!s.done || s.warmup) continue
      sets += 1
      reps += s.reps
      for (const m of ex?.primary ?? []) muscleSets.set(m, (muscleSets.get(m) ?? 0) + 1)
      const load = effectiveLoad(we.exerciseId, s.weight, bodyweight)
      const e1rm = estimate1RM(load, s.reps)
      const cur = topByEx.get(we.exerciseId)
      if (!cur || e1rm > cur.e1rm) {
        topByEx.set(we.exerciseId, { exerciseId: we.exerciseId, weight: s.weight, reps: s.reps, e1rm, volume: load * s.reps })
      }
    }
  }

  // PRs: a session-best est-1RM that beats the prior all-time best for that lift (skip first-timers)
  const prs: PersonalRecord[] = []
  for (const exerciseId of topByEx.keys()) {
    const sessionBest = bestE1rm(w, exerciseId, bodyweight)
    let priorBest = 0
    let everDone = false
    for (const o of prior) {
      const b = bestE1rm(o, exerciseId, bodyweight)
      if (b > 0) everDone = true
      priorBest = Math.max(priorBest, b)
    }
    if (everDone && sessionBest > priorBest) prs.push({ exerciseId, e1rm: sessionBest, previous: priorBest })
  }
  prs.sort((a, b) => b.e1rm - b.previous - (a.e1rm - a.previous))

  const volume = workoutVolume(w, bodyweight)
  const priorVols = prior.map((o) => workoutVolume(o, o.bodyweight ?? bodyweight)).filter((v) => v > 0)
  // need at least a couple of prior sessions for an "average" to be meaningful (one sparse session
  // would make the comparison read like a wild +1000% on the user's second workout)
  const avgPrior = priorVols.length >= 2 ? priorVols.reduce((a, b) => a + b, 0) / priorVols.length : null

  return {
    durationMin: w.durationMin ?? 0,
    volume,
    sets,
    reps,
    exercises: topByEx.size,
    topSets: [...topByEx.values()].sort((a, b) => b.e1rm - a.e1rm),
    muscles: [...muscleSets.entries()]
      .map(([muscle, n]) => ({ muscle, sets: n }))
      .sort((a, b) => b.sets - a.sets),
    prs,
    vsAverage: avgPrior && avgPrior > 0 ? volume / avgPrior : null,
  }
}

const TONNAGE_REFS_LB: { label: string; lb: number }[] = [
  { label: 'giant panda', lb: 250 },
  { label: 'gorilla', lb: 400 },
  { label: 'grand piano', lb: 900 },
  { label: 'grizzly bear', lb: 1500 },
  { label: 'small car', lb: 2800 },
  { label: 'pickup truck', lb: 5500 },
  { label: 'African elephant', lb: 12000 },
  { label: 'school bus', lb: 25000 },
  { label: 'blue whale', lb: 300000 },
]

/** A playful "you moved ≈ N x <thing>" comparison for total session tonnage (volume in display unit). */
export function tonnageComparison(volume: number, unit: 'lb' | 'kg'): string | null {
  const lb = unit === 'kg' ? volume * 2.20462 : volume
  // below the smallest reference → no fun comparison (avoids a nonsensical "≈ 0.6 grand pianos")
  if (lb < TONNAGE_REFS_LB[0].lb) return null
  // pick the largest reference object the tonnage meets or exceeds → the count is always ≥ 1
  let ref = TONNAGE_REFS_LB[0]
  for (const r of TONNAGE_REFS_LB) if (lb >= r.lb) ref = r
  const count = lb / ref.lb
  const rounded = count >= 10 ? Math.round(count) : Math.round(count * 10) / 10
  return `≈ ${rounded} ${ref.label}${rounded === 1 ? '' : 's'}`
}
