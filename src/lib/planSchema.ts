import type { EquipmentContext, PlanDay, PlanLift, WorkoutPlan } from '../data/plans'
import { getExercise } from '../data/exercises'
import type { Goal, MuscleGroup } from '../types'

/**
 * Hardened, shared plan validator — the successor to plansRemote.sanitizeRemotePlan. It validates the
 * FULL WorkoutPlan shape the app reads (id, name, non-empty schedule, each day's label/title/focus,
 * each lift's exerciseId/sets/reps) AND referential integrity: every PlanLift.exerciseId must resolve
 * via getExercise (which covers main lifts AND rehab ids). It coerces recoverable noise (forces
 * custom:false, defaults daysPerWeek, clamps absurd set/rep counts) but REJECTS — never silently
 * repairs — a structural, referential, or enum violation, so a bad DB plan can never reach generation.
 *
 * Used by both the live DB path (parsePlanRows) and the untrusted local cache (parseCachedPlans).
 */

export type PlanRejectReason =
  | 'not-object'
  | 'bad-id'
  | 'bad-name'
  | 'empty-schedule'
  | 'bad-day'
  | 'bad-lift'
  | 'unknown-exercise'
  | 'bad-enum'

export type PlanValidation =
  | { ok: true; plan: WorkoutPlan }
  | { ok: false; reason: PlanRejectReason; id?: string; detail?: string }

// --- allowed enum members (kept in lockstep with the WorkoutPlan unions in data/plans.ts + types.ts) --
const GOALS: ReadonlySet<Goal> = new Set([
  'strength',
  'hypertrophy',
  'endurance',
  'general',
  'powerlifting',
])
const LEVELS: ReadonlySet<WorkoutPlan['level']> = new Set<WorkoutPlan['level']>([
  'beginner',
  'intermediate',
  'advanced',
  'all',
])
const EQUIPMENT_LABELS: ReadonlySet<WorkoutPlan['equipment']> = new Set<WorkoutPlan['equipment']>([
  'Full gym',
  'Minimal',
  'Bodyweight',
])
const EQUIPMENT_CONTEXTS: ReadonlySet<EquipmentContext> = new Set<EquipmentContext>([
  'full-gym',
  'home-dumbbell',
  'bodyweight',
  'minimal',
])
const EVIDENCE_TIERS: ReadonlySet<NonNullable<WorkoutPlan['evidenceTier']>> = new Set<
  NonNullable<WorkoutPlan['evidenceTier']>
>(['well-established', 'popular-reasonable', 'popular-weak-evidence'])
const GENDER_AFFINITIES: ReadonlySet<NonNullable<WorkoutPlan['genderAffinity']>> = new Set<
  NonNullable<WorkoutPlan['genderAffinity']>
>(['male', 'female'])

// set/rep clamps — recoverable numeric noise (a bad sets:999 is harmless to clamp) per spec §7.20.
const SETS_MIN = 1
const SETS_MAX = 10
const REPS_MIN = 1
const REPS_MAX = 50

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

