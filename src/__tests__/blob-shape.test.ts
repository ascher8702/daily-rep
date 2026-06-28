import { describe, it, expect, beforeEach } from 'vitest'
import {
  useStore,
  mergePersisted,
  partializeState,
  readSchemaVersion,
  migratePersisted,
  BLOB_SCHEMA_VERSION,
  type AppState,
} from '../store/useStore'
import type { WorkoutPlan } from '../data/plans'
import { fullGymProfile } from './fixtures'

/**
 * Item A (in-blob schemaVersion + migratePersisted switch) and Item B (deletedPlanIds tombstone
 * reserve). Pure store/merge helpers, mirroring sync-merge.test.ts's injected-`base()` style. The
 * RISKIEST assertion (§7.15: deletedPlanIds is reserve-only and NOT unioned across sides — the
 * deliberate asymmetry vs deletedWorkoutIds) is pinned explicitly.
 */

// A live AppState mirroring sync-merge.test.ts's base(), plus the new deletedPlanIds reserve key so a
// test can populate the local/adopt side. Cast through unknown because we omit the action functions.
const base = (over: Partial<AppState> = {}): AppState =>
  ({
    profile: { ...fullGymProfile },
    workouts: [],
    deletedWorkoutIds: [],
    deletedPlanIds: [],
    current: null,
    activePlan: null,
    restEndsAt: null,
    restDuration: 0,
    customPlans: [],
    planProgress: {},
    planOverrides: {},
    planDayEdits: {},
    ...over,
  }) as unknown as AppState

// A minimal valid custom plan (id + non-empty schedule with focus[]) so mergePersisted/deleteCustomPlan
// accept it — mirrors store.test.ts:customPlan().
function customPlan(id: string): WorkoutPlan {
  return {
    id,
    name: 'My Plan',
    tagline: 't',
    description: 'd',
    daysPerWeek: 1,
    daysPerWeekOptions: [1],
    goalFit: ['strength'],
    level: 'intermediate',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    custom: true,
    schedule: [
      {
        label: 'Day 1',
        title: 'Day 1',
        focus: ['chest'],
        goal: 'strength',
        lifts: [{ exerciseId: 'barbell-bench-press', sets: 5, repMin: 5, repMax: 5 }],
      },
    ],
  }
}

beforeEach(() => {
  useStore.setState({
    profile: { ...fullGymProfile, unit: 'lb' },
    workouts: [],
    deletedWorkoutIds: [],
    deletedPlanIds: [],
    current: null,
    activePlan: null,
    restEndsAt: null,
    restDuration: 0,
    customPlans: [],
    planProgress: {},
    planOverrides: {},
    planDayEdits: {},
  })
})

// ---------------------------------------------------------------------------
// A. schemaVersion in the blob — partializeState + readSchemaVersion
// ---------------------------------------------------------------------------
describe('A. partializeState stamps schemaVersion + deletedPlanIds', () => {
  it('§7.1 emits schemaVersion === 1 and deletedPlanIds === [] on default state', () => {
    expect(BLOB_SCHEMA_VERSION).toBe(1)
    const snap = partializeState(useStore.getState()) as Record<string, unknown>
    expect(snap.schemaVersion).toBe(1)
    expect(snap.deletedPlanIds).toEqual([])
    expect(Object.keys(snap)).toContain('schemaVersion')
    expect(Object.keys(snap)).toContain('deletedPlanIds')
  })

  it('§7.2 round-trips schemaVersion:1 and deletedPlanIds through JSON.stringify/parse', () => {
    const out = partializeState(base({ deletedPlanIds: ['p1'] })) as Record<string, unknown>
    expect(out.schemaVersion).toBe(1)
    expect(out.deletedPlanIds).toEqual(['p1'])
    const parsed = JSON.parse(JSON.stringify(out)) as Record<string, unknown>
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.deletedPlanIds).toEqual(['p1'])
  })
})

