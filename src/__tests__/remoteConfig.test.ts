import { describe, it, expect, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../lib/database.types'

// --- modules under test (not built yet → these imports are the TDD red state) -------------------
import {
  createRemoteConfig,
  type AsyncKV,
  type RemoteConfigResource,
} from '../lib/remoteConfig'
import {
  validatePlanRow,
  parsePlanRows,
  parseCachedPlans,
} from '../lib/planSchema'
import {
  plansRemoteConfig,
  usePlansStore,
  fetchRemotePlans,
  loadRemotePlans,
} from '../lib/plansRemote'

import {
  PLANS,
  mergeCatalogue,
  setRuntimePlans,
  getPlan,
  type WorkoutPlan,
} from '../data/plans'

// ------------------------------------------------------------------------------------------------
// Fakes: a controllable supabase client and a Map-backed AsyncKV (plus throwing variants).
// We do NOT vi.mock the supabase module — we inject fakes, matching the repo's no-mock convention.
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
// Fixtures: a known-valid plan (real exercise ids) and helpers to wrap rows as { data }.
// ------------------------------------------------------------------------------------------------

const VALID_PLAN: WorkoutPlan = {
  id: 'db-test-plan',
  name: 'DB Test Plan',
  tagline: 'a test plan',
  description: 'a plan that lives in the DB for tests',
  daysPerWeek: 3,
  goalFit: ['strength'],
  level: 'intermediate',
  equipment: 'Full gym',
  equipmentContext: 'full-gym',
  schedule: [
    {
      label: 'Day 1 · Lower',
      title: 'Lower',
      focus: ['quads', 'glutes'],
      lifts: [{ exerciseId: 'back-squat', sets: 5, repMin: 3, repMax: 5 }],
    },
  ],
}

function plan(overrides: Partial<WorkoutPlan>): WorkoutPlan {
  return { ...structuredClone(VALID_PLAN), ...overrides }
}

function row(data: unknown) {
  return { data }
}

const CACHE_KEY = 'daily-rep-remote-config:plans'

/** Build the plans resource over injected fakes, mirroring the production wiring. */
function makePlansResource(): RemoteConfigResource<WorkoutPlan, WorkoutPlan[]> {
  return {
    key: 'plans',
    table: 'plans',
    select: 'data',
    activeColumn: 'active',
    orderColumn: 'sort',
    parseRows: (rows) =>
      parsePlanRows(rows.map((r) => (r as { data: unknown }).data) as never),
    merge: (items) => mergeCatalogue(items as readonly WorkoutPlan[]),
    seed: PLANS,
    parseCache: parseCachedPlans,
  }
}

afterEach(() => {
  // restore the bundled runtime registry so other suites are unaffected
  setRuntimePlans(PLANS)
  usePlansStore.setState({ catalogue: PLANS, loaded: false, source: 'bundled' })
})

// ================================================================================================
// planSchema.validatePlanRow — structural + referential validation (spec §5 rules, §7 cases)
// ================================================================================================

describe('validatePlanRow (structural validation)', () => {
  it('accepts a fully valid plan and forces custom:false', () => {
    const res = validatePlanRow(plan({ custom: true }))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.plan.custom).toBe(false)
  })

  // §7.5
  it('rejects a non-object (null / string / number) with reason not-object', () => {
    expect(validatePlanRow(null)).toMatchObject({ ok: false, reason: 'not-object' })
    expect(validatePlanRow('nope')).toMatchObject({ ok: false, reason: 'not-object' })
    expect(validatePlanRow(42)).toMatchObject({ ok: false, reason: 'not-object' })
  })

  // §7.6
  it('rejects a missing/empty id with reason bad-id', () => {
    expect(validatePlanRow(plan({ id: '' }))).toMatchObject({ ok: false, reason: 'bad-id' })
    const noId = plan({})
    delete (noId as Partial<WorkoutPlan>).id
    expect(validatePlanRow(noId)).toMatchObject({ ok: false, reason: 'bad-id' })
  })

  // §7.7
  it('rejects a missing/empty name with reason bad-name', () => {
    expect(validatePlanRow(plan({ name: '' }))).toMatchObject({ ok: false, reason: 'bad-name' })
  })

  // §7.8
  it('rejects an empty/absent schedule with reason empty-schedule', () => {
    expect(validatePlanRow(plan({ schedule: [] }))).toMatchObject({
      ok: false,
      reason: 'empty-schedule',
    })
  })

  // §7.9
  it('rejects a plan whose day has empty focus with reason bad-day', () => {
    const bad = plan({
      schedule: [{ label: 'D', title: 'D', focus: [], lifts: [] }],
    })
    expect(validatePlanRow(bad)).toMatchObject({ ok: false, reason: 'bad-day' })
  })

  // §7.11
  it('rejects an out-of-union level enum with reason bad-enum', () => {
    expect(validatePlanRow(plan({ level: 'pro' as never }))).toMatchObject({
      ok: false,
      reason: 'bad-enum',
    })
  })

  // §7.11 (equipment + goalFit + equipmentContext)
  it('rejects out-of-union equipment, goalFit member, and equipmentContext with bad-enum', () => {
    expect(validatePlanRow(plan({ equipment: 'Home' as never }))).toMatchObject({
      ok: false,
      reason: 'bad-enum',
    })
    expect(validatePlanRow(plan({ goalFit: ['toning' as never] }))).toMatchObject({
      ok: false,
      reason: 'bad-enum',
    })
    expect(
      validatePlanRow(plan({ equipmentContext: 'spaceship' as never })),
    ).toMatchObject({ ok: false, reason: 'bad-enum' })
  })
})

