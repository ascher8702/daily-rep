import type { Dir, Exercise, Experience, Profile, Unit, Workout } from '../types'
import { MUSCLES } from '../data/muscles'
import { roundToAchievable, loadStep, nextLoadableUp, prevLoadableDown } from './weights'
import { estimate1RM } from './format'

/**
 * Evidence-based auto-progression. Implements double progression with
 * experience/body/type-scaled load increments, a safety cap, plate snapping,
 * and a stall → deload rule. See docs/research-progressive-overload.md for the
 * sourced spec (NSCA 2-for-2, ACSM 2–10%, StrongLifts/Starting Strength resets).
 */

export interface Prescription {
  /** working weight for the next session (in the user's display unit) */
  weight: number
  /** target reps for each working set */
  reps: number
  /** how many working sets */
  setCount: number
  deload: boolean
  /** unit-free human note, e.g. "hit your reps" or "Deload −10% · rebuild from here" */
  note?: string
  /** load increase this session (display unit); rendered as "+X {unit}" at display time */
  incWeight?: number
  /** direction of weight/reps vs last session, for up-down cue badges */
  weightDir: Dir
  repsDir: Dir
}

type Body = 'upper' | 'lower'
type Kind = 'compound' | 'isolation'

// Load increment per category, by experience, in {lb, kg}. From NSCA absolute
// increments + StrongLifts/Starting Strength/5-3-1 conventions, micro for advanced.
const INCREMENTS: Record<Experience, Record<`${Body}-${Kind}`, { lb: number; kg: number }>> = {
  beginner: {
    'upper-compound': { lb: 5, kg: 2.5 },
    'upper-isolation': { lb: 2.5, kg: 1.25 },
    'lower-compound': { lb: 10, kg: 5 },
    'lower-isolation': { lb: 5, kg: 2.5 },
  },
  intermediate: {
    'upper-compound': { lb: 5, kg: 2.5 },
    'upper-isolation': { lb: 2.5, kg: 1.25 },
    'lower-compound': { lb: 5, kg: 2.5 },
    'lower-isolation': { lb: 5, kg: 2.5 },
  },
  advanced: {
    'upper-compound': { lb: 2.5, kg: 1.25 },
    'upper-isolation': { lb: 1.25, kg: 0.5 },
    'lower-compound': { lb: 5, kg: 2.5 },
    'lower-isolation': { lb: 2.5, kg: 1.25 },
  },
}

const PCT_CEILING = 0.1 // never raise a lift >10% in one jump (ACSM upper bound / safety)
const DELOAD_PCT = 0.1 // back off 10% on a stall reset
const STALL_SESSIONS = 3 // consecutive stalled sessions at the same load → deload
// On a light dumbbell/machine lift the smallest loadable jump (5 lb / 2.5 kg) can exceed the 10%
// ceiling, so we bank extra reps beyond repMax before taking that coarse jump rather than forcing
// a +30% leap the instant the rep range is hit.
const REP_BANK_BUFFER = 5

function bodyOf(ex: Exercise): Body {
  return ex.primary.some((m) => MUSCLES[m].region === 'legs') ? 'lower' : 'upper'
}

function kindOf(ex: Exercise): Kind {
  return ex.category === 'compound' ? 'compound' : 'isolation'
}

function increment(ex: Exercise, experience: Experience, unit: Unit, weight: number): number {
  const base = INCREMENTS[experience][`${bodyOf(ex)}-${kindOf(ex)}`][unit]
  // Floor the jump at the exercise's smallest LOADABLE increment, not a fixed 1 lb /
  // 0.5 kg: a sub-resolution micro-step (e.g. an advanced 1.25 lb on a barbell that only
  // loads in 5 lb pairs) would otherwise round straight back to zero and stall forever.
  // Cap at a safe fraction of the load so light lifts don't take a wild % jump.
  const step = loadStep(ex, unit)
  return Math.max(step, Math.min(base, weight * PCT_CEILING))
}