describe('A. readSchemaVersion (discriminator off an incoming blob)', () => {
  it('§7.3 a versioned blob → its number', () => {
    expect(readSchemaVersion({ schemaVersion: 1, workouts: [] })).toBe(1)
  })

  it('§7.4 a legacy version-LESS blob (missing field) → 1', () => {
    expect(readSchemaVersion({})).toBe(1)
    expect(readSchemaVersion({ workouts: [] })).toBe(1)
  })

  it('§7.5 null / undefined → 1 (no throw)', () => {
    expect(readSchemaVersion(null)).toBe(1)
    expect(readSchemaVersion(undefined)).toBe(1)
  })

  it('§7.6 a non-number / non-finite value → 1; a real future number passes through', () => {
    expect(readSchemaVersion({ schemaVersion: '1' })).toBe(1) // string, not a number
    expect(readSchemaVersion({ schemaVersion: NaN })).toBe(1)
    expect(readSchemaVersion({ schemaVersion: Infinity })).toBe(1)
    expect(readSchemaVersion({ schemaVersion: 2 })).toBe(2) // a real number passes through
  })
})

// ---------------------------------------------------------------------------
// A. migratePersisted — the real version switch (identity v1, identity default; NEVER a reset)
// ---------------------------------------------------------------------------
describe('A. migratePersisted (version switch skeleton)', () => {
  it('§7.7 case 1 is identity (returns the same blob reference)', () => {
    const blob = { workouts: [{ id: 'a' }], schemaVersion: 1 }
    expect(migratePersisted(blob, 1)).toBe(blob)
  })

  it('§7.8 default branch (unknown older/newer version) passes the blob through untouched — never drops data', () => {
    const blob = { workouts: [{ id: 'a' }] }
    expect(migratePersisted(blob, 0)).toBe(blob)
    expect(migratePersisted(blob, 99)).toBe(blob)
    // crucially the default is NOT a reset/drop: never undefined/null/{}
    expect(migratePersisted(blob, 99)).not.toBeUndefined()
    expect(migratePersisted(blob, 99)).not.toBeNull()
    expect(migratePersisted(blob, 99)).toEqual(blob)
  })
})