/** Clamp recoverable numeric noise into [lo, hi]; non-finite (NaN/Infinity/missing) → lo. */
function clamp(n: unknown, lo: number, hi: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

function reject(reason: PlanRejectReason, id?: string, detail?: string): PlanValidation {
  return { ok: false, reason, ...(id ? { id } : {}), ...(detail ? { detail } : {}) }
}

/** Validate + clamp one lift. Returns the normalized lift, or a rejection reason. */
function validateLift(raw: unknown): { lift: PlanLift } | { reason: PlanRejectReason; detail?: string } {
  if (!raw || typeof raw !== 'object') return { reason: 'bad-lift' }
  const l = raw as Partial<PlanLift>
  if (!nonEmptyString(l.exerciseId)) return { reason: 'bad-lift' }

  // referential integrity: the exercise id MUST resolve (main lib or rehab) — else the whole plan is
  // rejected, because generation would otherwise silently drop the lift and could thin a day to empty.
  if (!getExercise(l.exerciseId)) return { reason: 'unknown-exercise', detail: l.exerciseId }

  // sets/reps are recoverable numeric noise (sets:0, 999, NaN, repMin>repMax): clamp, don't reject —
  // a dangling exercise id corrupts generation, but a bad set count is harmless once clamped (§7.20).
  let repMin = clamp(l.repMin, REPS_MIN, REPS_MAX)
  let repMax = clamp(l.repMax, REPS_MIN, REPS_MAX)
  if (repMin > repMax) [repMin, repMax] = [repMax, repMin] // swap so repMin ≤ repMax

  const lift: PlanLift = {
    exerciseId: l.exerciseId,
    sets: clamp(l.sets, SETS_MIN, SETS_MAX),
    repMin,
    repMax,
  }
  if (nonEmptyString(l.group)) lift.group = l.group
  if (nonEmptyString(l.note)) lift.note = l.note
  return { lift }
}

/** Validate one day. Returns the normalized day, or a rejection reason. */
function validateDay(
  raw: unknown,
  index: number,
): { day: PlanDay } | { reason: PlanRejectReason; detail?: string } {
  if (!raw || typeof raw !== 'object') return { reason: 'bad-day' }
  const d = raw as Partial<PlanDay>

  // focus must be a non-empty array (it drives generation's modulo + targeting). Members are NOT
  // checked against the MuscleGroup union — a rehab/region focus like 'neck' is a valid focus value.
  if (!Array.isArray(d.focus) || d.focus.length === 0) return { reason: 'bad-day' }

  // label/title default to one another; a day missing BOTH (and with no index fallback) is bad-day.
  const hasLabel = nonEmptyString(d.label)
  const hasTitle = nonEmptyString(d.title)
  if (!hasLabel && !hasTitle) return { reason: 'bad-day' }
  const label = hasLabel ? (d.label as string) : hasTitle ? (d.title as string) : `Day ${index + 1}`
  const title = hasTitle ? (d.title as string) : label

  if (d.goal !== undefined && !GOALS.has(d.goal as Goal)) return { reason: 'bad-enum', detail: String(d.goal) }

  const day: PlanDay = { label, title, focus: d.focus as MuscleGroup[] }
  if (d.goal !== undefined) day.goal = d.goal as Goal

  // lifts are optional (a focus-only day is valid). An empty array is also valid.
  if (d.lifts !== undefined) {
    if (!Array.isArray(d.lifts)) return { reason: 'bad-day' }
    const lifts: PlanLift[] = []
    for (const rawLift of d.lifts) {
      const res = validateLift(rawLift)
      if ('reason' in res) return { reason: res.reason, detail: res.detail }
      lifts.push(res.lift)
    }
    day.lifts = lifts
  }
  return { day }
}

/**
 * Validate a single raw plan (a DB row's `data`, or a cached item). Returns `{ ok, plan }` with the
 * fully-normalized, `custom:false` plan, or `{ ok:false, reason, … }` with a typed reason (and the
 * offending id in `detail` for an unknown-exercise rejection) so tests/telemetry can assert WHY a row
 * was dropped.
 */
export function validatePlanRow(raw: unknown): PlanValidation {
  if (!raw || typeof raw !== 'object') return reject('not-object')
  const p = raw as Partial<WorkoutPlan> & Record<string, unknown>

  if (!nonEmptyString(p.id)) return reject('bad-id')
  if (!nonEmptyString(p.name)) return reject('bad-name', p.id)
  if (!Array.isArray(p.schedule) || p.schedule.length === 0) return reject('empty-schedule', p.id)

  // top-level enums — reject (don't coerce) so planEquipment's switch / UI filters never see an unknown.
  if (!LEVELS.has(p.level as WorkoutPlan['level'])) return reject('bad-enum', p.id, 'level')
  if (!EQUIPMENT_LABELS.has(p.equipment as WorkoutPlan['equipment']))
    return reject('bad-enum', p.id, 'equipment')
  if (!Array.isArray(p.goalFit) || p.goalFit.length === 0) return reject('bad-enum', p.id, 'goalFit')
  for (const g of p.goalFit) if (!GOALS.has(g as Goal)) return reject('bad-enum', p.id, `goalFit:${String(g)}`)
  if (p.equipmentContext !== undefined && !EQUIPMENT_CONTEXTS.has(p.equipmentContext as EquipmentContext))
    return reject('bad-enum', p.id, 'equipmentContext')
  if (p.evidenceTier !== undefined && !EVIDENCE_TIERS.has(p.evidenceTier as NonNullable<WorkoutPlan['evidenceTier']>))
    return reject('bad-enum', p.id, 'evidenceTier')
  if (p.genderAffinity !== undefined && !GENDER_AFFINITIES.has(p.genderAffinity as NonNullable<WorkoutPlan['genderAffinity']>))
    return reject('bad-enum', p.id, 'genderAffinity')

  const schedule: PlanDay[] = []
  for (let i = 0; i < p.schedule.length; i++) {
    const res = validateDay(p.schedule[i], i)
    if ('reason' in res) return reject(res.reason, p.id, res.detail)
    schedule.push(res.day)
  }

  const daysPerWeek =
    typeof p.daysPerWeek === 'number' && Number.isFinite(p.daysPerWeek) && p.daysPerWeek > 0
      ? p.daysPerWeek
      : schedule.length

  // Re-assemble from the validated parts (a DB plan is never a user "custom" plan). Carry through the
  // optional descriptive/source fields verbatim — they don't affect generation and were range-checked
  // above where they're unions.
  const plan: WorkoutPlan = {
    id: p.id,
    name: p.name,
    tagline: typeof p.tagline === 'string' ? p.tagline : '',
    description: typeof p.description === 'string' ? p.description : '',
    daysPerWeek,
    goalFit: p.goalFit as Goal[],
    level: p.level as WorkoutPlan['level'],
    equipment: p.equipment as WorkoutPlan['equipment'],
    schedule,
    custom: false,
  }
  if (Array.isArray(p.daysPerWeekOptions)) {
    const opts = p.daysPerWeekOptions.filter(
      (n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0,
    )
    if (opts.length) plan.daysPerWeekOptions = opts
  }
  if (p.equipmentContext !== undefined) plan.equipmentContext = p.equipmentContext as EquipmentContext
  if (typeof p.author === 'string') plan.author = p.author
  if (p.evidenceTier !== undefined) plan.evidenceTier = p.evidenceTier as WorkoutPlan['evidenceTier']
  if (typeof p.source === 'string') plan.source = p.source
  if (p.genderAffinity !== undefined) plan.genderAffinity = p.genderAffinity as WorkoutPlan['genderAffinity']

  return { ok: true, plan }
}

/**
 * Map a batch of raw plan objects → valid plans, dropping (and counting) the invalid. Pure; never
 * throws. `onReject` is an optional typed hook so a future telemetry breadcrumb can record WHY a row
 * dropped without changing this signature.
 */
export function parsePlanRows(
  rows: ReadonlyArray<unknown>,
  opts?: { onReject?: (r: Extract<PlanValidation, { ok: false }>) => void },
): { items: WorkoutPlan[]; dropped: number } {
  // De-dupe by id (last row wins) so two DB rows with the same id can't appear twice in the merged
  // catalogue. mergeCatalogue dedupes a remote plan against the BUNDLED set but appends remote-only
  // plans as-is, so the dedup of remote-vs-remote duplicates has to happen here (§7.19). A Map keeps
  // first-seen insertion order while letting a later duplicate overwrite the value.
  const byId = new Map<string, WorkoutPlan>()
  let dropped = 0
  for (const raw of rows) {
    const res = validatePlanRow(raw)
    if (res.ok) byId.set(res.plan.id, res.plan)
    else {
      dropped++
      opts?.onReject?.(res)
    }
  }
  return { items: [...byId.values()], dropped }
}

/**
 * Validate items read back from the local cache. The cache is UNTRUSTED (the schema or the bundled
 * exercise catalogue may have changed since it was written), so the same full rules — including
 * referential integrity — re-run on read. Returns the valid plans, or null when the payload isn't even
 * an array (so the layer treats it as "no cache" → seed).
 */
export function parseCachedPlans(raw: unknown): WorkoutPlan[] | null {
  if (!Array.isArray(raw)) return null
  return parsePlanRows(raw).items
}
