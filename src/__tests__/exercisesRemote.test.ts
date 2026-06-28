import { describe, it, expect, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../lib/database.types'
import type { Exercise } from '../types'

// --- modules under test (not built yet → these imports are the TDD red state) -------------------
import {
  createRemoteConfig,
  type AsyncKV,
  type RemoteConfigResource,
} from '../lib/remoteConfig'
import {
  validateExerciseRow,
  parseExerciseRows,
  parseCachedExercises,
} from '../lib/exerciseSchema'
import {
  exercisesRemoteConfig,
  useExercisesStore,
  fetchRemoteExercises,
  loadRemoteExercises,
} from '../lib/exercisesRemote'
import {
  EXERCISES,
  REHAB_EXERCISES,
  mergeExerciseCatalogue,
  setRuntimeExercises,
  getExercise,
  getExercisePool,
  getRehabPool,
} from '../data/exercises'
// cross-resource: a plan that references a DB-only exercise id (§7.17)
import { validatePlanRow } from '../lib/planSchema'
import type { WorkoutPlan } from '../data/plans'

// ------------------------------------------------------------------------------------------------
// Fakes: a controllable supabase client and a Map-backed AsyncKV (plus throwing variants).
// Mirrors src/__tests__/remoteConfig.test.ts exactly — inject fakes, no vi.mock.
// ------------------------------------------------------------------------------------------------

/** A fake supabase whose `.from().select().eq().order()` resolves to a { data, error } you control. */
function fakeClient(result: { data: unknown; error: unknown }, spy?: { fromCalls: number }) {
  const builder = {
    select() {
      return this
    },
    eq() {
      return this
    },
    order() {
      return Promise.resolve(result)
    },
  }
  return {
    from() {
      if (spy) spy.fromCalls += 1
      return builder
    },
  } as unknown as SupabaseClient<Database>
}

/** A fake client whose query THROWS (network reject). */
function throwingClient(spy?: { fromCalls: number }) {
  const builder = {
    select() {
      return this
    },
    eq() {
      return this
    },
    order() {
      return Promise.reject(new Error('network down'))
    },
  }
  return {
    from() {
      if (spy) spy.fromCalls += 1
      return builder
    },
  } as unknown as SupabaseClient<Database>
}

/** Map-backed in-memory AsyncKV. */
function memKV(seed?: Record<string, string>): AsyncKV & { store: Map<string, string> } {
  const store = new Map<string, string>(Object.entries(seed ?? {}))
  return {
    store,
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
  }
}

/** A KV that throws on getItem. */
function getThrowsKV(): AsyncKV {
  return {
    getItem: () => {
      throw new Error('storage read failed')
    },
    setItem: () => {},
    removeItem: () => {},
  }
}

/** A KV that throws on setItem (quota / private mode). */
function setThrowsKV(): AsyncKV & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: () => {
      throw new Error('quota exceeded')
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
  }
}

// ------------------------------------------------------------------------------------------------
// Fixtures: a known-valid regular exercise and a valid rehab exercise (real muscle/equipment values).
// ------------------------------------------------------------------------------------------------

const VALID_EXERCISE: Exercise = {
  id: 'db-test-ex',
  name: 'DB Test Lift',
  category: 'compound',
  equipment: ['barbell', 'bench'],
  primary: ['chest'],
  secondary: ['triceps'],
  difficulty: 2,
  instructions: ['cue one', 'cue two'],
}

const VALID_REHAB: Exercise = {
  id: 'db-test-rehab',
  name: 'DB Test Rehab',
  category: 'rehab',
  equipment: ['bodyweight'],
  primary: [],
  secondary: [],
  difficulty: 1,
  instructions: ['gentle hold'],
  dosage: '3 × 30s',
  rationale: 'calms the area',
}

/** Build a regular-exercise variant with overrides (deep-cloned so callers can mutate arrays). */
function ex(overrides: Partial<Exercise>): Exercise {
  return { ...structuredClone(VALID_EXERCISE), ...overrides }
}

/** Build a rehab-exercise variant with overrides. */
function rehab(overrides: Partial<Exercise>): Exercise {
  return { ...structuredClone(VALID_REHAB), ...overrides }
}

function row(data: unknown) {
  return { data }
}

const CACHE_KEY = 'daily-rep-remote-config:exercises'

/** Build the exercises resource over injected fakes, mirroring the production wiring. */
function makeExercisesResource(): RemoteConfigResource<
  Exercise,
  { pool: Exercise[]; rehab: Exercise[] }