/** One completed session's performance on an exercise BLOCK, summarized for progression. */
interface SessionPerf {
  /** the heaviest working load used that session (the "working set" weight) */
  topWeight: number
  /** the best reps achieved AT the top load — handles AMRAP top sets + ascending ramps */
  topReps: number
  /** number of working sets logged */
  setCount: number
  /** did EVERY set at the top load reach the top of the rep range? (back-off/ramp sets don't gate) */
  allTopHit: boolean
  /** the rep range this block was PRESCRIBED for that session — lets us detect a scheme change */
  targetReps: [number, number]
}

/**
 * The completed working sets for one exercise BLOCK in a session, disambiguating the Nth occurrence
 * of an exercise that appears more than once in a day (e.g. 5/3/1 main wave + BBB 5x10 of the same
 * lift) — so each block progresses from its OWN history, not the first block's.
 */
function blockPerf(
  w: Workout,
  exerciseId: string,
  occurrence: number,
  repRange: [number, number],
): SessionPerf | null {
  const blocks = w.exercises.filter((e) => e.exerciseId === exerciseId)
  // prefer a stable planSlot match so each block reads its OWN history. When a session carries
  // planSlots but none matches this occurrence, the intended block was never logged (finishWorkout
  // drops un-logged blocks) → return null so the lift cold-starts instead of inheriting a sibling
  // block's load. Legacy sessions (no planSlots) fall back to positional matching.
  const block =
    blocks.find((b) => b.planSlot === occurrence) ??
    (blocks.some((b) => typeof b.planSlot === 'number') ? undefined : blocks[occurrence] ?? blocks[0])
  if (!block) return null
  const sets = block.sets.filter((s) => s.done && !s.warmup)
  if (!sets.length) return null
  const topWeight = Math.max(...sets.map((s) => s.weight))
  const topSets = sets.filter((s) => s.weight === topWeight)
  const target = block.targetReps
  return {
    topWeight,
    topReps: Math.max(...topSets.map((s) => s.reps)),
    setCount: sets.length,
    // evaluate the progression threshold on the TOP working sets only — a deliberately lighter
    // back-off/ramp set must not veto a load increase the top sets earned
    allTopHit: topSets.every((s) => s.reps >= repRange[1]),
    // fall back to the CURRENT range so a legacy block (no stored target) isn't read as a scheme change
    targetReps: Array.isArray(target) && target.length === 2 ? [target[0], target[1]] : [repRange[0], repRange[1]],
  }
}

/**
 * Decide the next prescription for an exercise from training history. Double progression:
 *  1. all TOP working sets hit the top of the range → add load (or bank reps if the smallest
 *     loadable jump would exceed the safety cap; bodyweight → bank a rep / suggest added load),
 *  2. else a genuine plateau — N consecutive same-load sessions with NO rep improvement → deload,
 *  3. else keep load and add a rep (reps-first).
 * `occurrence` disambiguates a lift that appears twice in one day. Returns null with no prior history.
 */