describe('validatePlanRow (referential integrity)', () => {
  // §7.10
  it('rejects the WHOLE plan when any lift references an unknown exercise id', () => {
    const bad = plan({
      schedule: [
        {
          label: 'D',
          title: 'D',
          focus: ['quads'],
          lifts: [{ exerciseId: 'not-a-real-exercise', sets: 3, repMin: 5, repMax: 5 }],
        },
      ],
    })
    const res = validatePlanRow(bad)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('unknown-exercise')
      expect(res.detail).toBe('not-a-real-exercise')
    }
  })

  // §7.24 — referential check uses getExercise, so a rehab id is a VALID lift id
  it('accepts a plan referencing a valid rehab exercise id (getExercise resolves via REHAB_BY_ID)', () => {
    const withRehab = plan({
      id: 'rehab-using-plan',
      schedule: [
        {
          label: 'Rehab',
          title: 'Rehab',
          focus: ['neck'],
          lifts: [{ exerciseId: 'rehab-chin-tuck', sets: 2, repMin: 8, repMax: 12 }],
        },
      ],
    })
    expect(validatePlanRow(withRehab).ok).toBe(true)
  })

  // §7.21 — a focus-only day with lifts:[] is valid
  it('accepts a day with an empty lifts array (focus-only generation)', () => {
    const focusOnly = plan({
      schedule: [{ label: 'D', title: 'D', focus: ['chest'], lifts: [] }],
    })
    expect(focusOnly && validatePlanRow(focusOnly).ok).toBe(true)
  })

  // a day with NO lifts key at all is also valid (focus-only)
  it('accepts a day with no lifts key (focus-based)', () => {
    const focusOnly = plan({
      schedule: [{ label: 'D', title: 'D', focus: ['chest'] }],
    })
    expect(validatePlanRow(focusOnly).ok).toBe(true)
  })
})