> {
  return {
    key: 'exercises',
    table: 'exercises' as never, // the `exercises` table is added to database.types in this feature
    select: 'data',
    activeColumn: 'active',
    orderColumn: 'sort',
    parseRows: (rows) => parseExerciseRows(rows.map((r) => (r as { data: unknown }).data)),
    merge: (items) => mergeExerciseCatalogue(items),
    seed: { pool: EXERCISES, rehab: REHAB_EXERCISES },
    parseCache: parseCachedExercises,
  }
}

afterEach(() => {
  // restore the bundled runtime registry so other suites (and other tests here) are unaffected
  setRuntimeExercises({ pool: EXERCISES, rehab: REHAB_EXERCISES })
  useExercisesStore.setState({
    pool: EXERCISES,
    rehab: REHAB_EXERCISES,
    loaded: false,
    source: 'bundled',
  })
})

// ================================================================================================
// validateExerciseRow — structural + referential validation (spec §5.2 rules, §7 cases)
// ================================================================================================

describe('validateExerciseRow (happy path)', () => {
  it('accepts a fully valid regular exercise', () => {
    const res = validateExerciseRow(VALID_EXERCISE)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.exercise.id).toBe('db-test-ex')
      expect(res.exercise.category).toBe('compound')
      expect(res.exercise.primary).toEqual(['chest'])
    }
  })

  // §7.9 (rehab exception) — a rehab exercise with empty primary is valid
  it('accepts a valid rehab exercise with an empty primary array', () => {
    const res = validateExerciseRow(VALID_REHAB)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.exercise.category).toBe('rehab')
      expect(res.exercise.primary).toEqual([])
    }
  })

  it('re-assembles from validated parts so unknown keys do not leak through', () => {
    const res = validateExerciseRow({ ...VALID_EXERCISE, bogus: 'leak', __proto__hack: 1 })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(Object.prototype.hasOwnProperty.call(res.exercise, 'bogus')).toBe(false)
      expect(Object.prototype.hasOwnProperty.call(res.exercise, '__proto__hack')).toBe(false)
    }
  })

  it('carries through well-typed optionals (unilateral, dosage, rationale)', () => {
    const res = validateExerciseRow(
      ex({ unilateral: true, dosage: '3 × 30s', rationale: 'because' }),
    )
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.exercise.unilateral).toBe(true)
      expect(res.exercise.dosage).toBe('3 × 30s')
      expect(res.exercise.rationale).toBe('because')
    }
  })

  it('drops a malformed optional rather than rejecting the row', () => {
    const res = validateExerciseRow(
      ex({ unilateral: 'yes' as never, dosage: '' as never, rationale: 42 as never }),
    )
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.exercise.unilateral).toBeUndefined()
      expect(res.exercise.dosage).toBeUndefined()
      expect(res.exercise.rationale).toBeUndefined()
    }
  })
})

