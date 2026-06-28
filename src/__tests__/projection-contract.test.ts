import { describe, it, expect } from 'vitest'
import { partializeState, type AppState } from '../store/useStore'
import { uid } from '../lib/format'
import type { Workout } from '../types'
import { fullGymProfile } from './fixtures'

// Drift guard for §7.23–§7.25: a completed workout produced by partializeState (the synced blob) must
// satisfy the server's analytics.is_projectable predicate AND expose every field the projection reads
// (analytics.reconcile_user). is_projectable is re-implemented in TS EXACTLY mirroring the SQL
// (baseline_schema.sql:329) so this test is the faithful client-side contract.

// EXACT mirror of: w->>'status' = 'completed' AND coalesce(w->>'id','') <> '' AND jsonb_typeof(w->'exercises') = 'array'
function isProjectable(w: { status?: unknown; id?: unknown; exercises?: unknown }): boolean {
  return w.status === 'completed' && (((w.id as string) ?? '') !== '') && Array.isArray(w.exercises)
}

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

// A maximally-populated completed workout: every projection-read field set (top-level, per-exercise,
// per-set incl. rpe + warmup), so the contract can assert each one is preserved through partializeState.
const fullWorkout: Workout = {
  id: 'sess-1',
  date: 1_700_000_000_000,
  status: 'completed',
  title: 'Push Day',
  focus: ['chest', 'shoulders'],
  genFocus: ['chest'],
  durationMin: 52,
  startedAt: 1_699_999_000_000,
  completedAt: 1_700_000_000_000,
  bodyweight: 180,
  planId: 'ppl-6',
  planDayLabel: 'Day 1 · Push',
  tzOffsetMin: 300,
  performed_on: '2023-11-14',
  exercises: [
    {
      exerciseId: 'barbell-bench-press',
      instanceId: 'we_1',
      planLiftId: 'barbell-bench-press',
      planSlot: 0,
      group: 'A',
      targetReps: [5, 5],
      rpe: 8,
      sets: [
        { id: uid('s'), weight: 185, reps: 5, done: true, warmup: false, rpe: 8 },
        { id: uid('s'), weight: 45, reps: 10, done: true, warmup: true },
      ],
    },
  ],
}

describe('projection contract (partializeState ↔ analytics.is_projectable / reconcile_user)', () => {
  const out = partializeState(base({ workouts: [fullWorkout] }))
  const w = out.workouts[0]

  it('§7.23 a fully-populated completed workout from partializeState is projectable', () => {
    expect(isProjectable(w)).toBe(true)
    expect(w.status).toBe('completed')
    expect((w.id ?? '') !== '').toBe(true)
    expect(Array.isArray(w.exercises)).toBe(true)
  })

  it('§7.23 exposes every TOP-LEVEL field the projection reads', () => {
    for (const k of [
      'id',
      'completedAt',
      'date',
      'tzOffsetMin',
      'bodyweight',
      'title',
      'durationMin',
      'startedAt',
      'focus',
      'genFocus',
      'planId',
      'planDayLabel',
    ] as const) {
      expect(w[k], `missing top-level field ${k}`).toBeDefined()
    }
  })

  it('§7.23 exposes every PER-EXERCISE field the projection reads', () => {
    const ex = w.exercises[0]
    for (const k of ['exerciseId', 'instanceId', 'planLiftId', 'planSlot', 'group', 'targetReps'] as const) {
      expect(ex[k], `missing exercise field ${k}`).toBeDefined()
    }
  })

  it('§7.23 exposes every PER-SET field the projection reads (id, weight, reps, done, warmup, rpe)', () => {
    const set = w.exercises[0].sets[0]
    for (const k of ['id', 'weight', 'reps', 'done', 'warmup', 'rpe'] as const) {
      expect(set[k], `missing set field ${k}`).toBeDefined()
    }
    // all in-app sets are minted with uid('s') → a non-empty string id
    expect(typeof set.id).toBe('string')
    expect(set.id.length).toBeGreaterThan(0)
  })

  it('§7.24 is_projectable rejects non-completed / empty-id / non-array exercises (mirrors the SQL)', () => {
    expect(isProjectable({ status: 'active', id: 'x', exercises: [] })).toBe(false)
    expect(isProjectable({ status: 'completed', id: '', exercises: [] })).toBe(false)
    expect(isProjectable({ status: 'completed', id: 'x', exercises: 'no' })).toBe(false)
    // a well-formed completed shape is accepted
    expect(isProjectable({ status: 'completed', id: 'x', exercises: [] })).toBe(true)
  })

  it('§7.25 a set without an id is flagged as "would-not-project" (the projection drops id-less sets)', () => {
    // reconcile_user:469 — `where sto.st->>'id' is not null` drops sets lacking an id
    const wouldProjectSet = (s: { id?: unknown }): boolean => s.id != null && s.id !== ''
    expect(wouldProjectSet({ id: uid('s'), weight: 100, reps: 5 } as { id: string })).toBe(true)
    expect(wouldProjectSet({ weight: 100, reps: 5 } as { id?: string })).toBe(false)
  })
})
