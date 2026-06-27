import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  ActivePlan,
  Equipment,
  Goal,
  Experience,
  MuscleGroup,
  Profile,
  Unit,
  Workout,
  WorkoutExercise,
  LoggedSet,
} from '../types'
import { generateWorkout, shouldWarmup, warmupSets, type GenerateOptions } from '../lib/generator'
import { prescribe } from '../lib/progression'
import { startingWeight, isBodyweightExercise } from '../lib/weights'
import { defaultBodyweight, detectSetPR } from '../lib/stats'
import { getExercise } from '../data/exercises'
import { getPlan, planEquipment, type WorkoutPlan, type PlanDay } from '../data/plans'
import { resolvePlanLifts } from '../lib/substitution'
import { supersetPartnerBehind } from '../lib/supersets'
import { buildSampleHistory } from '../lib/seed'
import { uid, convertWeight } from '../lib/format'
import { emitToast } from '../lib/toast'

const DEFAULT_PROFILE: Profile = {
  name: '',
  goal: 'hypertrophy',
  experience: 'intermediate',
  unit: 'lb',
  equipment: [
    'barbell',
    'dumbbell',
    'bench',
    'cable',
    'machine',
    'kettlebell',
    'pullupbar',
    'bands',
    'ezbar',
    'bodyweight',
  ],
  sessionLength: 50,
  focusMuscles: [],
  avoidMuscles: [],
  daysPerWeek: 3,
  onboarded: false,
}

export interface AppState {
  profile: Profile
  workouts: Workout[] // completed history
  current: Workout | null // the planned / active session
  restEndsAt: number | null // epoch ms for the running rest timer
  restDuration: number // seconds the current rest was set to
  // session id whose "working around" alert the user dismissed (transient: not persisted, so it
  // resets on reload but stays dismissed while the app is open — won't nag within a session)
  avoidNoticeDismissedId: string | null
  activePlan: ActivePlan | null // the structured plan the user is following
  customPlans: WorkoutPlan[] // user-created plans
  /** last dayIndex reached per plan, so switching back to a plan resumes instead of restarting */
  planProgress: Record<string, number>
  /**
   * Per-plan exercise replacements from a "replace in my plan" swap, keyed by planId →
   * `${dayLabel}::${originalPlanExerciseId}` → newExerciseId. Applied when generating that plan's
   * days while it's the active plan. NEVER mutates the shared plan definition (PLANS / customPlans).
   */
  planOverrides: Record<string, Record<string, string>>
  /**
   * Per-plan, per-day edits to the user's COPY of a plan — exercises they ADDED to or REMOVED from a
   * plan day "going forward". Keyed planId → dayLabel → { add: ids, remove: ids }. Applied when that
   * plan day is generated while it's the active plan. NEVER mutates the shared plan definition.
   */
  planDayEdits: Record<string, Record<string, { add: string[]; remove: string[] }>>

  // ---- onboarding / profile ----
  completeOnboarding: (p: Partial<Profile>) => void
  updateProfile: (p: Partial<Profile>) => void
  setGoal: (g: Goal) => void
  setExperience: (e: Experience) => void
  setUnit: (u: Unit) => void
  toggleEquipment: (e: Equipment) => void
  toggleFocusMuscle: (m: MuscleGroup) => void
  /** toggle a muscle the user is "working around" (injury/soreness); mutually exclusive with focus */
  toggleAvoidMuscle: (m: MuscleGroup) => void

  // ---- generation / session lifecycle ----
  generate: (opts?: GenerateOptions) => void
  setCurrent: (w: Workout | null) => void
  /** clone a past workout into a fresh, not-yet-started session (returns false if id not found) */
  repeatWorkout: (id: string) => boolean
  startWorkout: () => void
  finishWorkout: () => void
  discardCurrent: () => void

  // ---- structured plans ----
  /** follow a plan: resume from last position (or day 1 if new); pass restart=true to force day 1 */
  startPlan: (planId: string, restart?: boolean) => void
  stopPlan: () => void
  generateFromPlan: (shuffle?: number) => void
  /** jump the active plan to a specific schedule day and build it (used by Home's "Switch" picker) */
  generateFromPlanDay: (dayIndex: number) => void
  /** dismiss the in-session "working around" alert for a given session id (won't reshow this session) */
  dismissAvoidNotice: (sessionId: string) => void
  skipPlanDay: () => void

  // ---- custom plans ----
  addCustomPlan: (plan: WorkoutPlan) => void
  updateCustomPlan: (id: string, plan: WorkoutPlan) => void
  deleteCustomPlan: (id: string) => void
  /** fork a built-in or custom plan into an editable custom copy; returns the new id */
  duplicatePlan: (id: string) => string | null

  // ---- editing the current session ----
  addExercise: (exerciseId: string) => void
  removeExercise: (exerciseId: string) => void
  /** add an exercise to today's workout (building the session first if there isn't one). `forward`
   *  also adds it to this plan day in the user's plan COPY so future sessions of the day include it. */
  addExerciseToday: (exerciseId: string, forward: boolean) => void
  /** remove an exercise from today's workout. `forward` also drops it from this plan day going forward
   *  in the user's plan COPY (the shared plan definition is never touched). */
  removeExerciseToday: (exerciseId: string, forward: boolean) => void
  swapExercise: (oldId: string, newId: string) => void
  reorderExercise: (exerciseId: string, dir: -1 | 1) => void
  /** record a "replace in my plan" swap: the active plan's current day will use `toExerciseId` in
   *  place of the plan lift `planLiftId` from now on (while this plan is active; plan def untouched) */
  replaceInActivePlan: (planLiftId: string, toExerciseId: string) => void
  updateSet: (exerciseId: string, setId: string, patch: Partial<LoggedSet>) => void
  /** like updateSet, but a weight/reps change on a WORKING set also flows forward to the following
   *  not-yet-done working sets that were tracking this one (the "set my working weight once" UX) */
  updateSetCascade: (exerciseId: string, setId: string, patch: Partial<LoggedSet>) => void
  addSet: (exerciseId: string) => void
  /** prepend a standard warm-up ramp (≈50%/75% of the first working set) — no-op if the lift already
   *  has warm-ups or has no working load to ramp toward */
  addWarmupSets: (exerciseId: string) => void
  removeSet: (exerciseId: string, setId: string) => void
  toggleSetDone: (exerciseId: string, setId: string) => void
  /** record the end-of-exercise effort as reps-in-reserve, stored as RPE on every completed WORKING
   *  set: RPE = 10 − RIR (0 more reps → RPE 10), clamped to the 6–10 scale. `undefined` clears it. */
  setExerciseEffort: (exerciseId: string, rir: number | undefined) => void

  // ---- rest timer ----
  startRest: (seconds: number) => void
  adjustRest: (delta: number) => void
  stopRest: () => void

  // ---- history utilities ----
  /** set/edit the free-text note on a completed workout; an empty/blank note clears it */
  setWorkoutNote: (id: string, note: string) => void
  deleteWorkout: (id: string) => void
  loadSampleData: () => void
  resetAll: () => void
}

function mutateCurrent(
  current: Workout | null,
  fn: (w: Workout) => Workout,
): Workout | null {
  if (!current) return current
  return fn(structuredCloneSafe(current))
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

/** Clamp a numeric input to a sane 0..max range, defaulting non-finite values to 0. */
function sanitizeNumber(n: number, max: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(n, max))
}

/** Whitelist + coerce a LoggedSet patch before it's applied to a set, so a corrupt or unexpected field
 *  (a non-boolean `done`, a spoofed `id`, or any stray key) can't reach the set and poison
 *  finishWorkout / stats filters (`s.done && !s.warmup`) or volume/e1RM math. Only known MUTABLE fields
 *  pass through, each coerced; `id` is never patchable. */
function sanitizeSetPatch(patch: Partial<LoggedSet>): Partial<LoggedSet> {
  const clean: Partial<LoggedSet> = {}
  if (patch.weight != null) clean.weight = sanitizeNumber(patch.weight, 9999)
  if (patch.reps != null) clean.reps = sanitizeNumber(patch.reps, 999)
  if ('done' in patch) clean.done = !!patch.done
  if ('warmup' in patch) clean.warmup = !!patch.warmup
  return clean
}