describe('validateExerciseRow (structural rejections — reject, never clamp)', () => {
  // §7.5
  it('rejects a non-object (null / string / number) with reason not-object', () => {
    expect(validateExerciseRow(null)).toMatchObject({ ok: false, reason: 'not-object' })
    expect(validateExerciseRow('nope')).toMatchObject({ ok: false, reason: 'not-object' })
    expect(validateExerciseRow(42)).toMatchObject({ ok: false, reason: 'not-object' })
  })

  // §7.12
  it('rejects a missing/empty id with reason bad-id', () => {
    expect(validateExerciseRow(ex({ id: '' }))).toMatchObject({ ok: false, reason: 'bad-id' })
    const noId = ex({})
    delete (noId as Partial<Exercise>).id
    expect(validateExerciseRow(noId)).toMatchObject({ ok: false, reason: 'bad-id' })
  })

  // §7.12
  it('rejects a missing/empty name with reason bad-name', () => {
    expect(validateExerciseRow(ex({ name: '' }))).toMatchObject({ ok: false, reason: 'bad-name' })
  })

  // §7.6
  it('rejects an unknown category with reason bad-category', () => {
    expect(validateExerciseRow(ex({ category: 'mobility' as never }))).toMatchObject({
      ok: false,
      reason: 'bad-category',
    })
  })

  // §7.7
  it('rejects an unknown equipment member with reason bad-equipment', () => {
    expect(validateExerciseRow(ex({ equipment: ['barbell', 'trx' as never] }))).toMatchObject({
      ok: false,
      reason: 'bad-equipment',
    })
  })

  // §7.7
  it('rejects an empty equipment array with reason bad-equipment', () => {
    expect(validateExerciseRow(ex({ equipment: [] }))).toMatchObject({
      ok: false,
      reason: 'bad-equipment',
    })
  })

  it('rejects a non-array equipment with reason bad-equipment', () => {
    expect(validateExerciseRow(ex({ equipment: 'barbell' as never }))).toMatchObject({
      ok: false,
      reason: 'bad-equipment',
    })
  })

  // §7.8
  it('rejects an unknown primary muscle with reason bad-muscle', () => {
    expect(validateExerciseRow(ex({ primary: ['pecs' as never] }))).toMatchObject({
      ok: false,
      reason: 'bad-muscle',
    })
  })

  // §7.8
  it('rejects an unknown secondary muscle with reason bad-muscle', () => {
    expect(validateExerciseRow(ex({ secondary: ['pecs' as never] }))).toMatchObject({
      ok: false,
      reason: 'bad-muscle',
    })
  })

  // §7.9 — empty primary on a NON-rehab exercise is rejected
  it('rejects an empty primary on a non-rehab exercise with reason bad-muscle', () => {
    expect(validateExerciseRow(ex({ primary: [] }))).toMatchObject({
      ok: false,
      reason: 'bad-muscle',
    })
  })

  it('rejects a non-array primary with reason bad-muscle', () => {
    expect(validateExerciseRow(ex({ primary: 'chest' as never }))).toMatchObject({
      ok: false,
      reason: 'bad-muscle',
    })
  })

  // §7.10
  it('rejects a bad difficulty (0, 4, 2.5, string, missing) with reason bad-difficulty', () => {
    expect(validateExerciseRow(ex({ difficulty: 0 as never }))).toMatchObject({
      ok: false,
      reason: 'bad-difficulty',
    })
    expect(validateExerciseRow(ex({ difficulty: 4 as never }))).toMatchObject({
      ok: false,
      reason: 'bad-difficulty',
    })
    expect(validateExerciseRow(ex({ difficulty: 2.5 as never }))).toMatchObject({
      ok: false,
      reason: 'bad-difficulty',
    })
    expect(validateExerciseRow(ex({ difficulty: '2' as never }))).toMatchObject({
      ok: false,
      reason: 'bad-difficulty',
    })
    const noDiff = ex({})
    delete (noDiff as Partial<Exercise>).difficulty
    expect(validateExerciseRow(noDiff)).toMatchObject({ ok: false, reason: 'bad-difficulty' })
  })

  // §7.11
  it('rejects bad instructions (missing, empty, [""], non-array) with reason bad-instructions', () => {
    expect(validateExerciseRow(ex({ instructions: [] }))).toMatchObject({
      ok: false,
      reason: 'bad-instructions',
    })
    expect(validateExerciseRow(ex({ instructions: [''] }))).toMatchObject({
      ok: false,
      reason: 'bad-instructions',
    })
    expect(validateExerciseRow(ex({ instructions: 'x' as never }))).toMatchObject({
      ok: false,
      reason: 'bad-instructions',
    })
    const noInstr = ex({})
    delete (noInstr as Partial<Exercise>).instructions
    expect(validateExerciseRow(noInstr)).toMatchObject({ ok: false, reason: 'bad-instructions' })
  })
})

// ================================================================================================
// parseExerciseRows — batch: drop-and-count invalid rows, de-dupe by id (last wins)
// ================================================================================================

describe('parseExerciseRows (drop invalid, count, keep valid)', () => {
  // §7.5
  it('drops a non-object row and keeps a sibling valid exercise', () => {
    const { items, dropped } = parseExerciseRows([null, VALID_EXERCISE])
    expect(items.length).toBe(1)
    expect(dropped).toBe(1)
    expect(items[0].id).toBe('db-test-ex')
  })

  // §7.5
  it('invokes onReject with the typed reason for each dropped row', () => {
    const reasons: string[] = []
    parseExerciseRows([null, ex({ category: 'mobility' as never })], {
      onReject: (r) => reasons.push(r.reason),
    })
    expect(reasons).toContain('not-object')
    expect(reasons).toContain('bad-category')
  })

  // §7.18 — duplicate ids de-duped, last row wins
  it('de-dupes duplicate ids (last row wins), preserving first-seen order', () => {
    const a = ex({ id: 'dupe', name: 'first' })
    const b = ex({ id: 'dupe', name: 'second' })
    const { items } = parseExerciseRows([a, b])
    expect(items.filter((e) => e.id === 'dupe').length).toBe(1)
    expect(items.find((e) => e.id === 'dupe')!.name).toBe('second')
  })
})

// ================================================================================================
// parseCachedExercises — untrusted cache re-validation (§7.22)
// ================================================================================================

