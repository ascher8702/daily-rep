import type { Equipment, Exercise, ExerciseCategory, MuscleGroup } from '../types'
import { ALL_MUSCLES } from '../data/muscles'

/**
 * Hardened, shared exercise validator — the catalogue analogue of planSchema. It validates the FULL
 * Exercise shape the app reads (id, name, category, equipment, primary/secondary muscles, difficulty,
 * instructions) AND referential integrity: every category is a known ExerciseCategory, every equipment
 * member a known Equipment, every muscle a known MuscleGroup. It REJECTS — never silently clamps — a
 * structural, referential, or enum violation, so a bad DB exercise can never reach the generator pool.
 * Recoverable descriptive noise (a malformed optional `unilateral`/`dosage`/`rationale`) is dropped
 * rather than rejecting the whole row, mirroring how planSchema carries through descriptive fields.
 *
 * Used by both the live DB path (parseExerciseRows) and the untrusted local cache (parseCachedExercises).
 */

export type ExerciseRejectReason =
  | 'not-object'
  | 'bad-id'
  | 'bad-name'
  | 'bad-category'
  | 'bad-equipment'
  | 'bad-muscle'
  | 'bad-difficulty'
  | 'bad-instructions'

export type ExerciseValidation =
  | { ok: true; exercise: Exercise }
  | { ok: false; reason: ExerciseRejectReason; id?: string; detail?: string }

// --- allowed enum members (kept in lockstep with the Exercise unions in types.ts + data/muscles.ts) ---
const MUSCLES: ReadonlySet<MuscleGroup> = new Set(ALL_MUSCLES)
const EQUIPMENT: ReadonlySet<Equipment> = new Set<Equipment>([
  'barbell',
  'dumbbell',
  'machine',
  'cable',
  'kettlebell',
  'bodyweight',
  'bands',
  'pullupbar',
  'bench',
  'ezbar',
])
const CATEGORIES: ReadonlySet<ExerciseCategory> = new Set<ExerciseCategory>([
  'compound',
  'isolation',
  'cardio',
  'core',
  'rehab',
])

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

/** An array (possibly empty) whose every member is a known MuscleGroup. */
function allMuscles(v: unknown): v is MuscleGroup[] {
  return Array.isArray(v) && v.every((m) => typeof m === 'string' && MUSCLES.has(m as MuscleGroup))
}

function reject(reason: ExerciseRejectReason, id?: string, detail?: string): ExerciseValidation {
  return { ok: false, reason, ...(id ? { id } : {}), ...(detail ? { detail } : {}) }
}

/**
 * Validate a single raw exercise (a DB row's `data`, or a cached item). Returns `{ ok, exercise }` with
 * the fully-normalized exercise re-assembled from validated parts (so no unknown keys leak through), or
 * `{ ok:false, reason, … }` with a typed reason so tests/telemetry can assert WHY a row was dropped.
 */
export function validateExerciseRow(raw: unknown): ExerciseValidation {
  if (!raw || typeof raw !== 'object') return reject('not-object')
  const e = raw as Partial<Exercise> & Record<string, unknown>

  if (!nonEmptyString(e.id)) return reject('bad-id')
  if (!nonEmptyString(e.name)) return reject('bad-name', e.id)
  if (!CATEGORIES.has(e.category as ExerciseCategory)) return reject('bad-category', e.id, String(e.category))

  // equipment: a non-empty array of known Equipment (an empty list is ambiguous for isExerciseDoable).
  if (
    !Array.isArray(e.equipment) ||
    e.equipment.length === 0 ||
    !e.equipment.every((q) => typeof q === 'string' && EQUIPMENT.has(q as Equipment))
  )
    return reject('bad-equipment', e.id)

  // muscles: `primary` must be all-known, and non-empty UNLESS this is a rehab exercise (the bundled
  // rehab-strain entries carry primary:[]). `secondary` must be all-known but may always be empty.
  if (!allMuscles(e.primary)) return reject('bad-muscle', e.id, 'primary')
  if (e.category !== 'rehab' && e.primary.length === 0) return reject('bad-muscle', e.id, 'primary')
  if (!allMuscles(e.secondary)) return reject('bad-muscle', e.id, 'secondary')

  if (e.difficulty !== 1 && e.difficulty !== 2 && e.difficulty !== 3)
    return reject('bad-difficulty', e.id)

  if (
    !Array.isArray(e.instructions) ||
    e.instructions.length === 0 ||
    !e.instructions.every((s) => nonEmptyString(s))
  )
    return reject('bad-instructions', e.id)

  // Re-assemble from the validated parts (never spread the raw object) so unknown keys don't leak into
  // the runtime Exercise. The optional descriptive fields don't affect generation, so a malformed one is
  // dropped (recoverable noise) rather than rejecting the whole row.
  const exercise: Exercise = {
    id: e.id,
    name: e.name,
    category: e.category as ExerciseCategory,
    equipment: e.equipment as Equipment[],
    primary: e.primary as MuscleGroup[],
    secondary: e.secondary as MuscleGroup[],
    difficulty: e.difficulty,
    instructions: e.instructions as string[],
  }
  if (typeof e.unilateral === 'boolean') exercise.unilateral = e.unilateral
  if (nonEmptyString(e.dosage)) exercise.dosage = e.dosage
  if (nonEmptyString(e.rationale)) exercise.rationale = e.rationale

  return { ok: true, exercise }
}

/**
 * Map a batch of raw exercise objects → valid exercises, dropping (and counting) the invalid. Pure;
 * never throws. De-dupes by id (last row wins, first-seen order preserved) so two DB rows with the same
 * id can't appear twice in the merged pool. `onReject` is an optional typed hook for telemetry.
 */
export function parseExerciseRows(
  rows: ReadonlyArray<unknown>,
  opts?: { onReject?: (r: Extract<ExerciseValidation, { ok: false }>) => void },
): { items: Exercise[]; dropped: number } {
  const byId = new Map<string, Exercise>()
  let dropped = 0
  for (const raw of rows) {
    const res = validateExerciseRow(raw)
    if (res.ok) byId.set(res.exercise.id, res.exercise)
    else {
      dropped++
      opts?.onReject?.(res)
    }
  }
  return { items: [...byId.values()], dropped }
}

/**
 * Validate items read back from the local cache. The cache is UNTRUSTED (the schema may have changed
 * since it was written), so the same full rules re-run on read. Returns the valid exercises, or null
 * when the payload isn't even an array (so the layer treats it as "no cache" → seed).
 */
export function parseCachedExercises(raw: unknown): Exercise[] | null {
  if (!Array.isArray(raw)) return null
  return parseExerciseRows(raw).items
}
