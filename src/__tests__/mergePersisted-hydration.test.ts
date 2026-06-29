import { describe, it, expect } from 'vitest'
import { mergePersisted, loggedSetCount, type AppState } from '../store/useStore'
import { prescribe } from '../lib/progression'
import { getExercise } from '../data/exercises'
import type { Workout } from '../types'
import { fullGymProfile } from './fixtures'

/**
 * A1 (corrupt set values → finite/sane on hydration AND cloud-adopt) and A2 (the in-progress `current`
 * session must survive a multi-device cloud adopt — keep the MORE-PROGRESSED side, not the wholesale
 * blob). Both go through `mergePersisted`, the single defensive merge for hydration (defaults vs
 * persisted) and adopt (cloud vs local). Pure — no supabase, no jsdom.
 */

const bench = getExercise('barbell-bench-press')!

// A live AppState (mirrors sync-merge.test.ts's base) — cast through unknown since we omit the actions.
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

// A workout whose single bench block's set values can be overridden literally (incl. corrupt values).
function wk(id: string, sets: Array<Partial<{ weight: number; reps: number; done: boolean }>>, over: Partial<Workout> = {}): Workout {
  return {
    id,
    date: 1,
    status: 'completed',
    title: id,
    focus: [],
    completedAt: 1,
    exercises: [
      {
        exerciseId: 'barbell-bench-press',
        targetReps: [8, 12],
        sets: sets.map((s, i) => ({ id: `s${i}`, weight: 135, reps: 8, done: true, ...s })),
      },
    ],
    ...over,
  } as Workout
}

// An in-progress (active) session with exactly `n` logged sets (done), plus one pristine un-logged set
// (weight 0 / reps 0 / not done) so loggedSetCount returns exactly `n` — the pending set carries no work.
function activeSession(id: string, loggedSets: number, over: Partial<Workout> = {}): Workout {
  const sets = [
    ...Array.from({ length: loggedSets }, (_, i) => ({ id: `l${i}`, weight: 135, reps: 8, done: true })),
    { id: 'pending', weight: 0, reps: 0, done: false },
  ]
  return {
    id,
    date: 1,
    status: 'active',
    title: id,
    focus: ['chest'],
    startedAt: 1000,
    exercises: [{ exerciseId: 'barbell-bench-press', targetReps: [8, 12], sets }],
    ...over,
  } as Workout
}

// ---------------------------------------------------------------------------
// A1 — corrupt set VALUES are coerced finite & sane through mergePersisted
// ---------------------------------------------------------------------------
describe('A1 mergePersisted coerces corrupt set weight/reps values', () => {
  it('NaN / negative / string weight and NaN reps in a completed workout come out finite & ≥0', () => {
    const corrupt = wk('c', [
      { weight: NaN, reps: NaN },
      { weight: -200, reps: 8 },
      { weight: 'abc' as unknown as number, reps: 8 },
      { weight: 135, reps: -5 },
    ])
    const merged = mergePersisted({ workouts: [corrupt] }, base())
    const out = merged.workouts.find((w) => w.id === 'c')!
    expect(out).toBeTruthy()
    for (const s of out.exercises[0].sets) {
      expect(Number.isFinite(s.weight)).toBe(true)
      expect(s.weight).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(s.reps)).toBe(true)
      expect(s.reps).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(s.reps)).toBe(true)
    }
  })

  it('clean values are left untouched (no spurious coercion)', () => {
    const merged = mergePersisted({ workouts: [wk('ok', [{ weight: 185, reps: 5 }])] }, base())
    const out = merged.workouts.find((w) => w.id === 'ok')!
    expect(out.exercises[0].sets[0].weight).toBe(185)
    expect(out.exercises[0].sets[0].reps).toBe(5)
  })

  it('coercion also runs on the in-progress `current` session (adopt path)', () => {
    const corruptCurrent = wk('cur', [{ weight: NaN, reps: NaN }], { status: 'active' })
    const merged = mergePersisted({ current: corruptCurrent }, base())
    const s = merged.current!.exercises[0].sets[0]
    expect(Number.isFinite(s.weight)).toBe(true)
    expect(s.weight).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(s.reps)).toBe(true)
  })

  it('a NaN-weight history through the real adopt path yields a finite, non-negative prescription', () => {
    // route the corrupt blob through mergePersisted (the production sanitize boundary), THEN prescribe
    const corrupt = wk('h', [{ weight: -200, reps: 12 }, { weight: -200, reps: 12 }])
    const merged = mergePersisted({ workouts: [corrupt] }, base())
    const p = prescribe(bench, merged.workouts, [8, 12], fullGymProfile)!
    expect(p).toBeTruthy()
    expect(Number.isFinite(p.weight)).toBe(true)
    expect(p.weight).toBeGreaterThanOrEqual(0)
  })
})