describe('parseCachedExercises (cache is untrusted: re-validate on read)', () => {
  // §7.21 — a non-array payload → null ("no cache")
  it('returns null for a non-array payload', () => {
    expect(parseCachedExercises({})).toBeNull()
    expect(parseCachedExercises('nope')).toBeNull()
    expect(parseCachedExercises(null)).toBeNull()
  })

  // §7.22 — a cached exercise that is now invalid (bad muscle) is dropped; valid sibling survives
  it('drops a cached exercise whose muscle is now invalid and keeps the valid one', () => {
    const stale = ex({ id: 'stale', primary: ['pecs' as never] })
    const good = ex({ id: 'cached-good' })
    const out = parseCachedExercises([stale, good])
    expect(out).not.toBeNull()
    expect(out!.map((e) => e.id)).toEqual(['cached-good'])
  })

  it('returns the valid items for an all-valid cache payload', () => {
    const out = parseCachedExercises([ex({ id: 'c1' }), ex({ id: 'c2' })])
    expect(out!.map((e) => e.id)).toEqual(['c1', 'c2'])
  })
})

// ================================================================================================
// mergeExerciseCatalogue — pure merge into { pool, rehab } (§7.13–§7.16, §7.27, §7.31)
// ================================================================================================

describe('mergeExerciseCatalogue (pure merge / partition)', () => {
  // §7.27
  it('returns the bundled references (by identity) for empty / null / undefined remote', () => {
    for (const remote of [[] as Exercise[], null, undefined]) {
      const merged = mergeExerciseCatalogue(remote)
      expect(merged.pool).toBe(EXERCISES)
      expect(merged.rehab).toBe(REHAB_EXERCISES)
    }
  })

  // §7.13 — partition by the resulting category
  it('routes a regular exercise to pool and a rehab exercise to rehab', () => {
    const merged = mergeExerciseCatalogue([VALID_EXERCISE, VALID_REHAB])
    expect(merged.pool.some((e) => e.id === 'db-test-ex')).toBe(true)
    expect(merged.pool.some((e) => e.id === 'db-test-rehab')).toBe(false)
    expect(merged.rehab.some((e) => e.id === 'db-test-rehab')).toBe(true)
    expect(merged.rehab.some((e) => e.id === 'db-test-ex')).toBe(false)
  })

  // §7.14 — override a bundled id keeps pool length and bundled position
  it('overrides a bundled exercise in place (same position, length unchanged)', () => {
    const bundledIndex = EXERCISES.findIndex((e) => e.id === 'barbell-bench-press')
    const override = ex({ id: 'barbell-bench-press', name: 'OVERRIDDEN' })
    const merged = mergeExerciseCatalogue([override])
    expect(merged.pool.length).toBe(EXERCISES.length)
    expect(merged.pool[bundledIndex].id).toBe('barbell-bench-press')
    expect(merged.pool[bundledIndex].name).toBe('OVERRIDDEN')
  })

  // §7.15 — override flips a bundled regular exercise to rehab → it moves pools
  it('moves a bundled regular exercise to the rehab pool when an override flips its category', () => {
    const override = ex({
      id: 'burpee',
      category: 'rehab',
      primary: [], // rehab may have empty primary
    })
    const merged = mergeExerciseCatalogue([override])
    expect(merged.pool.some((e) => e.id === 'burpee')).toBe(false)
    expect(merged.rehab.some((e) => e.id === 'burpee')).toBe(true)
  })

  // §7.16 — a remote-only novel exercise is appended to its pool
  it('appends a remote-only novel exercise to the pool', () => {
    const novel = ex({ id: 'db-only-novel' })
    const merged = mergeExerciseCatalogue([novel])
    expect(merged.pool.length).toBe(EXERCISES.length + 1)
    expect(merged.pool.some((e) => e.id === 'db-only-novel')).toBe(true)
  })

  // §7.31 — pool purity: no rehab in the pool, even after a merge
  it('never includes a rehab exercise in the pool (pool purity)', () => {
    const merged = mergeExerciseCatalogue([VALID_EXERCISE, VALID_REHAB])
    expect(merged.pool.every((e) => e.category !== 'rehab')).toBe(true)
  })

  // §7.32 — merge must not mutate the bundled arrays
  it('does not mutate the bundled EXERCISES / REHAB_EXERCISES arrays', () => {
    const lenBefore = EXERCISES.length
    const rehabLenBefore = REHAB_EXERCISES.length
    mergeExerciseCatalogue([ex({ id: 'barbell-bench-press', name: 'X' }), VALID_REHAB])
    expect(EXERCISES.length).toBe(lenBefore)
    expect(REHAB_EXERCISES.length).toBe(rehabLenBefore)
    expect(EXERCISES.find((e) => e.id === 'barbell-bench-press')!.name).not.toBe('X')
  })
})

// ================================================================================================
// Runtime overlay accessors: getExercise / getExercisePool / getRehabPool (§7.13–§7.16, §7.26, §7.31)
// ================================================================================================