/** Coerce a persisted numeric profile field into [min,max], falling back when it's missing or
 *  garbage (NaN/Infinity/non-number) so a corrupt blob can't feed rest/generator/analytics bad
 *  values. `round` snaps to an integer (e.g. daysPerWeek); fallback may be undefined for optional
 *  fields so a bad value clears rather than poisons. */
function boundedNum(
  v: unknown,
  min: number,
  max: number,
  fallback: number | undefined,
  round = false,
): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  const clamped = Math.min(max, Math.max(min, v))
  return round ? Math.round(clamped) : clamped
}


function defaultSchemeForNewExercise(
  exerciseId: string,
  profile: Profile,
  history: Workout[],
): WorkoutExercise {
  const ex = getExercise(exerciseId)
  const isCompound = ex?.category === 'compound'
  const reps: [number, number] =
    profile.goal === 'strength' || profile.goal === 'powerlifting'
      ? isCompound
        ? [3, 5]
        : [6, 8]
      : profile.goal === 'endurance'
        ? [15, 20]
        : [8, 12]
  const setCount = isCompound ? 4 : 3
  const target = Math.round((reps[0] + reps[1]) / 2)
  // resume from last time + apply evidence-based progression (autofill weights/reps/sets)
  const presc = ex ? prescribe(ex, history, reps, profile) : null
  const sets = presc
    ? Array.from({ length: presc.setCount }, () => ({
        id: uid('s'),
        weight: presc.weight,
        reps: presc.reps,
        done: false,
      }))
    : Array.from({ length: setCount }, () => ({
        id: uid('s'),
        weight: ex ? startingWeight(ex, profile) : 0,
        reps: target,
        done: false,
      }))
  return {
    exerciseId,
    instanceId: uid('we'),
    targetReps: reps,
    sets,
    coaching: presc ? { note: presc.note, incWeight: presc.incWeight, weightDir: presc.weightDir, repsDir: presc.repsDir } : undefined,
  }
}

/** Resolve a plan id against the user's custom plans first, then the built-in catalogue. */
export function resolvePlan(id: string, customPlans: WorkoutPlan[]): WorkoutPlan | undefined {
  return customPlans.find((p) => p.id === id) ?? getPlan(id)
}

/** Match a session block by its stable instanceId, falling back to exerciseId for older
 *  persisted sessions (and manually-built ones) that predate instanceId. */
const byKey = (key: string) => (e: WorkoutExercise) => e.instanceId === key || e.exerciseId === key

/** Goal-tuned default rest (seconds) between working sets when the user hasn't set their own. */
const GOAL_REST: Record<Goal, number> = {
  strength: 165,
  powerlifting: 165,
  endurance: 45,
  hypertrophy: 90,
  general: 90,
}

/** Seconds of rest the auto-timer uses after a working set: the user's explicit override (if any),
 *  else the goal-tuned default. Exported for the settings hint + tests. */
export function restSecondsFor(profile: Pick<Profile, 'goal' | 'restSeconds'>): number {
  return profile.restSeconds && profile.restSeconds > 0 ? profile.restSeconds : GOAL_REST[profile.goal]
}

/**
 * Build a session from a plan day's EXPLICIT lifts (hybrid fidelity): keep the program's real
 * lifts + set/rep scheme, substitute any lift the user can't equip (goal-aware), and drive the
 * load through the app's own progression engine (prescribe) with a sensible cold-start fallback.
 */
/** A per-plan-day edit to the user's plan copy: exercises added to / removed from the day going forward. */
export interface DayEdit {
  add: string[]
  remove: string[]
}

/**
 * Resolve a plan day's lifts to concrete exercises: apply the user's "replace in my plan" swaps
 * (overrides, keyed by the lift's ORIGINAL exercise), then equipment-substitute anything they can't
 * equip (goal-aware). Pure; shared by the full session builder and the lighter id-only resolver.
 */
export function resolveDayLifts(day: PlanDay, profile: Profile, overrides: Record<string, string> = {}) {
  const goal = day.goal ?? profile.goal
  const owned = new Set<Equipment>([...profile.equipment, 'bodyweight'])
  const lifts = (day.lifts ?? []).map((l) => {
    const to = overrides[`${day.label}::${l.exerciseId}`]
    return { ...l, planLiftId: l.exerciseId, exerciseId: to && to !== l.exerciseId ? to : l.exerciseId }
  })
  let resolved = resolvePlanLifts(lifts, owned, goal).resolved
  // opt-in: extend "working around" to plan lifts — drop any whose PRIMARY mover is an avoided muscle.
  // (If this thins the day out, generateFromPlan falls back to focus-based generation, which already
  // respects avoidMuscles.) Off by default so a program keeps its structure unless the user opts in.
  if (profile.avoidInPlans && profile.avoidMuscles?.length) {
    const avoid = new Set(profile.avoidMuscles)
    resolved = resolved.filter(({ exerciseId }) => {
      const ex = getExercise(exerciseId)
      return !ex || !ex.primary.some((m) => avoid.has(m))
    })
  }
  return { resolved, goal }
}

/**
 * The exercise IDs that make up an active plan day — swaps AND the user's add/remove edits applied —
 * WITHOUT building full sets. Lets the library show today's exercises as checked before the session
 * is materialized. Mirrors buildPlanDayExercises' inclusion/exclusion exactly.
 */
export function planDayExerciseIds(
  day: PlanDay,
  profile: Profile,
  overrides: Record<string, string> = {},
  edit?: DayEdit,
): string[] {
  const { resolved } = resolveDayLifts(day, profile, overrides)
  const removed = new Set(edit?.remove ?? [])
  const ids = resolved
    .filter(({ lift, exerciseId }) => !removed.has(exerciseId) && !removed.has(lift.planLiftId))
    .map(({ exerciseId }) => exerciseId)
  for (const addId of edit?.add ?? []) if (!ids.includes(addId)) ids.push(addId)
  return ids
}

/**
 * Which active-plan day "today's workout" maps to — for attaching add/remove edits and for resolving
 * the checked-state on the library. Null when there's no plan context: no active plan, the plan no
 * longer resolves, or the current session is an ad-hoc (non-plan) workout.
 */
export function activePlanDayContext(
  current: Workout | null,
  activePlan: ActivePlan | null,
  customPlans: WorkoutPlan[],
): { planId: string; dayLabel: string; dayTitle: string } | null {
  if (!activePlan) return null
  const plan = resolvePlan(activePlan.planId, customPlans)
  if (!plan) return null
  if (current) {
    // an in-progress session carries plan context only if it IS this plan's day
    if (current.planId === activePlan.planId && current.planDayLabel) {
      const day = plan.schedule.find((d) => d.label === current.planDayLabel)
      return { planId: activePlan.planId, dayLabel: current.planDayLabel, dayTitle: day?.title ?? current.planDayLabel }
    }
    return null
  }
  // no session yet → today's plan day is today's workout
  const day = plan.schedule[activePlan.dayIndex % plan.schedule.length]
  return { planId: activePlan.planId, dayLabel: day.label, dayTitle: day.title }
}

/**
 * Build a session from a plan day's EXPLICIT lifts (hybrid fidelity): keep the program's real
 * lifts + set/rep scheme, substitute any lift the user can't equip (goal-aware), and drive the
 * load through the app's own progression engine (prescribe) with a sensible cold-start fallback.
 * The user's per-day `edit` (add/remove going forward) is applied on top.
 */