// ---------------------------------------------------------------------------
// A. mergePersisted reads the version but stays byte-identical at v1 / version-less
// ---------------------------------------------------------------------------
describe('A. mergePersisted is inert at v1 (the seam exists but does not change behaviour yet)', () => {
  it('§7.9 a version-LESS blob merges exactly like today (treated as v1)', () => {
    const versionless = mergePersisted({ profile: { ...fullGymProfile, name: 'X' } }, base())
    const withV1 = mergePersisted({ schemaVersion: 1, profile: { ...fullGymProfile, name: 'X' } }, base())
    expect(versionless.profile.name).toBe(withV1.profile.name)
    expect(versionless.workouts).toEqual(withV1.workouts)
  })

  it('§7.10 schemaVersion:1 is inert — same merged result as the same blob without the field', () => {
    const blob = { deletedPlanIds: ['p9'], workouts: [] }
    const a = mergePersisted(blob, base())
    const b = mergePersisted({ ...blob, schemaVersion: 1 }, base())
    expect(a.deletedPlanIds).toEqual(b.deletedPlanIds)
    // mergePersisted does not store the discriminator on the merged AppState (it's blob-only metadata)
    expect((b as unknown as Record<string, unknown>).schemaVersion).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// B. deletedPlanIds — sanitize in mergePersisted (reserve-only, NO union)
// ---------------------------------------------------------------------------
describe('B. mergePersisted sanitizes deletedPlanIds (reserve-only, no cross-device union)', () => {
  it('§7.11 a clean array passes through (sanitized, not unioned)', () => {
    const merged = mergePersisted({ deletedPlanIds: ['p1', 'p2'] }, base())
    expect(merged.deletedPlanIds).toEqual(['p1', 'p2'])
  })

  it('§7.12 non-array garbage → [] (no throw)', () => {
    const merged = mergePersisted({ deletedPlanIds: 'nope' as unknown as string[] }, base())
    expect(merged.deletedPlanIds).toEqual([])
  })

  it('§7.13 a mixed array keeps only the string entries (via asStringArray)', () => {
    const merged = mergePersisted(
      { deletedPlanIds: [1, null, 'p1', {}] as unknown as string[] },
      base(),
    )
    expect(merged.deletedPlanIds).toEqual(['p1'])
  })

  it('§7.14 a missing key reads as [] (back-compat)', () => {
    const merged = mergePersisted({}, base())
    expect(merged.deletedPlanIds).toEqual([])
  })

  it('§7.15 RESERVE-ONLY ASYMMETRY: the blob side wins, NOT unioned with current (unlike deletedWorkoutIds)', () => {
    const merged = mergePersisted(
      { deletedPlanIds: ['p1'] },
      base({ deletedPlanIds: ['p2'] }),
    )
    // The riskiest edge: deletedPlanIds is reserve-only, so the result is the sanitized BLOB side
    // (['p1']) — explicitly NOT the union ['p1','p2'] that deletedWorkoutIds would produce.
    expect(merged.deletedPlanIds).toEqual(['p1'])
    expect(merged.deletedPlanIds).not.toContain('p2')

    // Contrast guard: deletedWorkoutIds in the SAME merge IS unioned across both sides.
    const mergedWk = mergePersisted(
      { deletedWorkoutIds: ['w1'] },
      base({ deletedWorkoutIds: ['w2'] }),
    )
    expect([...mergedWk.deletedWorkoutIds].sort()).toEqual(['w1', 'w2'])
  })
})

// ---------------------------------------------------------------------------
// B. deleteCustomPlan records the tombstone (de-duped), preserving existing prune behaviour
// ---------------------------------------------------------------------------
describe('B. deleteCustomPlan records the deleted id in deletedPlanIds', () => {
  it('§7.16 removes the plan from customPlans AND records its id', () => {
    useStore.getState().addCustomPlan(customPlan('p1'))
    expect(useStore.getState().customPlans.map((p) => p.id)).toContain('p1')
    useStore.getState().deleteCustomPlan('p1')
    expect(useStore.getState().customPlans.map((p) => p.id)).not.toContain('p1')
    expect(useStore.getState().deletedPlanIds).toEqual(['p1'])
  })

  it('§7.17 deleting the same id twice records it exactly once (de-duped)', () => {
    useStore.getState().addCustomPlan(customPlan('p1'))
    useStore.getState().deleteCustomPlan('p1')
    useStore.getState().deleteCustomPlan('p1')
    expect(useStore.getState().deletedPlanIds).toEqual(['p1'])
  })

  it('§7.18 deleting an unknown (ghost) id still records it once; existing plans unchanged', () => {
    useStore.getState().addCustomPlan(customPlan('keep'))
    useStore.getState().deleteCustomPlan('ghost')
    expect(useStore.getState().deletedPlanIds).toEqual(['ghost'])
    expect(useStore.getState().customPlans.map((p) => p.id)).toEqual(['keep'])
  })

  it('§7.19 deleting the ACTIVE plan nulls activePlan AND records the tombstone', () => {
    useStore.getState().addCustomPlan(customPlan('p1'))
    useStore.getState().startPlan('p1')
    expect(useStore.getState().activePlan?.planId).toBe('p1')
    useStore.getState().deleteCustomPlan('p1')
    expect(useStore.getState().activePlan).toBeNull()
    expect(useStore.getState().deletedPlanIds).toEqual(['p1'])
  })
})

// ---------------------------------------------------------------------------
// B. resetAll / loadSampleData clear the reserve to a clean slate
// ---------------------------------------------------------------------------
describe('B. resetAll / loadSampleData clear deletedPlanIds', () => {
  it('§7.20 resetAll() → deletedPlanIds === []', () => {
    useStore.setState({ deletedPlanIds: ['p1', 'p2'] })
    useStore.getState().resetAll()
    expect(useStore.getState().deletedPlanIds).toEqual([])
  })

  it('§7.21 loadSampleData() → deletedPlanIds === []', () => {
    useStore.setState({ deletedPlanIds: ['p1'] })
    useStore.getState().loadSampleData()
    expect(useStore.getState().deletedPlanIds).toEqual([])
  })
})