describe('validatePlanRow (numeric clamping — recoverable noise, not rejection)', () => {
  // §7.20
  it('clamps absurd sets to 1..10 and swaps reps so repMin <= repMax', () => {
    const noisy = plan({
      schedule: [
        {
          label: 'D',
          title: 'D',
          focus: ['quads'],
          lifts: [{ exerciseId: 'back-squat', sets: 0, repMin: 8, repMax: 3 }],
        },
      ],
    })
    const res = validatePlanRow(noisy)
    expect(res.ok).toBe(true)
    if (res.ok) {
      const lift = res.plan.schedule[0].lifts![0]
      expect(lift.sets).toBe(1)
      expect(lift.repMin).toBe(3)
      expect(lift.repMax).toBe(8)
    }
  })

  it('clamps an over-large set count down to 10 and reps to 50', () => {
    const noisy = plan({
      schedule: [
        {
          label: 'D',
          title: 'D',
          focus: ['quads'],
          lifts: [{ exerciseId: 'back-squat', sets: 999, repMin: 1, repMax: 200 }],
        },
      ],
    })
    const res = validatePlanRow(noisy)
    expect(res.ok).toBe(true)
    if (res.ok) {
      const lift = res.plan.schedule[0].lifts![0]
      expect(lift.sets).toBe(10)
      expect(lift.repMax).toBe(50)
    }
  })
})

// §7.25 — meta guard: every bundled plan passes the schema (seed-script precondition)
describe('validatePlanRow over the bundled catalogue (seed precondition / CI guard)', () => {
  it('accepts every bundled PLAN (no dangling exercise id, no bad enum)', () => {
    for (const p of PLANS) {
      const res = validatePlanRow(p)
      expect(res.ok, `${p.id} failed: ${res.ok ? '' : res.reason}`).toBe(true)
    }
  })
})

// ================================================================================================
// parsePlanRows — batch: drop-and-count invalid rows
// ================================================================================================

describe('parsePlanRows (drop invalid, count, keep valid)', () => {
  // §7.5
  it('drops a non-object row and keeps a sibling valid plan', () => {
    const { items, dropped } = parsePlanRows([null, plan({})] as never)
    expect(items.length).toBe(1)
    expect(dropped).toBe(1)
    expect(items[0].id).toBe('db-test-plan')
  })

  // §7.10 — a partially-bad plan is dropped whole; a sibling valid plan still applies
  it('drops a plan with an unknown exercise id but still applies a sibling valid plan', () => {
    const badRef = plan({
      id: 'bad-ref',
      schedule: [
        {
          label: 'D',
          title: 'D',
          focus: ['quads'],
          lifts: [{ exerciseId: 'ghost-exercise', sets: 3, repMin: 5, repMax: 5 }],
        },
      ],
    })
    const good = plan({ id: 'good-plan' })
    const { items, dropped } = parsePlanRows([badRef, good] as never)
    expect(dropped).toBe(1)
    expect(items.map((p) => p.id)).toEqual(['good-plan'])
  })

  it('invokes onReject with the typed reason for each dropped row', () => {
    const reasons: string[] = []
    parsePlanRows([null, plan({ name: '' })] as never, {
      onReject: (r) => reasons.push(r.reason),
    })
    expect(reasons).toContain('not-object')
    expect(reasons).toContain('bad-name')
  })
})

// ================================================================================================
// parseCachedPlans — untrusted cache re-validation (§7.14)
// ================================================================================================

describe('parseCachedPlans (cache is untrusted: re-validate on read)', () => {
  it('returns null for a non-array payload', () => {
    expect(parseCachedPlans({})).toBeNull()
    expect(parseCachedPlans('nope')).toBeNull()
    expect(parseCachedPlans(null)).toBeNull()
  })

  // §7.14 — a stale cached plan referencing a since-removed exercise id is dropped on read
  it('drops a cached plan whose exercise id no longer resolves', () => {
    const stale = plan({
      id: 'stale',
      schedule: [
        {
          label: 'D',
          title: 'D',
          focus: ['quads'],
          lifts: [{ exerciseId: 'removed-since', sets: 3, repMin: 5, repMax: 5 }],
        },
      ],
    })
    const good = plan({ id: 'cached-good' })
    const out = parseCachedPlans([stale, good])
    expect(out).not.toBeNull()
    expect(out!.map((p) => p.id)).toEqual(['cached-good'])
  })

  it('returns the valid items for an all-valid cache payload', () => {
    const out = parseCachedPlans([plan({ id: 'c1' }), plan({ id: 'c2' })])
    expect(out!.map((p) => p.id)).toEqual(['c1', 'c2'])
  })
})