describe('runtime overlay accessors (bundled / backward-compat state)', () => {
  // §7.26 — before any load, getExercise behaves exactly as today
  it('getExercise resolves bundled lift / rehab / undefined exactly as today', () => {
    expect(getExercise('barbell-bench-press')!.name).toBe('Barbell Bench Press')
    expect(getExercise('rehab-chin-tuck')!.category).toBe('rehab')
    expect(getExercise('does-not-exist')).toBeUndefined()
  })

  // §7.26 — pools are reference-equal to the bundled arrays in the bundled state
  it('pools are reference-equal to the bundled arrays in the bundled state', () => {
    expect(getExercisePool()).toBe(EXERCISES)
    expect(getRehabPool()).toBe(REHAB_EXERCISES)
  })

  // §7.31 — pool purity in the bundled state
  it('getExercisePool() contains no rehab exercise (bundled state)', () => {
    expect(getExercisePool().every((e) => e.category !== 'rehab')).toBe(true)
  })
})

describe('runtime overlay accessors (after setRuntimeExercises overlay)', () => {
  // §7.13 — rehab routing through the live accessors
  it('routes an overlaid rehab exercise to getRehabPool only, getExercise still resolves it', () => {
    const merged = mergeExerciseCatalogue([VALID_REHAB])
    setRuntimeExercises(merged)
    expect(getExercise('db-test-rehab')!.name).toBe('DB Test Rehab')
    expect(getRehabPool().some((e) => e.id === 'db-test-rehab')).toBe(true)
    expect(getExercisePool().some((e) => e.id === 'db-test-rehab')).toBe(false)
  })

  // §7.13 — a regular overlaid exercise enters the pool
  it('routes an overlaid regular exercise into getExercisePool', () => {
    setRuntimeExercises(mergeExerciseCatalogue([VALID_EXERCISE]))
    expect(getExercisePool().some((e) => e.id === 'db-test-ex')).toBe(true)
    expect(getExercise('db-test-ex')!.name).toBe('DB Test Lift')
  })

  // §7.14 — override resolves the DB version via getExercise
  it('getExercise returns the DB override of a bundled id', () => {
    setRuntimeExercises(
      mergeExerciseCatalogue([ex({ id: 'barbell-bench-press', name: 'OVERRIDDEN' })]),
    )
    expect(getExercise('barbell-bench-press')!.name).toBe('OVERRIDDEN')
  })

  // §7.15 — category flip removes burpee from the generator pool
  it('removes a bundled exercise from the pool when an override flips it to rehab', () => {
    setRuntimeExercises(
      mergeExerciseCatalogue([ex({ id: 'burpee', category: 'rehab', primary: [] })]),
    )
    expect(getExercisePool().some((e) => e.id === 'burpee')).toBe(false)
    expect(getRehabPool().some((e) => e.id === 'burpee')).toBe(true)
  })

  // §7.16 — a novel remote-only exercise resolves once the runtime is set
  it('resolves a novel remote-only exercise via getExercise after setRuntimeExercises', () => {
    const novel = ex({ id: 'db-only-novel' })
    setRuntimeExercises(mergeExerciseCatalogue([novel]))
    expect(getExercise('db-only-novel')).toBeDefined()
    expect(getExercisePool().some((e) => e.id === 'db-only-novel')).toBe(true)
  })

  // §7.31 — pool purity after overlay (regular + rehab overlaid)
  it('getExercisePool() still contains no rehab exercise after an overlay', () => {
    setRuntimeExercises(mergeExerciseCatalogue([VALID_EXERCISE, VALID_REHAB]))
    expect(getExercisePool().every((e) => e.category !== 'rehab')).toBe(true)
  })

  // §7.32 — overlay does not mutate the bundled arrays the analytics test pins
  it('leaves EXERCISES at length 55 (same reference) after an override overlay', () => {
    const ref = EXERCISES
    setRuntimeExercises(mergeExerciseCatalogue([ex({ id: 'barbell-bench-press', name: 'X' })]))
    expect(EXERCISES).toBe(ref)
    expect(EXERCISES).toHaveLength(55)
  })
})

// ================================================================================================
// Cross-resource: a plan referencing a DB-only exercise (§7.17 — load ordering requirement)
// ================================================================================================