function buildPlanDayExercises(
  day: PlanDay,
  profile: Profile,
  history: Workout[],
  overrides: Record<string, string> = {},
  edit?: DayEdit,
): WorkoutExercise[] {
  const { resolved, goal } = resolveDayLifts(day, profile, overrides)
  const effProfile = day.goal ? { ...profile, goal: day.goal } : profile
  const removed = new Set(edit?.remove ?? [])
  // drop lifts the user removed from this plan day going forward (match the resolved exercise or the
  // plan slot's original id)
  const kept = resolved.filter(({ lift, exerciseId }) => !removed.has(exerciseId) && !removed.has(lift.planLiftId))
  // when a lift appears more than once in a day (e.g. 5/3/1 main wave + BBB 5x10 of the same lift),
  // track each occurrence so prescribe() reads THAT block's own history, not the first block's
  const occ = new Map<string, number>()
  const built: WorkoutExercise[] = kept.map(({ lift, exerciseId }) => {
    const ex = getExercise(exerciseId)
    const reps: [number, number] = [lift.repMin, lift.repMax]
    const occurrence = occ.get(exerciseId) ?? 0
    occ.set(exerciseId, occurrence + 1)
    const presc = ex ? prescribe(ex, history, reps, effProfile, occurrence) : null
    const target = Math.round((lift.repMin + lift.repMax) / 2)
    const weight = presc ? presc.weight : ex ? startingWeight(ex, effProfile) : 0
    const repVal = presc ? presc.reps : target
    const sets: LoggedSet[] = []
    // warm-ups for heavier compound lifts with a known load (shares the generator's gate + ramp)
    if (ex && ex.category === 'compound' && shouldWarmup(goal)) {
      sets.push(...warmupSets(weight, ex, profile.unit, repVal))
    }
    // the PROGRAM dictates the working set count
    for (let i = 0; i < Math.max(1, Math.min(lift.sets, 10)); i++) {
      sets.push({ id: uid('s'), weight, reps: repVal, done: false })
    }
    // surface an equipment substitution Fitbod-style ("swapped from Barbell Bench Press")
    const swappedFrom = lift.exerciseId !== exerciseId ? getExercise(lift.exerciseId)?.name : undefined
    const note = swappedFrom ? `Swapped from ${swappedFrom}${lift.note ? ` · ${lift.note}` : ''}` : lift.note
    return {
      exerciseId,
      instanceId: uid('we'),
      planLiftId: lift.planLiftId, // the plan slot's original exercise, for "replace in my plan" swaps
      planSlot: occurrence, // stable slot so prescribe reads THIS block's history (repeated-lift days)
      targetReps: reps,
      group: lift.group, // carry superset/circuit grouping from the plan into the session
      note,
      sets,
      coaching: presc ? { note: presc.note, incWeight: presc.incWeight, weightDir: presc.weightDir, repsDir: presc.repsDir } : undefined,
    }
  })
  // append exercises the user added to this plan day going forward (skip any already present)
  const present = new Set(built.map((e) => e.exerciseId))
  for (const addId of edit?.add ?? []) {
    if (present.has(addId)) continue
    present.add(addId)
    built.push(defaultSchemeForNewExercise(addId, profile, history))
  }
  return built
}

// every WorkoutExercise the screens read must have a sets array and a 2-tuple targetReps;
// otherwise iterating .sets / indexing .targetReps throws (recovery map, session and history
// rows) and drops the whole app to the ErrorBoundary on every load until a manual reset.
function validExercise(ex: unknown): boolean {
  if (!ex || typeof ex !== 'object') return false
  const e = ex as WorkoutExercise
  return (
    Array.isArray(e.sets) &&
    e.sets.every((s) => !!s && typeof s === 'object') && // a null/garbage set element still crashes readers
    Array.isArray(e.targetReps) &&
    e.targetReps.length === 2 && // indexing [0]/[1] must yield real numbers, not "undefined–undefined"
    e.targetReps.every((n) => typeof n === 'number' && Number.isFinite(n))
  )
}

/** Default rep range stamped onto a legacy exercise that persisted without a usable targetReps. */
const DEFAULT_TARGET_REPS: [number, number] = [8, 12]

/**
 * Repair what's cheaply repairable on a persisted exercise before validating it. A legacy session
 * may have been saved before targetReps existed (or with a malformed value); rather than dropping
 * the whole exercise — and, via .every(), the WHOLE session — default a missing/non-2-tuple
 * targetReps to [8,12] so the block survives hydration. A bad `sets` array is NOT repairable here
 * (we'd be inventing data), so such an exercise still fails validExercise and is filtered out.
 */
function repairExercise(ex: unknown): WorkoutExercise | null {
  if (!ex || typeof ex !== 'object') return null
  const e = ex as WorkoutExercise
  const tr = e.targetReps
  const goodTargetReps =
    Array.isArray(tr) && tr.length === 2 && tr.every((n) => typeof n === 'number' && Number.isFinite(n))
  const repaired = goodTargetReps ? e : { ...e, targetReps: DEFAULT_TARGET_REPS }
  return validExercise(repaired) ? repaired : null
}

/**
 * Validate + REPAIR a persisted workout. Returns a workout whose exercises are all readable, or
 * null if it can't be salvaged. Invalid exercises are filtered out (not allowed to null the whole
 * session) — but a session with zero salvageable exercises is dropped, since the screens have
 * nothing to render. Exercises missing only targetReps are repaired in place (legacy hydration).
 */
function sanitizeWorkout(w: unknown): Workout | null {
  if (!w || typeof w !== 'object' || !Array.isArray((w as Workout).exercises)) return null
  const exercises = (w as Workout).exercises
    .map(repairExercise)
    .filter((e): e is WorkoutExercise => e !== null)
  if (exercises.length === 0) return null // nothing readable left → not a usable session
  return { ...(w as Workout), exercises }
}

const VALID_GOALS: Goal[] = ['strength', 'hypertrophy', 'endurance', 'powerlifting', 'general']
const VALID_EXPERIENCE: Experience[] = ['beginner', 'intermediate', 'advanced']
const VALID_UNITS: Unit[] = ['lb', 'kg']

/** Coerce a persisted enum value back to a known member, falling back to the default. An
 * out-of-enum value (corrupt/legacy blob) would otherwise crash INCREMENTS[experience] in
 * progression and trap roving-tabindex radiogroups (no option matches → zero tab stops). */
function oneOf<T extends string>(val: unknown, valid: readonly T[], fallback: T): T {
  return typeof val === 'string' && (valid as readonly string[]).includes(val) ? (val as T) : fallback
}

/** Custom plans are minted with `uid('plan')` → "plan" + base36 chars (no separators); bundled and
 *  DB-managed plan ids are human/admin slugs ("stronglifts-5x5"). */
const looksLikeCustomPlanId = (id: string) => /^plan[a-z0-9]{8,}$/.test(id)

/**
 * Drop swap-overrides orphaned by a DELETED custom plan. `deleteCustomPlan` prunes them live, but a
 * blob persisted before that (or from another device) can still carry orphan keys, which then linger
 * forever. We prune ONLY keys that look like a custom-plan id AND no longer resolve to a current custom
 * plan — bundled/DB plan ids (slugs) are never touched, because DB plans load ASYNCHRONOUSLY after
 * hydration (plansRemote), so a DB-plan override must not be mistaken for an orphan here.
 */
function prunePlanOverrides(
  raw: unknown,
  customPlans: WorkoutPlan[],
): Record<string, Record<string, string>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, Record<string, string>> = {}
  for (const [planId, ov] of Object.entries(raw as Record<string, unknown>)) {
    if (!ov || typeof ov !== 'object' || Array.isArray(ov)) continue // garbage value
    if (looksLikeCustomPlanId(planId) && !customPlans.some((p) => p.id === planId)) continue // orphan
    out[planId] = ov as Record<string, string>
  }
  return out
}

/** Coerce + prune persisted planDayEdits: drop garbage values, orphaned custom-plan ids, and any
 *  day-edit that isn't a pair of string arrays. Mirrors prunePlanOverrides for the add/remove map. */
function prunePlanDayEdits(
  raw: unknown,
  customPlans: WorkoutPlan[],
): Record<string, Record<string, DayEdit>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const out: Record<string, Record<string, DayEdit>> = {}
  for (const [planId, days] of Object.entries(raw as Record<string, unknown>)) {
    if (!days || typeof days !== 'object' || Array.isArray(days)) continue
    if (looksLikeCustomPlanId(planId) && !customPlans.some((p) => p.id === planId)) continue // orphan
    const dayMap: Record<string, DayEdit> = {}
    for (const [dayLabel, e] of Object.entries(days as Record<string, unknown>)) {
      if (!e || typeof e !== 'object') continue
      const add = strs((e as DayEdit).add)
      const remove = strs((e as DayEdit).remove)
      if (add.length || remove.length) dayMap[dayLabel] = { add, remove }
    }
    if (Object.keys(dayMap).length) out[planId] = dayMap
  }
  return out
}

/** Immutably apply `fn` to one plan-day's edit, pruning the entry (and the plan) when it goes empty. */
function withDayEdit(
  all: Record<string, Record<string, DayEdit>>,
  planId: string,
  dayLabel: string,
  fn: (e: DayEdit) => DayEdit,
): Record<string, Record<string, DayEdit>> {
  const planMap = { ...(all[planId] ?? {}) }
  const cur = planMap[dayLabel] ?? { add: [], remove: [] }
  const next = fn({ add: [...cur.add], remove: [...cur.remove] })
  if (next.add.length === 0 && next.remove.length === 0) delete planMap[dayLabel]
  else planMap[dayLabel] = next
  const out = { ...all, [planId]: planMap }
  if (Object.keys(planMap).length === 0) delete out[planId]
  return out
}