export function prescribe(
  ex: Exercise,
  history: Workout[],
  repRange: [number, number],
  profile: Profile,
  occurrence = 0,
): Prescription | null {
  const [repMin, repMax] = repRange
  const completed = history
    .filter((w) => w.status === 'completed')
    .sort((a, b) => (b.completedAt ?? b.date) - (a.completedAt ?? a.date))

  const perf: SessionPerf[] = []
  for (const w of completed) {
    const p = blockPerf(w, ex.id, occurrence, repRange)
    if (p) perf.push(p)
  }
  if (perf.length === 0) return null

  const last = perf[0]
  const curWeight = last.topWeight
  const setCount = last.setCount
  const bestReps = last.topReps

  // ---- 0. rep TARGET changed since last time (goal/plan switch, undulating day) → translate load ----
  // double progression assumes a stable rep range; when the prescribed reps change (e.g. 5×5 → 5×15)
  // keeping the old weight is wrong (you can't do 185×15 off a 185×5). Re-anchor the load to the new
  // rep target using the demonstrated estimated 1RM, then normal progression resumes next session.
  if (curWeight > 0 && (last.targetReps[0] !== repMin || last.targetReps[1] !== repMax)) {
    // Epley is only valid to ~12 reps; feeding a raw burnout/AMRAP rep count (e.g. 135×40) would
    // wildly overstate the 1RM and prescribe a dangerously heavy load — clamp the reps first.
    const e1rm = estimate1RM(curWeight, Math.min(bestReps, 12))
    const anchorReps = Math.round((repMin + repMax) / 2) // aim at the middle of the new range
    const targetW = roundToAchievable(e1rm / (1 + anchorReps / 30), ex, profile.unit)
    const next = targetW > 0 ? targetW : curWeight
    if (next !== curWeight) {
      const repLabel = repMin === repMax ? `${repMax}` : `${repMin}–${repMax}`
      return {
        weight: next,
        reps: repMin,
        setCount,
        deload: false,
        note: next < curWeight ? `Lighter load for ${repLabel} reps` : `Heavier load for ${repLabel} reps`,
        incWeight: next > curWeight ? Math.round((next - curWeight) * 10) / 10 : undefined,
        weightDir: next > curWeight ? 'up' : 'down',
        repsDir: 'same',
      }
    }
  }

  // ---- 1. top of the rep range reached → progress ----
  if (last.allTopHit) {
    // bodyweight lift maxed out: no external load to add → bank a rep (or add a vest/belt)
    if (curWeight === 0) {
      return {
        weight: 0,
        reps: bestReps + 1,
        setCount,
        deload: false,
        note: 'Add a rep — or add weight (vest/belt)',
        weightDir: 'same',
        repsDir: 'up',
      }
    }
    const step = loadStep(ex, profile.unit)
    // the smallest loadable jump exceeds the safe % ceiling (light dumbbell/machine): bank reps
    // beyond repMax until the jump is earned, instead of forcing a +30% leap
    if (step > curWeight * PCT_CEILING && bestReps < repMax + REP_BANK_BUFFER) {
      return {
        weight: curWeight,
        reps: bestReps + 1,
        setCount,
        deload: false,
        note: 'Add a rep before the next jump',
        weightDir: 'same',
        repsDir: 'up',
      }
    }
    const inc = increment(ex, profile.experience, profile.unit, curWeight)
    let next = roundToAchievable(curWeight + inc, ex, profile.unit)
    if (next <= curWeight) next = nextLoadableUp(curWeight, ex, profile.unit)
    const delta = Math.round((next - curWeight) * 10) / 10
    return {
      weight: next,
      reps: repMin,
      setCount,
      deload: false,
      note: delta > 0 ? 'hit your reps' : 'Hold load · add a rep',
      incWeight: delta > 0 ? delta : undefined,
      weightDir: next > curWeight ? 'up' : 'same',
      repsDir: repMin < bestReps ? 'down' : 'same',
    }
  }

  // ---- 2. genuine plateau: consecutive same-load sessions that did NOT improve reps ----
  if (curWeight > 0) {
    let stalls = 0
    for (let i = 0; i < perf.length; i++) {
      if (perf[i].topWeight !== curWeight) break // load changed → plateau ended
      if (perf[i].allTopHit) break // a topping-out session is progress, not a stall
      const older = perf[i + 1]
      // beat the previous SAME-load session → still improving, not stalled
      if (older && older.topWeight === curWeight && perf[i].topReps > older.topReps) break
      stalls += 1
    }
    if (stalls >= STALL_SESSIONS) {
      let deloadW = roundToAchievable(curWeight * (1 - DELOAD_PCT), ex, profile.unit)
      // at light loads a 10% back-off rounds back to the same weight — step down one real notch
      if (deloadW >= curWeight) deloadW = prevLoadableDown(curWeight, ex, profile.unit)
      const dropped = deloadW < curWeight
      return {
        weight: deloadW,
        reps: repMin,
        setCount,
        deload: dropped,
        note: dropped ? `Deload −${Math.round(DELOAD_PCT * 100)}% · rebuild from here` : 'Reset reps · same load',
        weightDir: dropped ? 'down' : 'same',
        repsDir: 'down',
      }
    }
  }

  // ---- 3. not at the top yet → keep load, target one more rep (reps-first) ----
  const nextReps = Math.min(repMax, bestReps + 1)
  return {
    weight: curWeight,
    reps: nextReps,
    setCount,
    deload: false,
    note: 'Add a rep this session',
    weightDir: 'same',
    repsDir: nextReps > bestReps ? 'up' : 'same',
  }
}