describe('plan validation against an overlaid DB-only exercise (§7.17)', () => {
  function planReferencing(exerciseId: string): WorkoutPlan {
    return {
      id: 'cross-ref-plan',
      name: 'Cross-ref Plan',
      tagline: 't',
      description: 'd',
      daysPerWeek: 1,
      goalFit: ['strength'],
      level: 'intermediate',
      equipment: 'Full gym',
      equipmentContext: 'full-gym',
      schedule: [
        {
          label: 'Day 1',
          title: 'Day 1',
          focus: ['chest'],
          lifts: [{ exerciseId, sets: 3, repMin: 5, repMax: 8 }],
        },
      ],
    }
  }

  it('drops a plan referencing a DB-only exercise BEFORE the exercise overlay (bundled runtime)', () => {
    // bundled runtime (afterEach restores it): the novel id does not resolve yet
    const res = validatePlanRow(planReferencing('db-only-novel'))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('unknown-exercise')
  })

  it('accepts the same plan AFTER the exercise overlay loads the DB-only exercise', () => {
    const novel = ex({ id: 'db-only-novel' })
    setRuntimeExercises({ pool: [...EXERCISES, novel], rehab: REHAB_EXERCISES })
    expect(validatePlanRow(planReferencing('db-only-novel')).ok).toBe(true)
  })
})

// ================================================================================================
// createRemoteConfig.refresh through the exercises resource — fetch → validate → merge → cache
// ================================================================================================

describe('exercises refresh (happy path)', () => {
  // happy path from §9: one override + one novel non-rehab
  it('applies an override + a novel row, merges, and writes a v:1 cache envelope', async () => {
    const override = ex({ id: EXERCISES[0].id, name: `${EXERCISES[0].name} (DB)` })
    const novel = ex({ id: 'db-only-novel', name: 'Novel DB Lift' })
    const kv = memKV()
    const handle = createRemoteConfig(makeExercisesResource(), {
      client: fakeClient({ data: [row(override), row(novel)], error: null }),
      storage: kv,
      now: () => 1700000000000,
    })

    const res = await handle.refresh()
    expect(res.status).toBe('applied')
    if (res.status === 'applied') {
      expect(res.rowCount).toBe(2)
      expect(res.dropped).toBe(0)
      // override wins for the bundled id, novel appended → pool grows by exactly 1
      expect(res.value.pool.find((e) => e.id === EXERCISES[0].id)!.name).toBe(
        `${EXERCISES[0].name} (DB)`,
      )
      expect(res.value.pool.some((e) => e.id === 'db-only-novel')).toBe(true)
      expect(res.value.pool.length).toBe(EXERCISES.length + 1)
    }

    const raw = kv.store.get(CACHE_KEY)
    expect(raw).toBeTruthy()
    const env = JSON.parse(raw!)
    expect(env.v).toBe(1)
    expect(env.key).toBe('exercises')
    expect(env.updatedAt).toBe(1700000000000)
  })

  // §7.5 — a malformed row is dropped/counted, the valid sibling still applies
  it('drops a malformed row and reports dropped count while applying valid rows', async () => {
    const handle = createRemoteConfig(makeExercisesResource(), {
      client: fakeClient({ data: [row(null), row(ex({ id: 'survivor' }))], error: null }),
      storage: memKV(),
    })
    const res = await handle.refresh()
    expect(res.status).toBe('applied')
    if (res.status === 'applied') {
      expect(res.dropped).toBe(1)
      expect(res.value.pool.some((e) => e.id === 'survivor')).toBe(true)
    }
  })

  // §7.13 — a rehab row applied through refresh lands in the rehab side of the value
  it('routes an applied rehab row into value.rehab, not value.pool', async () => {
    const handle = createRemoteConfig(makeExercisesResource(), {
      client: fakeClient({ data: [row(VALID_REHAB)], error: null }),
      storage: memKV(),
    })
    const res = await handle.refresh()
    if (res.status !== 'applied') throw new Error(`expected applied, got ${res.status}`)
    expect(res.value.rehab.some((e) => e.id === 'db-test-rehab')).toBe(true)
    expect(res.value.pool.some((e) => e.id === 'db-test-rehab')).toBe(false)
  })

  // §7.18 — duplicate ids in the DB result de-duped in the merged pool
  it('dedupes duplicate ids in the DB result (no duplicate id in the merged pool)', async () => {
    const a = ex({ id: 'dupe', name: 'first' })
    const b = ex({ id: 'dupe', name: 'second' })
    const handle = createRemoteConfig(makeExercisesResource(), {
      client: fakeClient({ data: [row(a), row(b)], error: null }),
      storage: memKV(),
    })
    const res = await handle.refresh()
    if (res.status !== 'applied') throw new Error('expected applied')
    expect(res.value.pool.filter((e) => e.id === 'dupe').length).toBe(1)
  })
})