// ---------------------------------------------------------------------------
// A2 — the more-progressed in-progress `current` survives a cloud adopt
// ---------------------------------------------------------------------------
describe('A2 mergePersisted keeps the more-progressed current session', () => {
  it('HYDRATION (local current null) keeps the persisted session byte-for-byte', () => {
    const persisted = activeSession('s', 2)
    const merged = mergePersisted({ current: persisted }, base())
    expect(merged.current?.id).toBe('s')
    expect(loggedSetCount(merged.current)).toBe(2)
  })

  it('ADOPT: cloud current is null but local has logged sets → keep the local session', () => {
    const local = activeSession('local', 3)
    const merged = mergePersisted({ current: null }, base({ current: local }))
    expect(merged.current?.id).toBe('local')
    expect(loggedSetCount(merged.current)).toBe(3)
  })

  it('ADOPT: local current is null but cloud has logged sets → adopt the cloud session', () => {
    const cloud = activeSession('cloud', 2)
    const merged = mergePersisted({ current: cloud }, base({ current: null }))
    expect(merged.current?.id).toBe('cloud')
    expect(loggedSetCount(merged.current)).toBe(2)
  })

  it('ADOPT: both non-null → keep whichever side logged MORE sets (local wins)', () => {
    const cloud = activeSession('cloud', 1)
    const local = activeSession('local', 4)
    const merged = mergePersisted({ current: cloud }, base({ current: local }))
    expect(merged.current?.id).toBe('local')
    expect(loggedSetCount(merged.current)).toBe(4)
  })

  it('ADOPT: both non-null → keep whichever side logged MORE sets (cloud wins)', () => {
    const cloud = activeSession('cloud', 5)
    const local = activeSession('local', 1)
    const merged = mergePersisted({ current: cloud }, base({ current: local }))
    expect(merged.current?.id).toBe('cloud')
    expect(loggedSetCount(merged.current)).toBe(5)
  })

  it('ADOPT: tie on logged sets → keep the newer (later startedAt) session', () => {
    const cloud = activeSession('cloud', 2, { startedAt: 5000 })
    const local = activeSession('local', 2, { startedAt: 1000 })
    const merged = mergePersisted({ current: cloud }, base({ current: local }))
    expect(merged.current?.id).toBe('cloud')
  })

  it('committed workouts[] are never lost while arbitrating current (union still applies)', () => {
    const local = activeSession('local-current', 3)
    const merged = mergePersisted(
      { current: null, workouts: [wk('cloudW', [{ weight: 135, reps: 8 }])] },
      base({ current: local, workouts: [wk('localW', [{ weight: 95, reps: 8 }])] }),
    )
    // the more-progressed local current survives
    expect(merged.current?.id).toBe('local-current')
    // AND both committed workouts survive the union
    expect(merged.workouts.map((w) => w.id).sort()).toEqual(['cloudW', 'localW'])
  })

  // -- resurrection guard: a session FINISHED or DELETED elsewhere must not survive as a live current --
  it('RESURRECTION GUARD: cloud finished session X (now in workouts[]) + local still in-progress X → current dropped, completed X kept', () => {
    // Another device COMPLETED session X: it set current=null and moved X (same id) into workouts[].
    // This device still holds the in-progress copy. Keeping it would revive an already-saved session and
    // let the user log a duplicate. The merged current must be null; the completed X stays in history.
    const local = activeSession('X', 2)
    const merged = mergePersisted(
      { current: null, workouts: [wk('X', [{ weight: 135, reps: 8 }])] },
      base({ current: local, workouts: [] }),
    )
    expect(merged.current).toBeNull()
    expect(merged.workouts.map((w) => w.id)).toEqual(['X'])
    // and the surviving X is the COMPLETED one, not the in-progress one
    expect(merged.workouts[0].status).toBe('completed')
  })

  it('RESURRECTION GUARD: a current whose id was DELETED elsewhere (tombstone) is dropped', () => {
    // Session X was deleted on another device → its id is in the tombstone set. A lingering local
    // in-progress copy must not be revived.
    const local = activeSession('X', 3)
    const merged = mergePersisted(
      { current: null, deletedWorkoutIds: ['X'] },
      base({ current: local }),
    )
    expect(merged.current).toBeNull()
  })

  it('RESURRECTION GUARD does NOT fire for a genuinely-new local-only session (cloud never had it)', () => {
    // The legitimate keep-local case: cloud current is null AND the session is NOT in history/tombstones,
    // so it is a real in-progress session this device is mid-logging — it must survive.
    const local = activeSession('fresh', 3)
    const merged = mergePersisted({ current: null, workouts: [] }, base({ current: local }))
    expect(merged.current?.id).toBe('fresh')
    expect(loggedSetCount(merged.current)).toBe(3)
  })

  it('RESURRECTION GUARD also drops an ADOPTED cloud current that is already in completed history', () => {
    // Symmetry: even if the chosen side is the cloud session, an id already in merged workouts[] is a
    // finished session and must not come back as live.
    const cloud = activeSession('Y', 4)
    const merged = mergePersisted(
      { current: cloud, workouts: [wk('Y', [{ weight: 135, reps: 8 }])] },
      base({ current: null, workouts: [] }),
    )
    expect(merged.current).toBeNull()
    expect(merged.workouts.map((w) => w.id)).toEqual(['Y'])
  })
})

// ---------------------------------------------------------------------------
// loggedSetCount — the progress metric A2 arbitrates on
// ---------------------------------------------------------------------------
describe('loggedSetCount', () => {
  it('counts sets with a done flag OR a recorded weight/reps; null → 0', () => {
    expect(loggedSetCount(null)).toBe(0)
    expect(loggedSetCount(activeSession('x', 0))).toBe(0) // only a pristine pending set (no work)
    expect(loggedSetCount(activeSession('x', 3))).toBe(3) // 3 done sets; the pending set carries no work
    // a not-done set that still carries a recorded weight DOES count (mid-entry)
    const midEntry = activeSession('y', 1, {})
    midEntry.exercises[0].sets.push({ id: 'm', weight: 95, reps: 0, done: false } as never)
    expect(loggedSetCount(midEntry)).toBe(2)
  })

  it('a pristine planned session with zero recorded work counts as 0', () => {
    const pristine = {
      id: 'p',
      date: 1,
      status: 'active',
      title: 'p',
      focus: ['chest'],
      startedAt: 1,
      exercises: [
        { exerciseId: 'barbell-bench-press', targetReps: [8, 12], sets: [{ id: 'a', weight: 0, reps: 0, done: false }] },
      ],
    } as Workout
    expect(loggedSetCount(pristine)).toBe(0)
  })
})