// ================================================================================================
// createRemoteConfig.refresh — fetch → validate → merge → cache
// ================================================================================================

describe('createRemoteConfig.refresh (happy path)', () => {
  it('applies 2 valid rows (override + new id), merges, and writes a v:1 cache envelope', async () => {
    const override = plan({ id: PLANS[0].id, name: `${PLANS[0].name} (DB)` })
    const novel = plan({ id: 'db-only-novel', name: 'Novel DB Plan' })
    const kv = memKV()
    const handle = createRemoteConfig(makePlansResource(), {
      client: fakeClient({ data: [row(override), row(novel)], error: null }),
      storage: kv,
      now: () => 1700000000000,
    })

    const res = await handle.refresh()
    expect(res.status).toBe('applied')
    if (res.status === 'applied') {
      expect(res.rowCount).toBe(2)
      expect(res.dropped).toBe(0)
      // override wins for the bundled id
      expect(res.value.find((p) => p.id === PLANS[0].id)!.name).toBe(`${PLANS[0].name} (DB)`)
      // remote-only appended
      expect(res.value.find((p) => p.id === 'db-only-novel')).toBeDefined()
      expect(res.value.length).toBe(PLANS.length + 1)
    }

    // cache envelope written under the namespaced key with v:1
    const raw = kv.store.get(CACHE_KEY)
    expect(raw).toBeTruthy()
    const env = JSON.parse(raw!)
    expect(env.v).toBe(1)
    expect(env.key).toBe('plans')
    expect(env.updatedAt).toBe(1700000000000)
  })

  // §7.5 — refresh counts dropped rows but applies the valid ones
  it('drops a malformed row and reports dropped count while applying valid rows', async () => {
    const handle = createRemoteConfig(makePlansResource(), {
      client: fakeClient({ data: [row(null), row(plan({ id: 'survivor' }))], error: null }),
      storage: memKV(),
    })
    const res = await handle.refresh()
    expect(res.status).toBe('applied')
    if (res.status === 'applied') {
      expect(res.dropped).toBe(1)
      expect(res.value.find((p) => p.id === 'survivor')).toBeDefined()
    }
  })
})

describe('createRemoteConfig.refresh (degradation / edge cases)', () => {
  // §7.1 — no client
  it('returns unavailable (and keeps seed) when there is no supabase client', async () => {
    const kv = memKV()
    const handle = createRemoteConfig(makePlansResource(), { client: null, storage: kv })
    const res = await handle.refresh()
    expect(res.status).toBe('unavailable')
    expect(res.value).toBe(PLANS) // seed reference retained
    expect(kv.store.has(CACHE_KEY)).toBe(false)
  })

  // §7.2 — network throws
  it('returns unavailable when the query throws (network reject) and leaves cache untouched', async () => {
    const seeded = {
      [CACHE_KEY]: JSON.stringify({
        v: 1,
        key: 'plans',
        updatedAt: 1,
        items: [plan({ id: 'cached' })],
      }),
    }
    const kv = memKV(seeded)
    const handle = createRemoteConfig(makePlansResource(), {
      client: throwingClient(),
      storage: kv,
    })
    const res = await handle.refresh()
    expect(res.status).toBe('unavailable')
    expect(kv.store.get(CACHE_KEY)).toBe(seeded[CACHE_KEY]) // unchanged
  })

  // §7.3 — query returns { error }
  it('returns unavailable when the query resolves with an error', async () => {
    const handle = createRemoteConfig(makePlansResource(), {
      client: fakeClient({ data: null, error: { message: 'RLS denied' } }),
      storage: memKV(),
    })
    const res = await handle.refresh()
    expect(res.status).toBe('unavailable')
  })

  // §7.4 — empty DB
  it('returns empty (and the seed reference) for 0 rows, without touching the cache', async () => {
    const kv = memKV()
    const handle = createRemoteConfig(makePlansResource(), {
      client: fakeClient({ data: [], error: null }),
      storage: kv,
    })
    const res = await handle.refresh()
    expect(res.status).toBe('empty')
    expect(res.value).toBe(PLANS) // mergeCatalogue([]) === PLANS reference
    expect(kv.store.has(CACHE_KEY)).toBe(false)
  })

  // §7.16 — storage setItem throws but refresh still applies the live value
  it('still returns applied when the cache write throws (best-effort cache)', async () => {
    const handle = createRemoteConfig(makePlansResource(), {
      client: fakeClient({ data: [row(plan({ id: 'live-1' }))], error: null }),
      storage: setThrowsKV(),
    })
    const res = await handle.refresh()
    expect(res.status).toBe('applied')
    if (res.status === 'applied') {
      expect(res.value.find((p) => p.id === 'live-1')).toBeDefined()
    }
  })
})