describe('exercises refresh (degradation / edge cases)', () => {
  // §7.1 — no client
  it('returns unavailable (and keeps the seed references) when there is no supabase client', async () => {
    const kv = memKV()
    const handle = createRemoteConfig(makeExercisesResource(), { client: null, storage: kv })
    const res = await handle.refresh()
    expect(res.status).toBe('unavailable')
    expect(res.value.pool).toBe(EXERCISES)
    expect(res.value.rehab).toBe(REHAB_EXERCISES)
    expect(kv.store.has(CACHE_KEY)).toBe(false)
  })

  // §7.2 — network throws, a pre-existing good cache stays byte-identical
  it('returns unavailable when the query throws and leaves a seeded cache untouched', async () => {
    const seeded = {
      [CACHE_KEY]: JSON.stringify({
        v: 1,
        key: 'exercises',
        updatedAt: 1,
        items: [ex({ id: 'cached' })],
      }),
    }
    const kv = memKV(seeded)
    const handle = createRemoteConfig(makeExercisesResource(), {
      client: throwingClient(),
      storage: kv,
    })
    const res = await handle.refresh()
    expect(res.status).toBe('unavailable')
    expect(kv.store.get(CACHE_KEY)).toBe(seeded[CACHE_KEY])
  })

  // §7.3 — query resolves with { error }
  it('returns unavailable when the query resolves with an error (RLS/permission)', async () => {
    const handle = createRemoteConfig(makeExercisesResource(), {
      client: fakeClient({ data: null, error: { message: 'RLS denied' } }),
      storage: memKV(),
    })
    const res = await handle.refresh()
    expect(res.status).toBe('unavailable')
  })

  // §7.4 — empty DB
  it('returns empty (and the seed references) for 0 rows, without touching the cache', async () => {
    const kv = memKV()
    const handle = createRemoteConfig(makeExercisesResource(), {
      client: fakeClient({ data: [], error: null }),
      storage: kv,
    })
    const res = await handle.refresh()
    expect(res.status).toBe('empty')
    expect(res.value.pool).toBe(EXERCISES)
    expect(res.value.rehab).toBe(REHAB_EXERCISES)
    expect(kv.store.has(CACHE_KEY)).toBe(false)
  })

  // §7.24 — setItem throws but refresh still applies the live value
  it('still returns applied when the cache write throws (best-effort cache)', async () => {
    const handle = createRemoteConfig(makeExercisesResource(), {
      client: fakeClient({ data: [row(ex({ id: 'live-1' }))], error: null }),
      storage: setThrowsKV(),
    })
    const res = await handle.refresh()
    expect(res.status).toBe('applied')
    if (res.status === 'applied') {
      expect(res.value.pool.some((e) => e.id === 'live-1')).toBe(true)
    }
  })
})

// ================================================================================================
// createRemoteConfig.hydrateFromCache through the exercises resource (§7.19–§7.23, §7.25)
// ================================================================================================

describe('exercises hydrateFromCache (cache hit / miss / corruption)', () => {
  // §7.19 — cache hit, client never touched
  it('returns the merged cached value with fromCache:true without touching the client', async () => {
    const spy = { fromCalls: 0 }
    const env = JSON.stringify({
      v: 1,
      key: 'exercises',
      updatedAt: 1,
      items: [ex({ id: 'db-only-cached', name: 'Cached Lift' })],
    })
    const handle = createRemoteConfig(makeExercisesResource(), {
      client: fakeClient({ data: [], error: null }, spy),
      storage: memKV({ [CACHE_KEY]: env }),
    })
    const out = await handle.hydrateFromCache()
    expect(out.fromCache).toBe(true)
    expect(out.value.pool.some((e) => e.id === 'db-only-cached')).toBe(true)
    expect(spy.fromCalls).toBe(0)
  })

  // §7.20 — cache miss → seed references, fromCache:false
  it('returns the seed references with fromCache:false on a cache miss (no key)', async () => {
    const handle = createRemoteConfig(makeExercisesResource(), {
      client: null,
      storage: memKV(),
    })
    const out = await handle.hydrateFromCache()
    expect(out.fromCache).toBe(false)
    expect(out.value.pool).toBe(EXERCISES)
    expect(out.value.rehab).toBe(REHAB_EXERCISES)
  })

  // §7.21 — corruption: non-JSON, wrong v, wrong key, invalid-items → all seed
  it('treats non-JSON, wrong-version, wrong-key, and invalid-items envelopes as no cache', async () => {
    const cases: string[] = [
      '{not json',
      JSON.stringify({ v: 999, key: 'exercises', updatedAt: 1, items: [ex({})] }),
      JSON.stringify({ v: 1, key: 'plans', updatedAt: 1, items: [ex({})] }),
      JSON.stringify({
        v: 1,
        key: 'exercises',
        updatedAt: 1,
        items: [ex({ id: 'bad', category: 'mobility' as never })],
      }),
    ]
    for (const raw of cases) {
      const handle = createRemoteConfig(makeExercisesResource(), {
        client: null,
        storage: memKV({ [CACHE_KEY]: raw }),
      })
      const out = await handle.hydrateFromCache()
      expect(out.fromCache).toBe(false)
      expect(out.value.pool).toBe(EXERCISES)
    }
  })

  // §7.22 — re-validate on read: mixed valid/invalid cache keeps only the valid
  it('drops a cached exercise that is now invalid and keeps the valid sibling on hydrate', async () => {
    const env = JSON.stringify({
      v: 1,
      key: 'exercises',
      updatedAt: 1,
      items: [ex({ id: 'now-bad', primary: ['pecs' as never] }), ex({ id: 'still-good' })],
    })
    const handle = createRemoteConfig(makeExercisesResource(), {
      client: null,
      storage: memKV({ [CACHE_KEY]: env }),
    })
    const out = await handle.hydrateFromCache()
    expect(out.fromCache).toBe(true)
    expect(out.value.pool.some((e) => e.id === 'still-good')).toBe(true)
    expect(out.value.pool.some((e) => e.id === 'now-bad')).toBe(false)
  })

  // §7.23 — getItem throws → seed, no throw
  it('returns the seed (no throw) when storage getItem throws', async () => {
    const handle = createRemoteConfig(makeExercisesResource(), {
      client: null,
      storage: getThrowsKV(),
    })
    const out = await handle.hydrateFromCache()
    expect(out.fromCache).toBe(false)
    expect(out.value.pool).toBe(EXERCISES)
  })
})

