import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  useStore,
  mergePersisted,
  partializeState,
  unionWorkouts,
  unionIds,
  type AppState,
} from '../store/useStore'
import { newWorkoutId } from '../lib/format'
import { clockAfterAdopt } from '../lib/sync'
import { subscribeToast, type ToastData } from '../lib/toast'
import type { Workout } from '../types'
import { fullGymProfile } from './fixtures'

// A minimal, well-formed completed workout. `over` lets a test set ids/dates/completedAt literally.
function wk(id: string, over: Partial<Workout> = {}): Workout {
  return {
    id,
    date: 1,
    status: 'completed',
    title: id,
    focus: [],
    completedAt: 1,
    exercises: [
      { exerciseId: 'barbell-bench-press', targetReps: [8, 12], sets: [{ id: 'a', weight: 135, reps: 8, done: true }] },
    ],
    ...over,
  }
}

// A live AppState — mirrors store.test.ts's base(), plus the new tombstone key so `current` can be
// the populated adopt-side too. Cast through unknown because we omit the action functions.
const base = (over: Partial<AppState> = {}): AppState =>
  ({
    profile: { ...fullGymProfile },
    workouts: [],
    deletedWorkoutIds: [],
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

beforeEach(() => {
  vi.unstubAllGlobals()
  useStore.setState({
    profile: { ...fullGymProfile, unit: 'lb' },
    workouts: [],
    deletedWorkoutIds: [],
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
// §7.1, §7.5, §7.6, §7.7, §7.20 — unionWorkouts(a, b, tombstoned)
// ---------------------------------------------------------------------------
describe('unionWorkouts — keeps ids on either side, deterministic LWW on collision', () => {
  it('§7.1 keeps BOTH sides when ids are distinct (the data-loss fix), a-first order', () => {
    expect(unionWorkouts([wk('a')], [wk('b')]).map((w) => w.id)).toEqual(['a', 'b'])
  })

  it('§7.20 both sides empty → []', () => {
    expect(unionWorkouts([], [])).toEqual([])
  })

  it('§7.5 collision: newer completedAt wins (length 1)', () => {
    const out = unionWorkouts([wk('x', { completedAt: 100 })], [wk('x', { completedAt: 200 })])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('x')
    expect(out[0].completedAt).toBe(200)
  })

  it('§7.5 collision: a-side newer completedAt still wins regardless of arg position', () => {
    const out = unionWorkouts([wk('x', { completedAt: 300 })], [wk('x', { completedAt: 200 })])
    expect(out).toHaveLength(1)
    expect(out[0].completedAt).toBe(300)
  })

  it('§7.6 collision tie (equal completedAt) → keeps the a-side instance deterministically', () => {
    // tag the two instances so we can tell which survived
    const aSide = wk('x', { completedAt: 150, title: 'A-SIDE' })
    const bSide = wk('x', { completedAt: 150, title: 'B-SIDE' })
    const out = unionWorkouts([aSide], [bSide])
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('A-SIDE')
  })

  it('§7.7 collision falls back to date when completedAt is absent → larger date wins', () => {
    const out = unionWorkouts(
      [wk('x', { completedAt: undefined, date: 50 })],
      [wk('x', { completedAt: undefined, date: 80 })],
    )
    expect(out).toHaveLength(1)
    expect(out[0].date).toBe(80)
  })

  it('§7.10 subtracts a tombstoned id present on either side', () => {
    expect(unionWorkouts([wk('a')], [wk('b')], ['b']).map((w) => w.id)).toEqual(['a'])
    expect(unionWorkouts([wk('a')], [wk('b')], ['a']).map((w) => w.id)).toEqual(['b'])
  })
})

// ---------------------------------------------------------------------------
// §5 — unionIds(a, b)
// ---------------------------------------------------------------------------
describe('unionIds — de-duped, order-stable a-first tombstone union', () => {
  it('§7.9 unions two id sets de-duped, a-first', () => {
    expect(unionIds(['x'], ['y'])).toEqual(['x', 'y'])
    expect(unionIds(['x', 'y'], ['y', 'z'])).toEqual(['x', 'y', 'z'])
  })

  it('does not duplicate an id listed on both sides', () => {
    expect(unionIds(['x'], ['x'])).toEqual(['x'])
  })

  it('treats undefined inputs as empty', () => {
    expect(unionIds(undefined, ['y'])).toEqual(['y'])
    expect(unionIds(['x'], undefined)).toEqual(['x'])
    expect(unionIds(undefined, undefined)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// §7.2, §7.3, §7.4 — mergePersisted union at BOTH call sites
// ---------------------------------------------------------------------------
describe('mergePersisted unions workouts at both call sites', () => {
  it('§7.2 ADOPT keeps a local-only workout (the data-loss regression test)', () => {
    const merged = mergePersisted({ workouts: [wk('cloud')] }, base({ workouts: [wk('local')] }))
    expect(merged.workouts.map((w) => w.id).sort()).toEqual(['cloud', 'local'])
  })

  it('§7.4 ADOPT: cloud [A], local [A,B] → A and B both survive', () => {
    const merged = mergePersisted(
      { workouts: [wk('A')] },
      base({ workouts: [wk('A'), wk('B')] }),
    )
    expect(merged.workouts.map((w) => w.id).sort()).toEqual(['A', 'B'])
  })

  it('§7.3 HYDRATION (empty current) is byte-identical to the pre-fix wholesale take', () => {
    const merged = mergePersisted({ workouts: [wk('a'), wk('b')] }, base())
    // cloud/persisted side is passed as `a`, so an empty local makes the union an identity over it
    expect(merged.workouts).toEqual([wk('a'), wk('b')])
  })

  it('§7.5 ADOPT collision keeps the newer completedAt instance', () => {
    const merged = mergePersisted(
      { workouts: [wk('x', { completedAt: 200 })] },
      base({ workouts: [wk('x', { completedAt: 100 })] }),
    )
    const x = merged.workouts.filter((w) => w.id === 'x')
    expect(x).toHaveLength(1)
    expect(x[0].completedAt).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// §7.8, §7.9, §7.10, §7.18, §7.19 — tombstone subtraction + merge in mergePersisted
// ---------------------------------------------------------------------------
describe('mergePersisted tombstone subtraction and merge', () => {
  it('§7.8 delete-then-merge does NOT resurrect, and remembers the tombstone', () => {
    useStore.setState(base({ workouts: [wk('a'), wk('b')] }))
    useStore.getState().deleteWorkout('b')
    expect(useStore.getState().workouts.map((w) => w.id)).toEqual(['a'])

    // a stale cloud blob still carrying B must NOT bring it back
    const merged = mergePersisted({ workouts: [wk('a'), wk('b')] }, useStore.getState())
    expect(merged.workouts.map((w) => w.id)).toEqual(['a'])
    expect(merged.deletedWorkoutIds).toContain('b')
  })

  it('§7.9 tombstone merges (union, de-duped) across devices', () => {
    const merged = mergePersisted({ deletedWorkoutIds: ['x'] }, base({ deletedWorkoutIds: ['y'] }))
    expect([...merged.deletedWorkoutIds].sort()).toEqual(['x', 'y'])
    // no duplication when both list the same id
    const dedup = mergePersisted({ deletedWorkoutIds: ['x'] }, base({ deletedWorkoutIds: ['x'] }))
    expect(dedup.deletedWorkoutIds).toEqual(['x'])
  })

  it('§7.10 subtraction is symmetric: a cloud-only B tombstoned locally is removed', () => {
    const merged = mergePersisted(
      { workouts: [wk('a'), wk('b')] }, // cloud still holds B
      base({ workouts: [wk('a')], deletedWorkoutIds: ['b'] }), // local deleted B
    )
    expect(merged.workouts.map((w) => w.id)).toEqual(['a'])
  })

  it('§7.10 symmetric: a delete recorded in the CLOUD tombstone removes a row this device still holds', () => {
    const merged = mergePersisted(
      { workouts: [wk('a')], deletedWorkoutIds: ['b'] }, // cloud deleted B
      base({ workouts: [wk('a'), wk('b')] }), // local still holds B
    )
    expect(merged.workouts.map((w) => w.id)).toEqual(['a'])
    expect(merged.deletedWorkoutIds).toContain('b')
  })

  it('§7.18 missing/garbage deletedWorkoutIds in the blob is treated as [] and filtered', () => {
    // a non-array value must not throw and must not poison the tombstone
    const m1 = mergePersisted(
      { workouts: [wk('a')], deletedWorkoutIds: 'nope' as unknown as string[] },
      base(),
    )
    expect(m1.workouts.map((w) => w.id)).toEqual(['a'])
    expect(m1.deletedWorkoutIds).toEqual([])

    // a mixed array keeps only the string entries
    const m2 = mergePersisted(
      { deletedWorkoutIds: [1, null, 'x'] as unknown as string[] },
      base(),
    )
    expect(m2.deletedWorkoutIds).toEqual(['x'])
  })

  it('§7.19 a tombstone for an id present on neither side is harmless and retained', () => {
    const merged = mergePersisted({ workouts: [wk('a')], deletedWorkoutIds: ['ghost'] }, base())
    expect(merged.workouts.map((w) => w.id)).toEqual(['a'])
    expect(merged.deletedWorkoutIds).toEqual(['ghost'])
  })

  it('§7.20 mergePersisted({}, base()) → empty workouts and empty tombstone', () => {
    const merged = mergePersisted({}, base())
    expect(merged.workouts).toEqual([])
    expect(merged.deletedWorkoutIds).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// §7.8, §7.11, §7.12 — deleteWorkout records a tombstone; Undo removes it
// ---------------------------------------------------------------------------
describe('deleteWorkout tombstone + Undo', () => {
  function captureToast(fn: () => void): ToastData | null {
    let captured: ToastData | null = null
    const unsub = subscribeToast((t) => {
      captured = t
    })
    fn()
    unsub()
    return captured
  }

  it('§7.8 records the deleted id in deletedWorkoutIds (de-duped)', () => {
    useStore.setState(base({ workouts: [wk('a'), wk('b')] }))
    useStore.getState().deleteWorkout('b')
    expect(useStore.getState().deletedWorkoutIds).toEqual(['b'])
    // deleting again (already gone) must not duplicate the id
    useStore.getState().deleteWorkout('b')
    expect(useStore.getState().deletedWorkoutIds).toEqual(['b'])
  })

  it('§7.11 Undo restores the workout AND strips its tombstone, so a later merge keeps it', () => {
    useStore.setState(base({ workouts: [wk('a'), wk('b')] }))
    const toast = captureToast(() => useStore.getState().deleteWorkout('b'))
    expect(useStore.getState().deletedWorkoutIds).toEqual(['b'])

    toast!.action!.onAction()
    expect(useStore.getState().workouts.map((w) => w.id)).toEqual(['a', 'b'])
    expect(useStore.getState().deletedWorkoutIds).not.toContain('b')

    // a follow-up merge against a cloud blob that has B must now KEEP B (no re-subtraction)
    const merged = mergePersisted({ workouts: [wk('a'), wk('b')] }, useStore.getState())
    expect(merged.workouts.map((w) => w.id).sort()).toEqual(['a', 'b'])
  })

  it('§7.12 Undo when the workout already exists still strips the tombstone (no duplicate insert)', () => {
    useStore.setState(base({ workouts: [wk('a'), wk('b')] }))
    const toast = captureToast(() => useStore.getState().deleteWorkout('b'))
    // B re-appears (e.g. re-synced) before Undo fires
    useStore.setState({ workouts: [wk('a'), wk('b')] })
    toast!.action!.onAction()
    // B is present exactly once, and the tombstone is cleared either way
    expect(useStore.getState().workouts.filter((w) => w.id === 'b')).toHaveLength(1)
    expect(useStore.getState().deletedWorkoutIds).not.toContain('b')
  })
})

// ---------------------------------------------------------------------------
// §7.13, §7.14 — clock-bump after adopt (clockAfterAdopt)
// ---------------------------------------------------------------------------
describe('clockAfterAdopt — strictly past cloudTs so the next push survives the server <= guard', () => {
  it('§7.13 first sign-in (local 0): bumps strictly past cloud', () => {
    expect(clockAfterAdopt(0, 1000)).toBe(1001)
  })

  it('§7.13 local behind cloud: lands at cloud+1 (NOT exactly cloud, which nextClock would give)', () => {
    expect(clockAfterAdopt(500, 1000)).toBe(1001)
    // the bug being guarded: nextClock(500, 1000) === 1000 (== cloud) would be reverted by <=
  })

  it('§7.13 local already ahead of cloud: advances past local', () => {
    expect(clockAfterAdopt(2000, 1000)).toBe(2001)
  })

  it('§7.14 result is ALWAYS strictly greater than cloud across a range of inputs', () => {
    for (const [local, cloud] of [
      [0, 1000],
      [500, 1000],
      [1000, 1000],
      [2000, 1000],
      [999, 1000],
    ] as const) {
      expect(clockAfterAdopt(local, cloud)).toBeGreaterThan(cloud)
    }
  })
})

// ---------------------------------------------------------------------------
// §7.15, §7.16, §7.17 — newWorkoutId mint + fallback
// ---------------------------------------------------------------------------
describe('newWorkoutId', () => {
  const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  it('§7.15 mints unique RFC-4122 v4 UUIDs (crypto present)', () => {
    const ids = Array.from({ length: 10_000 }, () => newWorkoutId())
    expect(new Set(ids).size).toBe(10_000)
    for (const id of ids.slice(0, 50)) expect(id).toMatch(V4)
    expect(ids[0]).toMatch(V4)
  })

  it('§7.16 falls back to a legacy uid("w") when crypto is entirely absent', () => {
    vi.stubGlobal('crypto', undefined)
    const id = newWorkoutId()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
    expect(id.startsWith('w')).toBe(true)
    vi.unstubAllGlobals()
  })

  it('§7.16 falls back when crypto exists but lacks randomUUID', () => {
    vi.stubGlobal('crypto', {})
    const id = newWorkoutId()
    expect(id.startsWith('w')).toBe(true)
    vi.unstubAllGlobals()
  })
})

// ---------------------------------------------------------------------------
// §7.17, §7.21 — legacy-id compatibility + sanitize still applies in the union
// ---------------------------------------------------------------------------
describe('mergePersisted legacy ids + sanitize through the union path', () => {
  it('§7.17 legacy uid("w") ids and UUID ids coexist and union fine', () => {
    const legacy = wk('wabc1234xy')
    const uuid = wk('11111111-2222-4333-8444-555555555555')
    const merged = mergePersisted({ workouts: [legacy] }, base({ workouts: [uuid] }))
    expect(merged.workouts.map((w) => w.id).sort()).toEqual(
      ['11111111-2222-4333-8444-555555555555', 'wabc1234xy'].sort(),
    )
  })

  it('§7.17 a legacy id can be deleted/tombstoned correctly', () => {
    useStore.setState(base({ workouts: [wk('wabc1234xy')] }))
    useStore.getState().deleteWorkout('wabc1234xy')
    expect(useStore.getState().deletedWorkoutIds).toEqual(['wabc1234xy'])
    const merged = mergePersisted({ workouts: [wk('wabc1234xy')] }, useStore.getState())
    expect(merged.workouts).toHaveLength(0)
  })

  it('§7.21 a malformed (unsalvageable) workout in the cloud side is dropped by the union', () => {
    // exercises:'bad' is unsalvageable (mirrors store.test.ts:762+) → dropped, the good one survives
    const merged = mergePersisted(
      { workouts: [{ id: 'z', date: 1, status: 'completed', title: 't', focus: [], exercises: 'bad' } as unknown as Workout, wk('good')] },
      base(),
    )
    expect(merged.workouts.map((w) => w.id)).toEqual(['good'])
  })

  it('§7.21 a salvageable-but-malformed workout is repaired through the union path', () => {
    // missing targetReps is repairable → kept and defaulted to [8,12], same as the old line-734 path
    const merged = mergePersisted(
      {
        workouts: [
          {
            id: 'legacy',
            date: 1,
            status: 'completed',
            title: 'old',
            focus: [],
            exercises: [{ exerciseId: 'barbell-bench-press', sets: [{ id: 'a', weight: 135, reps: 8, done: true }] }],
          } as unknown as Workout,
        ],
      },
      base(),
    )
    expect(merged.workouts).toHaveLength(1)
    expect(merged.workouts[0].exercises[0].targetReps).toEqual([8, 12])
  })
})

// ---------------------------------------------------------------------------
// §7.26 — partializeState includes deletedWorkoutIds and stays serializable
// ---------------------------------------------------------------------------
describe('partializeState includes deletedWorkoutIds', () => {
  it('§7.26 carries the tombstone in the synced blob and round-trips through JSON', () => {
    const out = partializeState(base({ workouts: [wk('a')], deletedWorkoutIds: ['b'] }))
    expect(out.deletedWorkoutIds).toEqual(['b'])
    const json = JSON.stringify(out)
    expect(JSON.parse(json).deletedWorkoutIds).toEqual(['b'])
  })
})