// ================================================================================================
// createRemoteConfig.hydrateFromCache — cache-first read (§7.13, §7.15)
// ================================================================================================

describe('createRemoteConfig.hydrateFromCache (cache hit / miss / corruption)', () => {
  it('returns the merged cached value with fromCache:true without touching the client', async () => {
    const spy = { fromCalls: 0 }
    const env = JSON.stringify({
      v: 1,
      key: 'plans',
      updatedAt: 1,
      items: [plan({ id: 'db-only-cached', name: 'Cached Plan' })],
    })
    const handle = createRemoteConfig(makePlansResource(), {
      client: fakeClient({ data: [], error: null }, spy),
      storage: memKV({ [CACHE_KEY]: env }),
    })
    const out = await handle.hydrateFromCache()
    expect(out.fromCache).toBe(true)
    expect(out.value.find((p) => p.id === 'db-only-cached')).toBeDefined()
    expect(spy.fromCalls).toBe(0) // hydrate never hits the network
  })

  it('returns seed with fromCache:false on a cache miss (no key)', async () => {
    const handle = createRemoteConfig(makePlansResource(), {
      client: null,
      storage: memKV(),
    })
    const out = await handle.hydrateFromCache()
    expect(out.fromCache).toBe(false)
    expect(out.value).toBe(PLANS)
  })

  // §7.13 — corruption: non-JSON, wrong v, wrong key, parseCache→null all → seed
  it('treats non-JSON, wrong-version, wrong-key, and invalid-items envelopes as no cache', async () => {
    const cases: string[] = [
      '{not json',
      JSON.stringify({ v: 999, key: 'plans', updatedAt: 1, items: [plan({})] }),
      JSON.stringify({ v: 1, key: 'equipment', updatedAt: 1, items: [plan({})] }),
      JSON.stringify({
        v: 1,
        key: 'plans',
        updatedAt: 1,
        items: [
          plan({
            id: 'bad',
            schedule: [
              {
                label: 'D',
                title: 'D',
                focus: ['quads'],
                lifts: [{ exerciseId: 'ghost', sets: 3, repMin: 5, repMax: 5 }],
              },
            ],
          }),
        ],
      }),
    ]
    for (const raw of cases) {
      const handle = createRemoteConfig(makePlansResource(), {
        client: null,
        storage: memKV({ [CACHE_KEY]: raw }),
      })
      const out = await handle.hydrateFromCache()
      expect(out.fromCache).toBe(false)
      expect(out.value).toBe(PLANS)
    }
  })

  // §7.15 — storage getItem throws → seed, no throw
  it('returns seed (no throw) when storage getItem throws', async () => {
    const handle = createRemoteConfig(makePlansResource(), {
      client: null,
      storage: getThrowsKV(),
    })
    const out = await handle.hydrateFromCache()
    expect(out.fromCache).toBe(false)
    expect(out.value).toBe(PLANS)
  })
})