// §7.25 — cache retention across an empty refresh
describe('exercises cache retention (offline-first)', () => {
  it('retains a good cache across an empty refresh, and hydrate still returns it', async () => {
    const env = JSON.stringify({
      v: 1,
      key: 'exercises',
      updatedAt: 1,
      items: [ex({ id: 'kept-cached', name: 'Kept' })],
    })
    const kv = memKV({ [CACHE_KEY]: env })
    const handle = createRemoteConfig(makeExercisesResource(), {
      client: fakeClient({ data: [], error: null }), // DB now empty
      storage: kv,
    })
    const res = await handle.refresh()
    expect(res.status).toBe('empty')
    expect(kv.store.get(CACHE_KEY)).toBe(env)

    const out = await handle.hydrateFromCache()
    expect(out.fromCache).toBe(true)
    expect(out.value.pool.some((e) => e.id === 'kept-cached')).toBe(true)
  })
})

// ================================================================================================
// exercisesRemote wiring: handle / fetchRemoteExercises / loadRemoteExercises / store (§7.26, §7.29)
// ================================================================================================

describe('exercisesRemoteConfig handle (production wiring exists)', () => {
  it('exposes the namespaced cache key', () => {
    expect(exercisesRemoteConfig.cacheKey).toBe(CACHE_KEY)
  })
})

describe('fetchRemoteExercises (back-compat delegating fetch)', () => {
  it('is exported and returns an array (offline → [])', async () => {
    const out = await fetchRemoteExercises()
    expect(Array.isArray(out)).toBe(true)
  })
})

describe('loadRemoteExercises end-to-end against the real (offline) wiring', () => {
  // §7.26 / §7.1 — offline: pools stay the bundled references, loaded flips true, never throws
  it('keeps the bundled pools and sets loaded:true when offline (no supabase)', async () => {
    await expect(loadRemoteExercises()).resolves.toBeUndefined()
    const state = useExercisesStore.getState()
    expect(state.loaded).toBe(true)
    expect(state.pool).toBe(EXERCISES)
    expect(state.rehab).toBe(REHAB_EXERCISES)
    // accessors are unchanged offline
    expect(getExercisePool()).toBe(EXERCISES)
    expect(getRehabPool()).toBe(REHAB_EXERCISES)
    expect(getExercise('does-not-exist')).toBeUndefined()
  })

  // §7.29 — concurrent calls leave consistent state, no duplicate pool ids
  it('is idempotent under concurrent calls (no torn pool, no duplicate ids)', async () => {
    await Promise.all([loadRemoteExercises(), loadRemoteExercises()])
    const state = useExercisesStore.getState()
    expect(state.loaded).toBe(true)
    const ids = state.pool.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// ================================================================================================
// Meta guards (§7.30 seed-script CI guard)
// ================================================================================================

describe('bundled catalogue passes the schema (seed-script CI guard, §7.30)', () => {
  it('accepts every bundled regular exercise', () => {
    for (const e of EXERCISES) {
      const res = validateExerciseRow(e)
      expect(res.ok, `${e.id} failed: ${res.ok ? '' : res.reason}`).toBe(true)
    }
  })

  it('accepts every bundled rehab exercise', () => {
    for (const e of REHAB_EXERCISES) {
      const res = validateExerciseRow(e)
      expect(res.ok, `${e.id} failed: ${res.ok ? '' : res.reason}`).toBe(true)
    }
  })
})