/**
 * Defensively merge persisted state over defaults so a corrupt/older/partial blob can't
 * hydrate with the wrong shapes and crash the app. Exported for regression testing.
 */
export function mergePersisted(persisted: unknown, current: AppState): AppState {
  const p = (persisted ?? {}) as Partial<AppState>
  const profile = (p.profile ?? {}) as Partial<Profile>
  // hydrate custom plans first so the active plan can be validated against them below
  const customPlans: WorkoutPlan[] = Array.isArray(p.customPlans)
    ? (p.customPlans as WorkoutPlan[])
        .filter(
          (pl) =>
            !!pl &&
            typeof pl === 'object' &&
            typeof pl.id === 'string' &&
            Array.isArray(pl.schedule) &&
            pl.schedule.length > 0 && // an empty schedule → modulo-by-zero (NaN dayIndex) if ever started
            pl.schedule.every(
              (d) =>
                !!d &&
                Array.isArray(d.focus) &&
                (!d.lifts ||
                  (Array.isArray(d.lifts) &&
                    d.lifts.every((l) => l != null && typeof l === 'object' && typeof l.exerciseId === 'string'))),
            ),
        )
        .map((pl) => ({
          ...pl,
          schedule: pl.schedule.map((d, i) => {
            const label = typeof d.label === 'string' && d.label ? d.label : `Day ${i + 1}`
            const title = typeof d.title === 'string' && d.title ? d.title : label
            return { ...d, label, title }
          }),
        }))
    : current.customPlans
  const rawActivePlan =
    p.activePlan && typeof p.activePlan === 'object' && typeof (p.activePlan as ActivePlan).planId === 'string'
      ? {
          ...(p.activePlan as ActivePlan),
          // coerce a malformed dayIndex so plan progress can't silently break
          dayIndex: Number.isFinite((p.activePlan as ActivePlan).dayIndex)
            ? Math.max(0, Math.floor((p.activePlan as ActivePlan).dayIndex))
            : 0,
        }
      : null
  // drop a followed plan that no longer resolves (deleted custom plan / stale blob) so the user
  // isn't stranded following a phantom plan with no Home-side recovery
  const activePlan = rawActivePlan && resolvePlan(rawActivePlan.planId, customPlans) ? rawActivePlan : null
  return {
    ...current,
    ...p,
    // repair each record (default legacy targetReps, drop only the unsalvageable exercises rather
    // than the whole workout), drop a workout with nothing readable left, and coerce a missing focus
    workouts: Array.isArray(p.workouts)
      ? p.workouts
          .map((w) => sanitizeWorkout(w))
          .filter((w): w is Workout => w !== null)
          .map((w) => (Array.isArray(w.focus) ? w : { ...w, focus: [] }))
      : current.workouts,
    // repair the session (keep it as long as ≥1 exercise survives) rather than nulling the whole
    // thing on a single malformed block, but still require the top-level shape the screens read
    // (.focus / .title / .status) so a corrupt current can't crash them.
    current: (() => {
      const sanitized = sanitizeWorkout(p.current)
      return sanitized &&
        Array.isArray(sanitized.focus) &&
        typeof sanitized.title === 'string' &&
        typeof sanitized.status === 'string'
        ? sanitized
        : null
    })(),
    activePlan,
    customPlans,
    // seed per-plan progress, and ensure the currently-followed plan's live dayIndex is recorded so
    // switching away and back resumes there (covers blobs persisted before planProgress existed)
    planProgress: {
      ...(p.planProgress && typeof p.planProgress === 'object' && !Array.isArray(p.planProgress)
        ? (p.planProgress as Record<string, number>)
        : {}),
      ...(activePlan ? { [activePlan.planId]: activePlan.dayIndex } : {}),
    },
    // drop swap-overrides orphaned by a deleted custom plan (slug/DB ids preserved — see helper)
    planOverrides: prunePlanOverrides(p.planOverrides, customPlans),
    planDayEdits: prunePlanDayEdits(p.planDayEdits, customPlans),
    profile: {
      ...current.profile,
      ...profile,
      // snap enums back into range so a corrupt/legacy value can't crash progression or
      // leave a roving-tabindex radiogroup with no selectable (tabbable) option
      goal: oneOf(profile.goal, VALID_GOALS, current.profile.goal),
      experience: oneOf(profile.experience, VALID_EXPERIENCE, current.profile.experience),
      unit: oneOf(profile.unit, VALID_UNITS, current.profile.unit),
      equipment: Array.isArray(profile.equipment) ? profile.equipment : current.profile.equipment,
      focusMuscles: Array.isArray(profile.focusMuscles) ? profile.focusMuscles : current.profile.focusMuscles,
      avoidMuscles: Array.isArray(profile.avoidMuscles) ? profile.avoidMuscles : current.profile.avoidMuscles,
      // clamp persisted numerics so a corrupt blob can't feed NaN/Infinity/negative/absurd values into
      // restSecondsFor / the generator / effectiveLoad. Bodyweight bound is unit-agnostic (kg & lb),
      // so it's generous — just rejecting garbage, not validating the exact figure.
      sessionLength: boundedNum(profile.sessionLength, 10, 240, current.profile.sessionLength) ?? 45,
      bodyweight: boundedNum(profile.bodyweight, 20, 1000, undefined),
      restSeconds: boundedNum(profile.restSeconds, 5, 900, undefined),
      daysPerWeek: boundedNum(profile.daysPerWeek, 1, 7, undefined, true),
    },
  }
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      profile: DEFAULT_PROFILE,
      workouts: [],
      current: null,
      avoidNoticeDismissedId: null,
      restEndsAt: null,
      restDuration: 0,
      activePlan: null,
      customPlans: [],
      planProgress: {},
      planOverrides: {},
      planDayEdits: {},

      completeOnboarding: (p) =>
        set((s) => ({ profile: { ...s.profile, ...p, onboarded: true } })),
      updateProfile: (p) => set((s) => ({ profile: { ...s.profile, ...p } })),
      setGoal: (goal) => set((s) => ({ profile: { ...s.profile, goal } })),
      setExperience: (experience) => set((s) => ({ profile: { ...s.profile, experience } })),
      setUnit: (unit) => {
        const changed = get().profile.unit !== unit
        set((s) => {
          const from = s.profile.unit
          if (from === unit) return {}
          const convertWorkout = (w: Workout): Workout => ({
            ...w,
            // convert the frozen per-workout bodyweight too, or bodyweight-exercise volume breaks
            bodyweight: w.bodyweight ? convertWeight(w.bodyweight, from, unit) : w.bodyweight,
            exercises: w.exercises.map((we) => ({
              ...we,
              // convert the coaching increment too so its "+X {unit}" cue stays consistent
              coaching: we.coaching?.incWeight
                ? { ...we.coaching, incWeight: convertWeight(we.coaching.incWeight, from, unit) }
                : we.coaching,
              sets: we.sets.map((st) => ({ ...st, weight: convertWeight(st.weight, from, unit) })),
            })),
          })
          return {
            profile: {
              ...s.profile,
              unit,
              bodyweight: s.profile.bodyweight
                ? convertWeight(s.profile.bodyweight, from, unit)
                : s.profile.bodyweight,
            },
            workouts: s.workouts.map(convertWorkout),
            current: s.current ? convertWorkout(s.current) : null,
          }
        })
        // weights silently convert + round across all history — say so
        if (changed) emitToast(`Switched to ${unit === 'kg' ? 'kilograms' : 'pounds'} · weights converted`)
      },
      toggleEquipment: (e) =>
        set((s) => {
          const has = s.profile.equipment.includes(e)
          const equipment = has
            ? s.profile.equipment.filter((x) => x !== e)
            : [...s.profile.equipment, e]
          return { profile: { ...s.profile, equipment } }
        }),
      toggleFocusMuscle: (m) =>
        set((s) => {
          const has = s.profile.focusMuscles.includes(m)
          const focusMuscles = has
            ? s.profile.focusMuscles.filter((x) => x !== m)
            : [...s.profile.focusMuscles, m]
          // emphasizing a muscle clears it from "working around" — the two intents are exclusive
          const avoidMuscles = has ? s.profile.avoidMuscles : (s.profile.avoidMuscles ?? []).filter((x) => x !== m)
          return { profile: { ...s.profile, focusMuscles, avoidMuscles } }
        }),

      toggleAvoidMuscle: (m) =>
        set((s) => {
          const avoid = s.profile.avoidMuscles ?? []
          const has = avoid.includes(m)
          const avoidMuscles = has ? avoid.filter((x) => x !== m) : [...avoid, m]
          // working around a muscle clears it from "emphasize" — the two intents are exclusive
          const focusMuscles = has ? s.profile.focusMuscles : s.profile.focusMuscles.filter((x) => x !== m)
          return { profile: { ...s.profile, avoidMuscles, focusMuscles } }
        }),

      generate: (opts) => {
        const { profile, workouts } = get()
        const w = generateWorkout(profile, workouts, Date.now(), opts)
        // a new session starts fresh — clear any rest timer left from the previous one
        set({ current: w, restEndsAt: null, restDuration: 0 })
      },

      setCurrent: (w) => set({ current: w, restEndsAt: null, restDuration: 0 }),

      repeatWorkout: (id) => {
        const src = get().workouts.find((w) => w.id === id)
        if (!src) return false
        // clone into a fresh planned session: new ids, all sets reset to undone, completion + plan
        // links dropped so a repeat is standalone and never advances plan rotation
        const clone: Workout = {
          ...src,
          id: uid('w'),
          date: Date.now(),
          status: 'planned',
          startedAt: undefined,
          completedAt: undefined,
          durationMin: undefined,
          planId: undefined,
          planDayLabel: undefined,
          bodyweight: undefined,
          exercises: src.exercises.map((we) => ({
            ...we,
            instanceId: uid('we'),
            sets: we.sets.map((st) => ({ ...st, id: uid('s'), done: false })),
          })),
        }
        set({ current: clone, restEndsAt: null, restDuration: 0 })
        return true
      },

      startWorkout: () =>
        set((s) =>
          s.current
            ? { current: { ...s.current, status: 'active', startedAt: Date.now() } }
            : {},
        ),

      finishWorkout: () => {
        const { current, workouts, activePlan, profile, customPlans } = get()
        if (!current) return
        const completedAt = Date.now()
        // keep only completed sets, and only exercises that completed a real WORKING set
        const exercises = current.exercises
          .map((we) => ({ ...we, sets: we.sets.filter((sset) => sset.done) }))
          .filter((we) => we.sets.some((sset) => !sset.warmup))
        // nothing real was logged (empty or warmups only) — discard rather than save junk
        if (exercises.length === 0) {
          set({ current: null, restEndsAt: null, restDuration: 0 })
          return
        }
        // cap duration so an abandoned-then-resumed session can't record hours/days
        const rawDuration = current.startedAt
          ? Math.round((completedAt - current.startedAt) / 60000)
          : current.durationMin ?? 45
        const durationMin = Math.max(1, Math.min(rawDuration, 240))
        const bw =
          profile.bodyweight && profile.bodyweight > 0
            ? profile.bodyweight
            : defaultBodyweight(profile.unit)
        // stamp the local calendar day + tz offset so server-side analytics bucket by the user's day
        // (not UTC); reconcile_user reads tzOffsetMin and clears day_is_estimated. Old blobs lacking
        // these fall back to UTC. Both additive/optional — they only ride the existing blob push.
        const cd = new Date(completedAt)
        const pad = (n: number) => String(n).padStart(2, '0')
        const performed_on = `${cd.getFullYear()}-${pad(cd.getMonth() + 1)}-${pad(cd.getDate())}`
        const finished: Workout = {
          ...current,
          status: 'completed',
          exercises,
          date: completedAt,
          completedAt,
          durationMin,
          // freeze the bodyweight used for this session so volume doesn't shift retroactively
          bodyweight: current.bodyweight ?? bw,
          performed_on,
          tzOffsetMin: cd.getTimezoneOffset(),
        }
        // advance the structured plan when this session belonged to it
        let nextPlan = activePlan
        let nextProgress = get().planProgress
        if (activePlan && finished.planId === activePlan.planId) {
          const plan = resolvePlan(activePlan.planId, customPlans)
          if (plan) {
            const nextDay = (activePlan.dayIndex + 1) % plan.schedule.length
            nextPlan = { ...activePlan, dayIndex: nextDay }
            // remember the new position so leaving and returning to this plan resumes here
            nextProgress = { ...nextProgress, [activePlan.planId]: nextDay }
          }
        }
        set({
          current: null,
          restEndsAt: null,
          restDuration: 0,
          workouts: [finished, ...workouts],
          activePlan: nextPlan,
          planProgress: nextProgress,
        })
      },

      discardCurrent: () => set({ current: null, restEndsAt: null, restDuration: 0 }),

      startPlan: (planId, restart = false) => {
        const plan = resolvePlan(planId, get().customPlans)
        if (!plan) return
        set((s) => {
          // resume where the user left off on this plan (or day 1 if new / restarting), clamped in range
          const saved = restart ? 0 : (s.planProgress[planId] ?? 0)
          const dayIndex = Math.min(Math.max(0, saved), plan.schedule.length - 1)
          // starting/switching a plan makes that plan's day the "workout of the day". An existing
          // session would otherwise stay as the Home hero (and finishing it can't advance the new
          // plan), so drop it when it has no logged work; if it holds real logged sets, keep it but
          // untag it (standalone) rather than silently discarding the user's effort.
          const hasLogged = !!s.current?.exercises.some((we) => we.sets.some((st) => st.done && !st.warmup))
          const isOtherSession = !!s.current && s.current.planId !== planId
          let current = s.current
          if (isOtherSession) {
            current = hasLogged ? { ...s.current!, planId: undefined, planDayLabel: undefined } : null
          }
          return {
            activePlan: { planId, dayIndex, startedAt: Date.now() },
            planProgress: { ...s.planProgress, [planId]: dayIndex },
            current,
            ...(current === null ? { restEndsAt: null, restDuration: 0 } : {}),
          }
        })
      },

      stopPlan: () =>
        set((s) => ({
          activePlan: null,
          current: s.current?.planId
            ? { ...s.current, planId: undefined, planDayLabel: undefined }
            : s.current,
        })),

      skipPlanDay: () =>
        set((s) => {
          if (!s.activePlan) return {}
          const plan = resolvePlan(s.activePlan.planId, s.customPlans)
          if (!plan) return {}
          const nextDay = (s.activePlan.dayIndex + 1) % plan.schedule.length
          return {
            activePlan: { ...s.activePlan, dayIndex: nextDay },
            planProgress: { ...s.planProgress, [s.activePlan.planId]: nextDay },
            // an in-progress session was for the day we just skipped — untag it so finishing
            // it doesn't advance the (now different) plan day
            current: s.current?.planId
              ? { ...s.current, planId: undefined, planDayLabel: undefined }
              : s.current,
          }
        }),

      generateFromPlan: (shuffle = 0) => {
        const { profile, workouts, activePlan, customPlans, planOverrides, planDayEdits } = get()
        if (!activePlan) return
        const plan = resolvePlan(activePlan.planId, customPlans)
        if (!plan) return
        const day = plan.schedule[activePlan.dayIndex % plan.schedule.length]
        const edit = planDayEdits[activePlan.planId]?.[day.label]
        const liftCount = day.lifts?.length ?? 0
        // a day with no plan lifts but user-added exercises should still build from those additions
        const buildable = liftCount > 0 || (edit?.add.length ?? 0) > 0
        // hybrid: build the program's explicit lifts (with distinct equipment substitution + any
        // active-plan "replace in my plan" swaps), then apply the user's add/remove edits for the day
        const hybrid = buildable ? buildPlanDayExercises(day, profile, workouts, planOverrides[activePlan.planId] ?? {}, edit) : []
        // heavy substitution collapse (e.g. a barbell day reduced to 1 bodyweight exercise) makes a
        // thin/odd session — prefer the fuller recovery-aware generation from the day's focus instead.
        // BUT once the user has hand-edited this day (add/remove), trust their shaped hybrid rather than
        // regenerating from focus (which would silently undo a removal or drop their additions).
        const hasEdits = !!edit && (edit.add.length > 0 || edit.remove.length > 0)
        const collapsed = !hasEdits && hybrid.length > 0 && hybrid.length < Math.min(3, liftCount)
        let w: Workout
        if (hybrid.length > 0 && !collapsed) {
          w = {
            id: uid('w'),
            date: Date.now(),
            status: 'planned',
            title: day.title,
            exercises: hybrid,
            focus: day.focus.slice(0, 3),
            durationMin: Math.max(11, hybrid.length * 11),
            genFocus: day.focus,
          }
        } else if (day.focus.length > 0) {
          // focus-based fallback (no explicit lifts, none equippable, or a heavy collapse)
          w = generateWorkout(profile, workouts, Date.now(), {
            focusOverride: day.focus,
            equipmentOverride: planEquipment(plan),
            goalOverride: day.goal,
            shuffle,
          })
          w.title = day.title
          w.focus = day.focus.slice(0, 3)
          w.genFocus = day.focus
        } else if (hybrid.length > 0) {
          // thin, but no focus to fall back on — use the equippable lifts we have rather than nothing
          w = {
            id: uid('w'),
            date: Date.now(),
            status: 'planned',
            title: day.title,
            exercises: hybrid,
            focus: day.focus.slice(0, 3),
            durationMin: Math.max(11, hybrid.length * 11),
            genFocus: day.focus,
          }
        } else {
          // a day with neither equippable lifts nor a focus can't be generated — skip without trapping
          return
        }
        w.planId = plan.id
        w.planDayLabel = day.label
        set({ current: w, restEndsAt: null, restDuration: 0 })
      },

      generateFromPlanDay: (dayIndex) => {
        const { activePlan, customPlans } = get()
        if (!activePlan) return
        const plan = resolvePlan(activePlan.planId, customPlans)
        if (!plan) return
        const len = plan.schedule.length
        // point the plan at the chosen day (normalize into range), record progress, then build it —
        // generateFromPlan reads activePlan.dayIndex, so set it first within this action
        const di = ((dayIndex % len) + len) % len
        set((s) =>
          s.activePlan
            ? {
                activePlan: { ...s.activePlan, dayIndex: di },
                planProgress: { ...s.planProgress, [s.activePlan.planId]: di },
              }
            : {},
        )
        get().generateFromPlan()
      },

      dismissAvoidNotice: (sessionId) => set({ avoidNoticeDismissedId: sessionId }),

      addCustomPlan: (plan) =>
        set((s) => ({ customPlans: [...s.customPlans, { ...plan, custom: true }] })),

      updateCustomPlan: (id, plan) =>
        set((s) => {
          const oldPlan = s.customPlans.find((p) => p.id === id)
          const customPlans = s.customPlans.map((p) => (p.id === id ? { ...plan, id, custom: true } : p))
          const following = s.activePlan?.planId === id
          // if you're following this plan and the edit shortened its schedule, clamp the day so you
          // stay on the nearest valid day instead of silently wrapping to an earlier one
          const lastDay = Math.max(0, plan.schedule.length - 1)
          const clampedDay = following ? Math.min(s.activePlan!.dayIndex, lastDay) : 0
          const activePlan = following ? { ...s.activePlan!, dayIndex: clampedDay } : s.activePlan
          // an in-progress session followed THIS plan day; renaming the day's label leaves
          // current.planDayLabel stale, so Home's currentIsPlanDay (label match) silently detaches
          // the session from the plan. Remap it to the SAME schedule position's new label (the day
          // the clamped dayIndex now points at) so the session stays tied to the plan.
          const followingCurrent = following && s.current?.planId === id
          const newLabel = plan.schedule[clampedDay]?.label
          const current =
            followingCurrent && newLabel != null && s.current!.planDayLabel !== newLabel
              ? { ...s.current!, planDayLabel: newLabel }
              : s.current
          // clamp saved per-plan progress too, so resuming a now-shorter plan can't land past its end
          const savedProgress = s.planProgress[id]
          const planProgress =
            savedProgress != null && savedProgress > lastDay
              ? { ...s.planProgress, [id]: lastDay }
              : s.planProgress
          // "Replace in my plan" swap-overrides for this plan are keyed by `${dayLabel}::${liftId}`.
          // Renaming a day's label (or removing a day) would orphan those keys — the new day looks up
          // `${newLabel}::${liftId}` and misses the override, so the swap silently stops applying.
          // Remap each day's overrides from its OLD label to its NEW label (by schedule position) and
          // drop overrides for days the edit removed; mirrors deleteCustomPlan's override hygiene.
          const remapPlanOverrides = (): Record<string, Record<string, string>> => {
            const all = s.planOverrides ?? {}
            const mine = all[id]
            if (!mine || !oldPlan) return all // a brand-new plan or no overrides → nothing to remap
            const oldLabels = oldPlan.schedule.map((d) => d.label)
            const newLabels = plan.schedule.map((d) => d.label)
            const rename = new Map<string, string>() // old label → new label, for renamed-in-place days
            for (let i = 0; i < Math.min(oldLabels.length, newLabels.length); i++) {
              if (oldLabels[i] !== newLabels[i]) rename.set(oldLabels[i], newLabels[i])
            }
            const validNew = new Set(newLabels)
            const next: Record<string, string> = {}
            for (const [key, val] of Object.entries(mine)) {
              const sep = key.indexOf('::')
              if (sep < 0) {
                next[key] = val // malformed key (no day separator) — keep as-is, never crash
                continue
              }
              const label = key.slice(0, sep)
              if (rename.has(label)) next[`${rename.get(label)}${key.slice(sep)}`] = val // day renamed
              else if (validNew.has(label)) next[key] = val // day unchanged
              // else: the day was removed by this edit → drop its overrides
            }
            return { ...all, [id]: next }
          }
          return { customPlans, activePlan, current, planProgress, planOverrides: remapPlanOverrides() }
        }),

      deleteCustomPlan: (id) =>
        set((s) => {
          const { [id]: _removed, ...restOverrides } = s.planOverrides ?? {}
          const { [id]: _removedEdits, ...restEdits } = s.planDayEdits ?? {}
          return {
          customPlans: s.customPlans.filter((p) => p.id !== id),
          // if the deleted plan was the one being followed, stop following it
          activePlan: s.activePlan?.planId === id ? null : s.activePlan,
          planOverrides: restOverrides, // drop the deleted plan's swap overrides
          planDayEdits: restEdits, // …and its add/remove day edits
          current:
            s.current?.planId === id ? { ...s.current, planId: undefined, planDayLabel: undefined } : s.current,
          }
        }),

      duplicatePlan: (id) => {
        const src = resolvePlan(id, get().customPlans)
        if (!src) return null
        const newId = uid('plan')
        const copy: WorkoutPlan = {
          ...structuredCloneSafe(src),
          id: newId,
          name: `${src.name} (Copy)`,
          custom: true,
        }
        set((s) => ({ customPlans: [...s.customPlans, copy] }))
        return newId
      },

      addExercise: (exerciseId) =>
        set((s) => ({
          current: mutateCurrent(s.current, (w) => {
            if (w.exercises.some((e) => e.exerciseId === exerciseId)) return w
            w.exercises.push(defaultSchemeForNewExercise(exerciseId, s.profile, s.workouts))
            return w
          }),
        })),

      removeExercise: (exerciseId) => {
        // capture the removed block + its position so the toast can offer a one-tap Undo
        let undo: (() => void) | null = null
        set((s) => ({
          current: mutateCurrent(s.current, (w) => {
            const index = w.exercises.findIndex((e) => e.instanceId === exerciseId || e.exerciseId === exerciseId)
            if (index < 0) return w
            const [removed] = w.exercises.splice(index, 1)
            undo = () =>
              set((s2) => ({
                current: mutateCurrent(s2.current, (w2) => {
                  const key = removed.instanceId ?? removed.exerciseId
                  if (!w2.exercises.some((e) => (e.instanceId ?? e.exerciseId) === key))
                    w2.exercises.splice(Math.min(index, w2.exercises.length), 0, removed)
                  return w2
                }),
              }))
            return w
          }),
        }))
        if (undo) emitToast('Exercise removed', { label: 'Undo', onAction: undo })
      },

      addExerciseToday: (exerciseId, forward) => {
        const ctx = activePlanDayContext(get().current, get().activePlan, get().customPlans)
        // record the "going forward" edit FIRST so a freshly-built plan session already includes it
        if (forward && ctx) {
          set((s) => ({
            planDayEdits: withDayEdit(s.planDayEdits, ctx.planId, ctx.dayLabel, (e) => ({
              add: e.add.includes(exerciseId) ? e.add : [...e.add, exerciseId],
              remove: e.remove.filter((x) => x !== exerciseId),
            })),
          }))
        }
        // materialize today's session if there isn't one (its plan day if on a plan, else a generic one)
        if (!get().current) {
          if (ctx) get().generateFromPlan()
          else get().generate()
        }
        get().addExercise(exerciseId) // no-op if the build above already included it
      },

      removeExerciseToday: (exerciseId, forward) => {
        const ctx = activePlanDayContext(get().current, get().activePlan, get().customPlans)
        if (forward && ctx) {
          set((s) => ({
            planDayEdits: withDayEdit(s.planDayEdits, ctx.planId, ctx.dayLabel, (e) =>
              // an added-going-forward exercise un-adds; a plan lift goes onto the remove list
              e.add.includes(exerciseId)
                ? { add: e.add.filter((x) => x !== exerciseId), remove: e.remove }
                : { add: e.add, remove: e.remove.includes(exerciseId) ? e.remove : [...e.remove, exerciseId] },
            ),
          }))
        }
        // if only a plan-day preview is showing (no session yet), build it first so the removal sticks
        if (!get().current && ctx) get().generateFromPlan()
        get().removeExercise(exerciseId) // shows the Undo toast when it actually removes something
      },

      swapExercise: (oldId, newId) =>
        set((s) => ({
          current: mutateCurrent(s.current, (w) => {
            const idx = w.exercises.findIndex(byKey(oldId))
            if (idx === -1) return w
            // target already present: leave the session unchanged rather than destroying sets
            if (w.exercises.some((e) => e.exerciseId === newId)) return w
            const prevInstance = w.exercises[idx].instanceId
            // The new exercise gets its OWN autofilled load/scheme (warm-ups aren't carried), but
            // any sets the user already LOGGED on the old block are preserved rather than silently
            // wiped — overlaid onto the new block's working sets so logged effort survives the swap.
            const logged = w.exercises[idx].sets.filter((set) => set.done && !set.warmup)
            const fresh = defaultSchemeForNewExercise(newId, s.profile, s.workouts)
            if (logged.length) {
              let li = 0
              const carried = fresh.sets.map((set) => {
                if (set.warmup || li >= logged.length) return set
                const src = logged[li++]
                return { ...set, weight: src.weight, reps: src.reps, done: true }
              })
              // more logged sets than the new scheme prescribes → keep the extras too
              while (li < logged.length) {
                const src = logged[li++]
                carried.push({ id: uid('s'), weight: src.weight, reps: src.reps, done: true })
              }
              fresh.sets = carried
            }
            // keep the block's instanceId (per-exercise detail route stays valid), its superset
            // `group` (the new lift takes the swapped one's slot in the bracket), and its `planLiftId`
            // (so a later "replace in my plan" still keys back to the original plan slot)
            const old = w.exercises[idx]
            w.exercises[idx] = { ...fresh, instanceId: prevInstance ?? fresh.instanceId, group: old.group, planLiftId: old.planLiftId }
            return w
          }),
        })),

      reorderExercise: (exerciseId, dir) =>
        set((s) => ({
          current: mutateCurrent(s.current, (w) => {
            const idx = w.exercises.findIndex(byKey(exerciseId))
            if (idx === -1) return w
            // Move whole superset/circuit BLOCKS, never a single member out of its run.
            // A "block" is the maximal consecutive run of exercises sharing the moved exercise's
            // non-empty `group` (a standalone lift is a block of one). We also step OVER the entire
            // neighboring block rather than into the middle of it, so neither group is ever split.
            const blockBounds = (i: number): [number, number] => {
              const g = w.exercises[i].group
              if (!g || !g.trim()) return [i, i] // ungrouped → block is just this one exercise
              let lo = i
              let hi = i
              while (lo - 1 >= 0 && w.exercises[lo - 1].group === g) lo--
              while (hi + 1 < w.exercises.length && w.exercises[hi + 1].group === g) hi++
              return [lo, hi]
            }
            const [lo, hi] = blockBounds(idx)
            if (dir < 0) {
              // nothing above the moved block → can't move up
              if (lo === 0) return w
              const [nLo] = blockBounds(lo - 1) // the full neighboring block just above
              const block = w.exercises.splice(lo, hi - lo + 1)
              w.exercises.splice(nLo, 0, ...block) // reinsert ahead of the whole neighbor block
            } else {
              // nothing below the moved block → can't move down
              if (hi === w.exercises.length - 1) return w
              const [, nHi] = blockBounds(hi + 1) // the full neighboring block just below
              const block = w.exercises.splice(lo, hi - lo + 1)
              // after removing the block, the neighbor's end index shifts left by the block size
              w.exercises.splice(nHi - block.length + 1, 0, ...block)
            }
            return w
          }),
        })),

      replaceInActivePlan: (planLiftId, toExerciseId) =>
        set((s) => {
          const ap = s.activePlan
          const cur = s.current
          // only meaningful for the active plan's CURRENT day; plan definition is never touched
          if (!ap || !cur || cur.planId !== ap.planId || !cur.planDayLabel) return {}
          const key = `${cur.planDayLabel}::${planLiftId}`
          const all = { ...(s.planOverrides ?? {}) }
          const dayMap = { ...(all[ap.planId] ?? {}) }
          if (toExerciseId === planLiftId) delete dayMap[key] // swapped back to the plan's original → clear
          else dayMap[key] = toExerciseId
          all[ap.planId] = dayMap
          return { planOverrides: all }
        }),

      updateSet: (exerciseId, setId, patch) =>
        set((s) => ({
          current: mutateCurrent(s.current, (w) => {
            const we = w.exercises.find(byKey(exerciseId))
            if (!we) return w
            const st = we.sets.find((x) => x.id === setId)
            // whitelist + coerce the patch so only known set fields (no spoofed id / corrupt done/rpe)
            // ever reach the set — see sanitizeSetPatch
            if (st) Object.assign(st, sanitizeSetPatch(patch))
            return w
          }),
        })),

      setExerciseEffort: (exerciseId, rir) =>
        set((s) => ({
          current: mutateCurrent(s.current, (w) => {
            const we = w.exercises.find(byKey(exerciseId))
            if (!we) return w
            // reps-in-reserve → RPE (10 − RIR), capped to the 6–10 working scale; undefined clears.
            we.rpe = rir == null || !Number.isFinite(rir) ? undefined : Math.min(10, Math.max(6, 10 - rir))
            return w
          }),
        })),

      updateSetCascade: (exerciseId, setId, patch) =>
        set((s) => ({
          current: mutateCurrent(s.current, (w) => {
            const we = w.exercises.find(byKey(exerciseId))
            if (!we) return w
            const i = we.sets.findIndex((x) => x.id === setId)
            if (i < 0) return w
            const target = we.sets[i]
            const clean = sanitizeSetPatch(patch) // whitelist + coerce (see sanitizeSetPatch)
            // capture the pre-edit values so we only cascade to sets that were "in sync" with this one
            const prev = { weight: target.weight, reps: target.reps }
            Object.assign(target, clean)
            // For a bodyweight/unloaded movement, 0 lb is a DELIBERATE value, not an "empty" set — so
            // the "fill a fresh 0-weight set" convenience must NOT clobber it. Treat 0 as fill-eligible
            // for WEIGHT only on loaded exercises (where a 0 really means "not entered yet").
            const ex = getExercise(we.exerciseId)
            const weightZeroIsEmpty = !(ex && isBodyweightExercise(ex))
            // a working-set weight/reps edit flows FORWARD to the following not-yet-done working sets,
            // but only those that were still tracking this set (equal to its old value, or empty) — so a
            // deliberately-different back-off set, a logged (done) set, and warm-ups are all left alone.
            if (!target.warmup) {
              for (const f of ['weight', 'reps'] as const) {
                if (clean[f] == null) continue
                const before = prev[f]
                // reps: a 0 is always "empty"; weight: only on loaded exercises (bodyweight 0 is real)
                const zeroIsEmpty = f === 'reps' || weightZeroIsEmpty
                for (let j = i + 1; j < we.sets.length; j++) {
                  const st = we.sets[j]
                  if (st.warmup || st.done) continue
                  if (st[f] === before || (zeroIsEmpty && st[f] === 0)) st[f] = target[f] as number
                }
              }
            }
            return w
          }),
        })),

      addSet: (exerciseId) =>
        set((s) => ({
          current: mutateCurrent(s.current, (w) => {
            const we = w.exercises.find(byKey(exerciseId))
            if (!we) return w
            const last = [...we.sets].reverse().find((x) => !x.warmup)
            we.sets.push({
              id: uid('s'),
              weight: last?.weight ?? 0,
              reps: last?.reps ?? Math.round((we.targetReps[0] + we.targetReps[1]) / 2),
              done: false,
            })
            return w
          }),
        })),

      addWarmupSets: (exerciseId) =>
        set((s) => ({
          current: mutateCurrent(s.current, (w) => {
            const we = w.exercises.find(byKey(exerciseId))
            if (!we || we.sets.some((x) => x.warmup)) return w // already warmed up
            const ex = getExercise(we.exerciseId)
            const firstWork = we.sets.find((x) => !x.warmup)
            if (!ex || !firstWork || !(firstWork.weight > 0)) return w
            const warm = warmupSets(firstWork.weight, ex, s.profile.unit, firstWork.reps)
            if (warm.length === 0) return w
            we.sets = [...warm, ...we.sets] // ramp goes before the working sets
            return w
          }),
        })),

      removeSet: (exerciseId, setId) => {
        let undo: (() => void) | null = null
        set((s) => ({
          current: mutateCurrent(s.current, (w) => {
            const we = w.exercises.find(byKey(exerciseId))
            if (!we) return w
            const index = we.sets.findIndex((x) => x.id === setId)
            if (index < 0) return w
            const target = we.sets[index]
            // keep at least one WORKING set so an exercise can't be left unfinishable.
            // (warm-ups don't count — deleting the last working set, even with warm-ups
            // still present, would leave a 0/0 exercise that finishWorkout silently drops.)
            if (!target.warmup && we.sets.filter((x) => !x.warmup).length <= 1) return w
            we.sets.splice(index, 1)
            // snapshot the removed set so the toast can restore it at its original position
            undo = () =>
              set((s2) => ({
                current: mutateCurrent(s2.current, (w2) => {
                  const we2 = w2.exercises.find(byKey(exerciseId))
                  if (we2 && !we2.sets.some((x) => x.id === target.id))
                    we2.sets.splice(Math.min(index, we2.sets.length), 0, target)
                  return w2
                }),
              }))
            return w
          }),
        }))
        if (undo) emitToast('Set removed', { label: 'Undo', onAction: undo })
      },

      toggleSetDone: (exerciseId, setId) => {
        let startedWorkingSet = false
        set((s) => ({
          current: mutateCurrent(s.current, (w) => {
            const we = w.exercises.find(byKey(exerciseId))
            if (!we) return w
            const st = we.sets.find((x) => x.id === setId)
            if (st) {
              st.done = !st.done
              // only a freshly-completed *working* set should kick off the rest timer
              startedWorkingSet = st.done && !st.warmup
              // logging a working set begins the workout (so the timer/elapsed are accurate)
              if (startedWorkingSet && w.status === 'planned') {
                w.status = 'active'
                if (!w.startedAt) w.startedAt = Date.now()
              }
            }
            return w
          }),
        }))
        // auto-start rest timer when a working set is completed — but for a SUPERSET, share one rest
        // per round: suppress it while a partner is still behind (you should alternate to them first),
        // and only start the rest once the round evens out (the last partner's set in the round).
        if (startedWorkingSet) {
          const cur = get().current
          const exs = cur?.exercises ?? []
          const myIdx = exs.findIndex(byKey(exerciseId))
          const inUnfinishedSuperset = myIdx >= 0 && supersetPartnerBehind(exs, myIdx)
          if (!inUnfinishedSuperset) {
            get().startRest(restSecondsFor(get().profile))
          }
          // celebrate a new est-1RM record the instant it's logged (beats all prior history + this
          // session's earlier sets; first-ever attempts at a lift aren't flagged)
          if (cur && myIdx >= 0) {
            const { profile, workouts } = get()
            const liftId = exs[myIdx].exerciseId
            const bw =
              cur.bodyweight ?? (profile.bodyweight && profile.bodyweight > 0 ? profile.bodyweight : defaultBodyweight(profile.unit))
            const pr = detectSetPR(liftId, setId, cur, workouts, bw)
            if (pr.isPR) {
              const name = getExercise(liftId)?.name ?? 'Lift'
              emitToast(`${name} PR — est. 1RM ${pr.e1rm} ${profile.unit}`, undefined, 'pr')
            }
          }
        }
      },

      startRest: (seconds) =>
        set({ restEndsAt: Date.now() + seconds * 1000, restDuration: seconds }),
      adjustRest: (delta) =>
        set((s) => {
          if (!s.restEndsAt) return {}
          // anchor to the LIVE clock (not a stale end time), so +15 on an already-elapsed
          // "Rest complete" bar adds a real 15s, and derive restDuration from the actual
          // remaining time so the progress bar stays in sync
          const base = Math.max(Date.now(), s.restEndsAt)
          const next = Math.max(Date.now(), base + delta * 1000)
          return { restEndsAt: next, restDuration: Math.max(5, Math.ceil((next - Date.now()) / 1000)) }
        }),
      stopRest: () => set({ restEndsAt: null, restDuration: 0 }),

      setWorkoutNote: (id, note) =>
        set((s) => {
          const trimmed = note.trim()
          let changed = false
          const workouts = s.workouts.map((w) => {
            if (w.id !== id) return w
            changed = true
            if (trimmed) return { ...w, note: trimmed }
            // blank note → drop the field entirely so it doesn't persist empty
            const { note: _drop, ...rest } = w
            return rest
          })
          return changed ? { workouts } : {}
        }),

      deleteWorkout: (id) => {
        let undo: (() => void) | null = null
        set((s) => {
          const index = s.workouts.findIndex((w) => w.id === id)
          if (index < 0) return {}
          const removed = s.workouts[index]
          // snapshot the deleted workout so the toast can restore it at its original position
          undo = () =>
            set((s2) => {
              if (s2.workouts.some((w) => w.id === id)) return {}
              const next = [...s2.workouts]
              next.splice(Math.min(index, next.length), 0, removed)
              return { workouts: next }
            })
          return { workouts: s.workouts.filter((w) => w.id !== id) }
        })
        if (undo) emitToast('Workout deleted', { label: 'Undo', onAction: undo })
      },

      loadSampleData: () => {
        const { profile } = get()
        const sample = buildSampleHistory(profile, Date.now())
        // sample data is a clean demo slate — clear any in-progress session and plan
        set({ workouts: sample, current: null, restEndsAt: null, restDuration: 0, activePlan: null, planProgress: {}, planOverrides: {}, planDayEdits: {} })
        emitToast(`Loaded ${sample.length} sample workouts`)
      },

      resetAll: () =>
        set({
          profile: DEFAULT_PROFILE,
          workouts: [],
          current: null,
          restEndsAt: null,
          restDuration: 0,
          activePlan: null,
          customPlans: [],
          planProgress: {},
          planOverrides: {},
          planDayEdits: {},
        }),
    }),
    {
      name: 'daily-rep-v1',
      version: 1,
      // Passthrough migration so a future version bump can't silently discard user data;
      // merge() then defensively coerces whatever shape comes through.
      migrate: (persisted) => persisted as AppState,
      // Guard localStorage so the store module can be imported during SSR.
      storage: createJSONStorage(() =>
        typeof window !== 'undefined'
          ? window.localStorage
          : {
              getItem: () => null,
              setItem: () => {},
              removeItem: () => {},
            },
      ),
      // Don't persist transient rest-timer UI state — a reload after the timer
      // elapsed shouldn't leave a "Rest complete" bar stuck on every screen.
      partialize: (s) => ({
        profile: s.profile,
        workouts: s.workouts,
        current: s.current,
        activePlan: s.activePlan,
        customPlans: s.customPlans,
        planProgress: s.planProgress,
        planOverrides: s.planOverrides,
        planDayEdits: s.planDayEdits,
      }),
      // Defensively merge persisted state over defaults so a corrupt/older/partial
      // blob can't hydrate with the wrong shapes and crash the app (no array, etc.).
      merge: (persisted, current) => mergePersisted(persisted, current as AppState),
    },
  ),
)