// §7.12 — cache retained when a later refresh goes empty/unavailable
describe('createRemoteConfig cache retention (offline-first)', () => {
  it('retains a good cache across an empty refresh, and hydrate still returns it', async () => {
    const env = JSON.stringify({
      v: 1,
      key: 'plans',
      updatedAt: 1,
      items: [plan({ id: 'kept-cached', name: 'Kept' })],
    })
    const kv = memKV({ [CACHE_KEY]: env })
    const handle = createRemoteConfig(makePlansResource(), {
      client: fakeClient({ data: [], error: null }), // DB now empty
      storage: kv,
    })
    const res = await handle.refresh()
    expect(res.status).toBe('empty')
    expect(kv.store.get(CACHE_KEY)).toBe(env) // untouched

    const out = await handle.hydrateFromCache()
    expect(out.fromCache).toBe(true)
    expect(out.value.find((p) => p.id === 'kept-cached')).toBeDefined()
  })
})

// ================================================================================================
// merge semantics through the layer (§7.17 / §7.18 / §7.19)
// ================================================================================================

describe('merge semantics through refresh (override / append / dedupe)', () => {
  // §7.17
  it('a validated remote plan overrides the bundled plan of the same id', async () => {
    const override = plan({ id: PLANS[0].id, name: 'OVERRIDDEN' })
    const handle = createRemoteConfig(makePlansResource(), {
      client: fakeClient({ data: [row(override)], error: null }),
      storage: memKV(),
    })
    const res = await handle.refresh()
    if (res.status === 'applied') {
      const merged = res.value.find((p) => p.id === PLANS[0].id)!
      expect(merged.name).toBe('OVERRIDDEN')
      expect(merged.custom).toBe(false)
    } else {
      throw new Error(`expected applied, got ${res.status}`)
    }
  })

  // §7.18
  it('a remote-only plan is appended and resolves once setRuntimePlans runs', async () => {
    const novel = plan({ id: 'db-only-resolvable', name: 'Resolvable' })
    const handle = createRemoteConfig(makePlansResource(), {
      client: fakeClient({ data: [row(novel)], error: null }),
      storage: memKV(),
    })
    const res = await handle.refresh()
    if (res.status !== 'applied') throw new Error('expected applied')
    setRuntimePlans(res.value)
    expect(getPlan('db-only-resolvable')!.name).toBe('Resolvable')
  })

  // §7.19
  it('dedupes duplicate ids in the DB result (no duplicate id in the merged catalogue)', async () => {
    const a = plan({ id: 'dupe', name: 'first' })
    const b = plan({ id: 'dupe', name: 'second' })
    const handle = createRemoteConfig(makePlansResource(), {
      client: fakeClient({ data: [row(a), row(b)], error: null }),
      storage: memKV(),
    })
    const res = await handle.refresh()
    if (res.status !== 'applied') throw new Error('expected applied')
    const ids = res.value.map((p) => p.id)
    expect(ids.filter((id) => id === 'dupe').length).toBe(1)
  })
})

// ================================================================================================
// plansRemote wiring: fetchRemotePlans / loadRemotePlans / store (§7.1, §7.22, §7.23)
// ================================================================================================

describe('plansRemoteConfig handle (production wiring exists)', () => {
  it('exposes the namespaced cache key', () => {
    expect(plansRemoteConfig.cacheKey).toBe(CACHE_KEY)
  })
})

describe('fetchRemotePlans (back-compat delegating fetch)', () => {
  it('is exported and returns an array', async () => {
    const out = await fetchRemotePlans()
    expect(Array.isArray(out)).toBe(true)
  })
})

describe('loadRemotePlans end-to-end against the real (offline) wiring', () => {
  // §7.1 / §7.23 — offline: no client → catalogue stays bundled, loaded flips true, never throws
  it('keeps the bundled catalogue and sets loaded:true when offline (no supabase)', async () => {
    await expect(loadRemotePlans()).resolves.toBeUndefined()
    const state = usePlansStore.getState()
    expect(state.loaded).toBe(true)
    expect(state.catalogue).toBe(PLANS)
  })

  // §7.22 — concurrent calls leave consistent state
  it('is idempotent under concurrent calls (no torn catalogue)', async () => {
    await Promise.all([loadRemotePlans(), loadRemotePlans()])
    const state = usePlansStore.getState()
    expect(state.loaded).toBe(true)
    expect(Array.isArray(state.catalogue)).toBe(true)
    // no duplicate ids in the resulting catalogue
    const ids = state.catalogue.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
