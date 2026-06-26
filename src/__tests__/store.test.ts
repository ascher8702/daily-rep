import { describe, it, expect, beforeEach } from 'vitest'
import { useStore, mergePersisted, restSecondsFor, type AppState } from '../store/useStore'
import { subscribeToast, type ToastData } from '../lib/toast'
import type { Equipment, Workout } from '../types'
import { getPlan, type WorkoutPlan } from '../data/plans'
import { getExercise } from '../data/exercises'
import { isExerciseDoable } from '../lib/equipment'
import { fullGymProfile } from './fixtures'

function sessionWith(weight: number, done: boolean): Workout {
  return {
    id: 'cur',
    date: 1,
    status: 'active',
    title: 'Test',
    focus: [],
    startedAt: 1,
    exercises: [
      {
        exerciseId: 'barbell-bench-press',
        targetReps: [8, 12],
        sets: [{ id: 'a', weight, reps: 10, done }],
      },
    ],
  }
}

beforeEach(() => {
  useStore.setState({
    profile: { ...fullGymProfile, unit: 'lb' },
    workouts: [],
    current: null,
    activePlan: null,
    restEndsAt: null,
    restDuration: 0,
    customPlans: [],
    planProgress: {},
  })
})

function customPlan(id: string, equipmentContext: WorkoutPlan['equipmentContext'] = 'full-gym'): WorkoutPlan {
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
    equipmentContext,
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

describe('custom plans', () => {
  it('adds, updates, and deletes a custom plan', () => {
    useStore.getState().addCustomPlan(customPlan('c1'))
    expect(useStore.getState().customPlans).toHaveLength(1)
    expect(useStore.getState().customPlans[0].custom).toBe(true)

    useStore.getState().updateCustomPlan('c1', { ...customPlan('c1'), name: 'Renamed' })
    expect(useStore.getState().customPlans[0].name).toBe('Renamed')

    useStore.getState().deleteCustomPlan('c1')
    expect(useStore.getState().customPlans).toHaveLength(0)
  })

  it('updateCustomPlan remaps planOverrides on a day rename and drops overrides for removed days', () => {
    const id = 'cov-rename'
    const twoDay = (l0: string, l1: string): WorkoutPlan => ({
      ...customPlan(id),
      schedule: [
        { label: l0, title: l0, focus: ['chest'], goal: 'strength', lifts: [{ exerciseId: 'barbell-bench-press', sets: 5, repMin: 5, repMax: 5 }] },
        { label: l1, title: l1, focus: ['quads'], goal: 'strength', lifts: [{ exerciseId: 'leg-press', sets: 5, repMin: 5, repMax: 5 }] },
      ],
    })
    useStore.getState().addCustomPlan(twoDay('Day 1', 'Day 2'))
    useStore.setState({
      planOverrides: {
        [id]: { 'Day 1::barbell-bench-press': 'incline-bench-press', 'Day 2::leg-press': 'hack-squat' },
      },
    })

    // rename day 0 "Day 1" → "Push" (keep "Day 2"): the swap follows the renamed day, not the old label
    useStore.getState().updateCustomPlan(id, twoDay('Push', 'Day 2'))
    expect(useStore.getState().planOverrides[id]).toEqual({
      'Push::barbell-bench-press': 'incline-bench-press',
      'Day 2::leg-press': 'hack-squat',
    })

    // shrink to a single day "Push": the removed day's override is dropped (no orphan cruft)
    useStore.getState().updateCustomPlan(id, {
      ...customPlan(id),
      schedule: [{ label: 'Push', title: 'Push', focus: ['chest'], goal: 'strength', lifts: [{ exerciseId: 'barbell-bench-press', sets: 5, repMin: 5, repMax: 5 }] }],
    })
    expect(useStore.getState().planOverrides[id]).toEqual({ 'Push::barbell-bench-press': 'incline-bench-press' })
  })

  it('deleting the followed custom plan stops following it', () => {
    useStore.getState().addCustomPlan(customPlan('c2'))
    useStore.getState().startPlan('c2')
    expect(useStore.getState().activePlan?.planId).toBe('c2')
    useStore.getState().deleteCustomPlan('c2')
    expect(useStore.getState().activePlan).toBeNull()
  })

  it('duplicatePlan forks a built-in into an editable custom copy', () => {
    const newId = useStore.getState().duplicatePlan('ppl-6')
    expect(newId).toBeTruthy()
    const copy = useStore.getState().customPlans.find((p) => p.id === newId)!
    expect(copy.custom).toBe(true)
    expect(copy.name).toContain('Copy')
    expect(copy.schedule.length).toBeGreaterThan(0)
  })

  it('generateFromPlan builds a custom plan day from its explicit lifts', () => {
    useStore.getState().addCustomPlan(customPlan('c3'))
    useStore.getState().startPlan('c3')
    useStore.getState().generateFromPlan()
    const cur = useStore.getState().current!
    expect(cur.planId).toBe('c3')
    expect(cur.exercises.some((e) => e.exerciseId === 'barbell-bench-press')).toBe(true)
    // the program dictates 5 working sets
    const bench = cur.exercises.find((e) => e.exerciseId === 'barbell-bench-press')!
    expect(bench.sets.filter((s) => !s.warmup)).toHaveLength(5)
  })

  it('substitutes a plan lift the user cannot equip, and notes the swap', () => {
    useStore.setState({ profile: { ...fullGymProfile, equipment: ['dumbbell', 'bench', 'bodyweight'] } })
    useStore.getState().addCustomPlan(customPlan('c4'))
    useStore.getState().startPlan('c4')
    useStore.getState().generateFromPlan()
    const cur = useStore.getState().current!
    // no barbell → bench press swapped to an equippable chest press
    expect(cur.exercises.some((e) => e.exerciseId === 'barbell-bench-press')).toBe(false)
    const chest = cur.exercises.find((e) => getExercise(e.exerciseId)?.primary.includes('chest'))!
    expect(chest).toBeDefined()
    expect(chest.note).toMatch(/Swapped from/)
  })

  it('a plan day with a REPEATED lift yields two independently-editable blocks (instanceId)', () => {
    const plan = customPlan('cdup')
    plan.schedule[0].lifts = [
      { exerciseId: 'barbell-bench-press', sets: 5, repMin: 3, repMax: 5 }, // main
      { exerciseId: 'barbell-bench-press', sets: 3, repMin: 8, repMax: 12 }, // supplemental, same lift
    ]
    useStore.getState().addCustomPlan(plan)
    useStore.getState().startPlan('cdup')
    useStore.getState().generateFromPlan()
    const cur = useStore.getState().current!
    const benches = cur.exercises.filter((e) => e.exerciseId === 'barbell-bench-press')
    expect(benches).toHaveLength(2)
    expect(benches[0].instanceId).toBeDefined()
    expect(benches[1].instanceId).not.toBe(benches[0].instanceId)
    // toggling a set on the SECOND block must hit the second block, not collide with the first
    const secondSet = benches[1].sets.find((s) => !s.warmup)!
    useStore.getState().toggleSetDone(benches[1].instanceId!, secondSet.id)
    const after = useStore.getState().current!.exercises.filter((e) => e.exerciseId === 'barbell-bench-press')
    expect(after[1].sets.find((s) => s.id === secondSet.id)!.done).toBe(true)
    expect(after[0].sets.every((s) => !s.done)).toBe(true) // first block untouched
  })

  it('removeExercise targets the right block when an exercise is repeated', () => {
    const plan = customPlan('cdup2')
    plan.schedule[0].lifts = [
      { exerciseId: 'overhead-press', sets: 5, repMin: 3, repMax: 5 },
      { exerciseId: 'overhead-press', sets: 3, repMin: 8, repMax: 12 },
    ]
    useStore.getState().addCustomPlan(plan)
    useStore.getState().startPlan('cdup2')
    useStore.getState().generateFromPlan()
    const before = useStore.getState().current!.exercises.filter((e) => e.exerciseId === 'overhead-press')
    expect(before).toHaveLength(2)
    useStore.getState().removeExercise(before[1].instanceId!)
    const ohp = useStore.getState().current!.exercises.filter((e) => e.exerciseId === 'overhead-press')
    expect(ohp).toHaveLength(1)
    expect(ohp[0].instanceId).toBe(before[0].instanceId) // kept the FIRST, removed the second
  })

  it('falls back to focus-based generation instead of committing a junk empty session', () => {
    const plan = customPlan('cf')
    // a day whose only lift no longer resolves, but with a valid focus
    plan.schedule[0].lifts = [{ exerciseId: 'does-not-exist', sets: 3, repMin: 5, repMax: 5 }]
    plan.schedule[0].focus = ['chest']
    useStore.getState().addCustomPlan(plan)
    useStore.getState().startPlan('cf')
    useStore.getState().generateFromPlan()
    const cur = useStore.getState().current!
    expect(cur).not.toBeNull()
    expect(cur.exercises.length, 'should not be an empty trap session').toBeGreaterThan(0)
    expect(cur.planId).toBe('cf')
  })
})

describe('mergePersisted hardens custom plans', () => {
  const base = (): AppState =>
    ({
      profile: { ...fullGymProfile },
      workouts: [],
      current: null,
      activePlan: null,
      restEndsAt: null,
      restDuration: 0,
      customPlans: [],
    }) as unknown as AppState

  const plan = (id: string, schedule: unknown) => ({
    id,
    name: id,
    tagline: '',
    description: '',
    daysPerWeek: 1,
    goalFit: ['strength'],
    level: 'intermediate',
    equipment: 'Full gym',
    schedule,
  })

  it('drops a custom plan with a malformed lift (null / missing exerciseId)', () => {
    const persisted = {
      customPlans: [
        plan('bad', [{ label: 'D', title: 'D', focus: ['chest'], lifts: [null] }]),
        plan('ok', [{ label: 'D', title: 'D', focus: ['chest'], lifts: [{ exerciseId: 'pushup', sets: 3, repMin: 8, repMax: 12 }] }]),
      ],
    }
    const merged = mergePersisted(persisted, base())
    expect(merged.customPlans.map((p) => p.id)).toEqual(['ok'])
  })

  it('repairs a custom plan day missing title/label', () => {
    const persisted = {
      customPlans: [plan('c', [{ focus: ['chest'], lifts: [{ exerciseId: 'pushup', sets: 3, repMin: 8, repMax: 12 }] }])],
    }
    const merged = mergePersisted(persisted, base())
    expect(merged.customPlans).toHaveLength(1)
    const day = merged.customPlans[0].schedule[0]
    expect(typeof day.title).toBe('string')
    expect(day.title.length).toBeGreaterThan(0)
    expect(day.label.length).toBeGreaterThan(0)
  })

  it('drops an empty-schedule custom plan (would be a modulo-by-zero dead-end)', () => {
    const merged = mergePersisted({ customPlans: [plan('empty', [])] }, base())
    expect(merged.customPlans).toHaveLength(0)
  })

  it('drops an activePlan whose planId no longer resolves (deleted plan), keeps a resolvable one', () => {
    // dangling: planId references a plan that isn't in customPlans or the built-in catalogue
    const dangling = mergePersisted({ activePlan: { planId: 'ghost-plan-xyz', dayIndex: 2 }, customPlans: [] }, base())
    expect(dangling.activePlan).toBeNull()
    // a built-in plan still resolves and is kept
    const ok = mergePersisted({ activePlan: { planId: 'ppl-6', dayIndex: 1 } }, base())
    expect(ok.activePlan?.planId).toBe('ppl-6')
    // a custom plan that survives hydration also keeps its activePlan
    const okCustom = mergePersisted(
      {
        activePlan: { planId: 'cmine', dayIndex: 0 },
        customPlans: [plan('cmine', [{ label: 'D', title: 'D', focus: ['chest'], lifts: [{ exerciseId: 'pushup', sets: 3, repMin: 8, repMax: 12 }] }])],
      },
      base(),
    )
    expect(okCustom.activePlan?.planId).toBe('cmine')
  })

  it('prunes planOverrides orphaned by a deleted custom plan, but keeps custom/bundled/DB keys', () => {
    const survivor = plan('planabcdef12', [
      { label: 'D', title: 'D', focus: ['chest'], lifts: [{ exerciseId: 'pushup', sets: 3, repMin: 8, repMax: 12 }] },
    ])
    const merged = mergePersisted(
      {
        customPlans: [survivor],
        planOverrides: {
          planabcdef12: { 'Day 1::a': 'b' }, // live custom plan → kept
          planorphan99: { 'Day 1::a': 'b' }, // custom-id shape, no longer in customPlans → pruned (orphan)
          'ppl-6': { 'Day 1::a': 'b' }, // bundled slug → kept
          'db-only-xyz': { 'Day 1::a': 'b' }, // DB-only slug, not loaded at hydration → MUST be kept (safety)
          planjunkval0: null, // custom-id shape but garbage value → dropped
        },
      },
      base(),
    )
    expect(Object.keys(merged.planOverrides).sort()).toEqual(['db-only-xyz', 'planabcdef12', 'ppl-6'])
    expect(merged.planOverrides['db-only-xyz']).toEqual({ 'Day 1::a': 'b' }) // DB-plan override preserved intact
  })
})

describe('changing plans keeps progression consistent', () => {
  it('startPlan: switching plans drops an UNWORKED session from the old plan', () => {
    const cur = { ...sessionWith(100, false), planId: 'ppl-6', planDayLabel: 'Day 1 · Push (Strength)' }
    useStore.setState({ activePlan: { planId: 'ppl-6', dayIndex: 3, startedAt: 1 }, current: cur })
    useStore.getState().startPlan('stronglifts-5x5')
    expect(useStore.getState().current).toBeNull() // no orphaned old-plan session lingering as the hero
    expect(useStore.getState().activePlan).toMatchObject({ planId: 'stronglifts-5x5', dayIndex: 0 })
  })

  it('startPlan: switching KEEPS a logged session but untags it from the plan', () => {
    const cur = { ...sessionWith(100, true), planId: 'ppl-6', planDayLabel: 'Day 1 · Push (Strength)' }
    useStore.setState({ activePlan: { planId: 'ppl-6', dayIndex: 3, startedAt: 1 }, current: cur })
    useStore.getState().startPlan('stronglifts-5x5')
    const c = useStore.getState().current
    expect(c).not.toBeNull() // real logged work isn't silently discarded
    expect(c!.planId).toBeUndefined() // but it's no longer tied to a plan
    expect(c!.planDayLabel).toBeUndefined()
  })

  it('startPlan RESUMES from saved per-plan progress; restart forces Day 1', () => {
    useStore.setState({ activePlan: null, current: null, planProgress: { 'ppl-6': 3 } })
    useStore.getState().startPlan('ppl-6')
    expect(useStore.getState().activePlan).toMatchObject({ planId: 'ppl-6', dayIndex: 3 }) // resumed
    useStore.getState().startPlan('ppl-6', true)
    expect(useStore.getState().activePlan!.dayIndex).toBe(0) // explicit restart
  })

  it('finishWorkout records plan progress so leaving and returning to a plan resumes where you left off', () => {
    const cur = { ...sessionWith(100, true), planId: 'ppl-6', planDayLabel: 'Day 1 · Push (Strength)' }
    useStore.setState({ activePlan: { planId: 'ppl-6', dayIndex: 0, startedAt: 1 }, current: cur, workouts: [], planProgress: {} })
    useStore.getState().finishWorkout()
    expect(useStore.getState().activePlan!.dayIndex).toBe(1)
    expect(useStore.getState().planProgress['ppl-6']).toBe(1)
    // switch to another plan, then back → ppl-6 resumes at day 1, not day 0
    useStore.getState().startPlan('stronglifts-5x5')
    useStore.getState().startPlan('ppl-6')
    expect(useStore.getState().activePlan!.dayIndex).toBe(1)
  })

  it('a new plan (no saved progress) starts at Day 0', () => {
    useStore.setState({ activePlan: null, current: null, planProgress: {} })
    useStore.getState().startPlan('madcow-5x5')
    expect(useStore.getState().activePlan!.dayIndex).toBe(0)
  })

  it('updateCustomPlan clamps the active dayIndex when its schedule shrinks', () => {
    const day = (i: number): WorkoutPlan['schedule'][number] => ({
      label: `D${i}`,
      title: `D${i}`,
      focus: ['chest'],
      goal: 'strength',
      lifts: [{ exerciseId: 'barbell-bench-press', sets: 3, repMin: 5, repMax: 5 }],
    })
    const big = { ...customPlan('cshrink'), schedule: [day(1), day(2), day(3), day(4), day(5), day(6)] }
    useStore.setState({ customPlans: [big], activePlan: { planId: 'cshrink', dayIndex: 4, startedAt: 1 } })
    useStore.getState().updateCustomPlan('cshrink', { ...big, schedule: [day(1), day(2), day(3)] })
    // was on day 5 (index 4); a 3-day plan clamps to the last valid day (index 2), not a wrapped earlier day
    expect(useStore.getState().activePlan!.dayIndex).toBe(2)
  })
})

describe('setUnit', () => {
  it('converts stored weights, not just the label', () => {
    useStore.setState({ workouts: [{ ...sessionWith(100, true), status: 'completed', completedAt: 1 }] })
    useStore.getState().setUnit('kg')
    const s = useStore.getState()
    expect(s.profile.unit).toBe('kg')
    // 100 lb ~= 45.4 kg
    expect(s.workouts[0].exercises[0].sets[0].weight).toBeCloseTo(45.5, 1)
  })

  it('round-trips back to within a gym-increment of the original', () => {
    useStore.setState({ current: sessionWith(135, false) })
    useStore.getState().setUnit('kg')
    useStore.getState().setUnit('lb')
    // rounding to plate increments means a small, expected drift
    const w = useStore.getState().current!.exercises[0].sets[0].weight
    expect(Math.abs(w - 135)).toBeLessThanOrEqual(2)
  })

  it('converts the coaching increment so its "+X unit" cue is not self-contradicting after a switch', () => {
    const cur = sessionWith(100, false)
    cur.exercises[0].coaching = { note: 'hit your reps', incWeight: 5, weightDir: 'up', repsDir: 'same' }
    useStore.setState({ current: cur, profile: { ...fullGymProfile, unit: 'lb' } })
    useStore.getState().setUnit('kg')
    const inc = useStore.getState().current!.exercises[0].coaching!.incWeight!
    expect(inc).toBeLessThan(5) // 5 lb ≈ 2.3 kg — converted, not left as a stale "+5 lb"
    expect(inc).toBeGreaterThan(0)
  })
})

describe('finishWorkout', () => {
  it('does not save a session where nothing was completed', () => {
    useStore.setState({ current: sessionWith(100, false) })
    useStore.getState().finishWorkout()
    const s = useStore.getState()
    expect(s.workouts).toHaveLength(0)
    expect(s.current).toBeNull()
  })

  it('saves only completed sets', () => {
    const cur = sessionWith(100, true)
    cur.exercises[0].sets.push({ id: 'b', weight: 50, reps: 10, done: false })
    useStore.setState({ current: cur })
    useStore.getState().finishWorkout()
    const saved = useStore.getState().workouts[0]
    expect(saved.status).toBe('completed')
    expect(saved.exercises[0].sets).toHaveLength(1)
    expect(saved.exercises[0].sets[0].done).toBe(true)
  })

  it('caps an absurd elapsed duration', () => {
    const cur = sessionWith(100, true)
    cur.startedAt = 0 // "started" at epoch, finishing now -> huge raw duration
    useStore.setState({ current: cur })
    useStore.getState().finishWorkout()
    expect(useStore.getState().workouts[0].durationMin).toBeLessThanOrEqual(240)
  })
})

describe('addExercise autofill + progression', () => {
  function priorBench(reps: number[]): Workout {
    return {
      id: 'p',
      date: 1,
      status: 'completed',
      title: 'prior',
      focus: [],
      completedAt: 1,
      exercises: [
        {
          exerciseId: 'barbell-bench-press',
          targetReps: [8, 12],
          sets: reps.map((r, i) => ({ id: 'a' + i, weight: 135, reps: r, done: true })),
        },
      ],
    }
  }

  it('autofills the same set count and load, nudging reps when below the top of the range', () => {
    useStore.setState({
      workouts: [priorBench([9, 9, 8])],
      current: { ...sessionWith(100, false), exercises: [] },
    })
    useStore.getState().addExercise('barbell-bench-press')
    const added = useStore.getState().current!.exercises.find((e) => e.exerciseId === 'barbell-bench-press')!
    expect(added.sets).toHaveLength(3)
    // didn't hit the top (12) last time → keep 135, target one more rep (10)
    expect(added.sets.every((s) => s.weight === 135 && s.reps === 10)).toBe(true)
  })

  it('adds load (and resets reps) when every set hit the top of the range', () => {
    useStore.setState({
      workouts: [priorBench([12, 12, 12])],
      current: { ...sessionWith(100, false), exercises: [] },
    })
    useStore.getState().addExercise('barbell-bench-press')
    const added = useStore.getState().current!.exercises.find((e) => e.exerciseId === 'barbell-bench-press')!
    expect(added.sets.every((s) => s.weight > 135)).toBe(true) // load increased
    expect(added.sets.every((s) => s.reps === 8)).toBe(true) // reset to bottom of range
  })
})

describe('updateSet input sanitization', () => {
  it('clamps negative, huge and non-finite values', () => {
    useStore.setState({ current: sessionWith(100, false) })
    const id = useStore.getState().current!.exercises[0].sets[0].id
    useStore.getState().updateSet('barbell-bench-press', id, { weight: -50 })
    expect(useStore.getState().current!.exercises[0].sets[0].weight).toBe(0)
    useStore.getState().updateSet('barbell-bench-press', id, { weight: 1e9 })
    expect(useStore.getState().current!.exercises[0].sets[0].weight).toBe(9999)
    useStore.getState().updateSet('barbell-bench-press', id, { reps: NaN })
    expect(useStore.getState().current!.exercises[0].sets[0].reps).toBe(0)
  })

  it('whitelists + coerces the patch: spoofed id ignored, corrupt done/rpe coerced', () => {
    useStore.setState({ current: sessionWith(100, false) })
    const origId = useStore.getState().current!.exercises[0].sets[0].id
    const set0 = () => useStore.getState().current!.exercises[0].sets[0]

    // a spoofed id in the patch must NOT change the set's identity
    useStore.getState().updateSet('barbell-bench-press', origId, { id: 'evil', reps: 8 })
    expect(set0().id).toBe(origId)
    expect(set0().reps).toBe(8)

    // a non-boolean `done` is coerced to a real boolean (never NaN/null) → finishWorkout filters stay sound
    useStore.getState().updateSet('barbell-bench-press', origId, { done: NaN as unknown as boolean })
    expect(set0().done).toBe(false)
    useStore.getState().updateSet('barbell-bench-press', origId, { done: 1 as unknown as boolean })
    expect(set0().done).toBe(true)
  })
})

describe('setExerciseEffort (reps-in-reserve → RPE)', () => {
  function multiSetSession(): Workout {
    return {
      id: 'cur',
      date: 1,
      status: 'active',
      title: 'Test',
      focus: [],
      startedAt: 1,
      exercises: [
        {
          exerciseId: 'barbell-bench-press',
          targetReps: [8, 12],
          sets: [
            { id: 'w', weight: 45, reps: 10, done: true, warmup: true },
            { id: 'a', weight: 135, reps: 8, done: true },
            { id: 'b', weight: 135, reps: 8, done: true },
            { id: 'c', weight: 135, reps: 8, done: false },
          ],
        },
      ],
    }
  }
  const exercise = () => useStore.getState().current!.exercises[0]

  it('maps reps-in-reserve to an exercise-level RPE (10 − RIR), leaving sets untouched', () => {
    useStore.setState({ current: multiSetSession() })
    useStore.getState().setExerciseEffort('barbell-bench-press', 2)
    expect(exercise().rpe).toBe(8) // 2 more reps left → RPE 8
    // the effort lives on the exercise, not on any individual set
    expect(exercise().sets.every((s) => !('rpe' in s) || s.rpe == null)).toBe(true)
  })

  it('0 RIR → RPE 10, and a high RIR clamps to the RPE-6 floor', () => {
    useStore.setState({ current: multiSetSession() })
    useStore.getState().setExerciseEffort('barbell-bench-press', 0)
    expect(exercise().rpe).toBe(10)
    useStore.getState().setExerciseEffort('barbell-bench-press', 4)
    expect(exercise().rpe).toBe(6) // 4+ caps at the bottom of the scale
  })

  it('clears the effort when passed undefined', () => {
    useStore.setState({ current: multiSetSession() })
    useStore.getState().setExerciseEffort('barbell-bench-press', 1)
    expect(exercise().rpe).toBe(9)
    useStore.getState().setExerciseEffort('barbell-bench-press', undefined)
    expect(exercise().rpe).toBeUndefined()
  })
})

describe('toggleSetDone starts a planned session', () => {
  it('marking a working set done flips a planned session to active', () => {
    const cur = sessionWith(100, false)
    cur.status = 'planned'
    delete (cur as { startedAt?: number }).startedAt
    useStore.setState({ current: cur, restEndsAt: null })
    const id = useStore.getState().current!.exercises[0].sets[0].id
    useStore.getState().toggleSetDone('barbell-bench-press', id)
    const c = useStore.getState().current!
    expect(c.status).toBe('active')
    expect(typeof c.startedAt).toBe('number')
  })
})

describe('finishWorkout stamps bodyweight', () => {
  it('freezes the profile bodyweight onto the completed workout', () => {
    useStore.setState({
      profile: { ...fullGymProfile, bodyweight: 180 },
      current: sessionWith(100, true),
    })
    useStore.getState().finishWorkout()
    expect(useStore.getState().workouts[0].bodyweight).toBe(180)
  })

  it('stamps local performed_on (YYYY-MM-DD) and tzOffsetMin so server analytics bucket by local day', () => {
    useStore.setState({ profile: fullGymProfile, current: sessionWith(100, true) })
    useStore.getState().finishWorkout()
    const w = useStore.getState().workouts[0]
    // tzOffsetMin is the JS local offset (minutes behind UTC) of the completion instant
    expect(w.tzOffsetMin).toBe(new Date(w.completedAt!).getTimezoneOffset())
    // performed_on is that instant's LOCAL calendar day, zero-padded
    const d = new Date(w.completedAt!)
    const pad = (n: number) => String(n).padStart(2, '0')
    expect(w.performed_on).toBe(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
    expect(w.performed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('discards a session where only warm-up sets were completed', () => {
    const cur = sessionWith(100, false)
    cur.exercises[0].sets = [{ id: 'wu', weight: 50, reps: 5, done: true, warmup: true }]
    useStore.setState({ current: cur, workouts: [] })
    useStore.getState().finishWorkout()
    expect(useStore.getState().workouts).toHaveLength(0)
    expect(useStore.getState().current).toBeNull()
  })
})

describe('addWarmupSets', () => {
  it('prepends a 2-set warm-up ramp before the working sets', () => {
    useStore.setState({ profile: { ...fullGymProfile, unit: 'lb' }, current: sessionWith(100, false) })
    useStore.getState().addWarmupSets('barbell-bench-press')
    const sets = useStore.getState().current!.exercises[0].sets
    expect(sets).toHaveLength(3)
    expect(sets[0].warmup).toBe(true)
    expect(sets[1].warmup).toBe(true)
    expect(sets[2].warmup).toBeFalsy() // the original working set, still last
    expect(sets[2].weight).toBe(100)
    expect(sets[0].weight).toBeLessThan(sets[1].weight) // ascending ramp
    expect(sets[1].weight).toBeLessThan(100) // below the working load
  })

  it('is a no-op when warm-ups already exist', () => {
    useStore.setState({ profile: { ...fullGymProfile, unit: 'lb' }, current: sessionWith(100, false) })
    useStore.getState().addWarmupSets('barbell-bench-press')
    useStore.getState().addWarmupSets('barbell-bench-press') // second call must not stack
    expect(useStore.getState().current!.exercises[0].sets).toHaveLength(3)
  })

  it('is a no-op when there is no working load to ramp toward', () => {
    useStore.setState({ profile: { ...fullGymProfile, unit: 'lb' }, current: sessionWith(0, false) })
    useStore.getState().addWarmupSets('barbell-bench-press')
    expect(useStore.getState().current!.exercises[0].sets.some((s) => s.warmup)).toBe(false)
  })
})

describe('setUnit converts frozen workout bodyweight', () => {
  it('converts each completed workout bodyweight on a unit switch', () => {
    useStore.setState({
      profile: { ...fullGymProfile, unit: 'lb' },
      workouts: [{ ...sessionWith(180, true), status: 'completed', completedAt: 1, bodyweight: 180 }],
    })
    useStore.getState().setUnit('kg')
    // 180 lb ~= 81.6 kg
    expect(useStore.getState().workouts[0].bodyweight!).toBeGreaterThan(75)
    expect(useStore.getState().workouts[0].bodyweight!).toBeLessThan(85)
  })
})

describe('toggleSetDone rest timer', () => {
  it('does not start the rest timer for a warm-up set, but does for a working set', () => {
    const cur = sessionWith(100, false)
    cur.exercises[0].sets = [
      { id: 'wu', weight: 50, reps: 10, done: false, warmup: true },
      { id: 'work', weight: 100, reps: 10, done: false },
    ]
    useStore.setState({ current: cur, restEndsAt: null, restDuration: 0 })
    useStore.getState().toggleSetDone('barbell-bench-press', 'wu')
    expect(useStore.getState().restEndsAt).toBeNull()
    useStore.getState().toggleSetDone('barbell-bench-press', 'work')
    expect(useStore.getState().restEndsAt).not.toBeNull()
  })
})

describe('plan generation context', () => {
  it('tags a plan session with planId and the day focus, preserved across regenerate', () => {
    useStore.setState({ activePlan: { planId: 'ppl-6', dayIndex: 0, startedAt: 1 } })
    useStore.getState().generateFromPlan(0)
    let cur = useStore.getState().current!
    expect(cur.planId).toBe('ppl-6')
    expect(cur.genFocus).toEqual(['chest', 'shoulders', 'triceps'])
    // a "regenerate" re-runs from the plan and keeps the tag (so the plan still advances)
    useStore.getState().generateFromPlan(1)
    cur = useStore.getState().current!
    expect(cur.planId).toBe('ppl-6')
  })

  it('records an explicit focus on a non-plan session for regenerate to reuse', () => {
    useStore.setState({ activePlan: null })
    useStore.getState().generate({ focusOverride: ['chest'] })
    expect(useStore.getState().current!.genFocus).toEqual(['chest'])
    expect(useStore.getState().current!.planId).toBeUndefined()
  })
})

describe('swapExercise', () => {
  it('is a no-op when the target exercise is already present (does not delete)', () => {
    const cur = sessionWith(100, false)
    cur.exercises.push({ exerciseId: 'pushup', targetReps: [8, 12], sets: [] })
    useStore.setState({ current: cur })
    useStore.getState().swapExercise('barbell-bench-press', 'pushup')
    const ids = useStore.getState().current!.exercises.map((e) => e.exerciseId)
    expect(ids).toEqual(['barbell-bench-press', 'pushup'])
  })

  it('preserves the block instanceId across a swap (keeps a per-exercise route valid)', () => {
    const cur = { ...sessionWith(135, false) }
    cur.exercises[0].instanceId = 'we_fixed'
    useStore.setState({ workouts: [], current: cur })
    useStore.getState().swapExercise('we_fixed', 'back-squat')
    const swapped = useStore.getState().current!.exercises[0]
    expect(swapped.exerciseId).toBe('back-squat')
    expect(swapped.instanceId).toBe('we_fixed') // same instance id → detail URL still resolves
  })

  it('gives the new exercise its own sets, not the old exercise weights', () => {
    // current bench at 135; swap to a squat with NO history → squat gets its OWN
    // seeded starting weight, never the bench's 135
    useStore.setState({ workouts: [], current: { ...sessionWith(135, false) } })
    useStore.getState().swapExercise('barbell-bench-press', 'back-squat')
    const swapped = useStore.getState().current!.exercises[0]
    expect(swapped.exerciseId).toBe('back-squat')
    expect(swapped.sets.every((s) => s.weight !== 135)).toBe(true) // did not inherit the bench load
    expect(swapped.sets.every((s) => s.weight > 0)).toBe(true) // got its own seeded load
  })

  it('carries LOGGED sets over to the new exercise instead of silently wiping them', () => {
    // one DONE working set at 135 × 10 → must survive the swap (user effort isn't lost)
    const cur = sessionWith(135, true)
    cur.exercises[0].instanceId = 'we_carry'
    useStore.setState({ workouts: [], current: cur })
    useStore.getState().swapExercise('we_carry', 'back-squat')
    const swapped = useStore.getState().current!.exercises[0]
    expect(swapped.exerciseId).toBe('back-squat')
    const doneSets = swapped.sets.filter((s) => s.done && !s.warmup)
    expect(doneSets.length).toBeGreaterThanOrEqual(1)
    expect(doneSets[0]).toMatchObject({ weight: 135, reps: 10, done: true })
  })
})

describe('generate clears a stale rest timer', () => {
  it('resets restEndsAt/restDuration when a new session is generated', () => {
    useStore.setState({ restEndsAt: Date.now() + 60000, restDuration: 90, current: null })
    useStore.getState().generate()
    expect(useStore.getState().restEndsAt).toBeNull()
    expect(useStore.getState().restDuration).toBe(0)
  })
})

describe('removeSet keeps a working set finishable', () => {
  function withSets(sets: Workout['exercises'][0]['sets']): Workout {
    const w = sessionWith(100, false)
    w.exercises[0].sets = sets
    return w
  }

  it('refuses to delete the last WORKING set even when warm-ups remain', () => {
    useStore.setState({
      current: withSets([
        { id: 'wu1', weight: 50, reps: 5, done: false, warmup: true },
        { id: 'wu2', weight: 70, reps: 3, done: false, warmup: true },
        { id: 'work', weight: 100, reps: 10, done: false },
      ]),
    })
    useStore.getState().removeSet('barbell-bench-press', 'work')
    const sets = useStore.getState().current!.exercises[0].sets
    // the last working set survives — the exercise can't be left as 0/0 (silently dropped on finish)
    expect(sets.some((s) => !s.warmup)).toBe(true)
    expect(sets.find((s) => s.id === 'work')).toBeDefined()
  })

  it('still allows deleting a warm-up set', () => {
    useStore.setState({
      current: withSets([
        { id: 'wu1', weight: 50, reps: 5, done: false, warmup: true },
        { id: 'work', weight: 100, reps: 10, done: false },
      ]),
    })
    useStore.getState().removeSet('barbell-bench-press', 'wu1')
    const sets = useStore.getState().current!.exercises[0].sets
    expect(sets.find((s) => s.id === 'wu1')).toBeUndefined()
    expect(sets).toHaveLength(1)
  })
})

describe('mergePersisted hardens malformed blobs', () => {
  const base = (): AppState =>
    ({
      profile: { ...fullGymProfile },
      workouts: [],
      current: null,
      activePlan: null,
      restEndsAt: null,
      restDuration: 0,
    }) as unknown as AppState

  it('drops a completed workout whose exercise has no sets array (would crash recovery/history)', () => {
    const persisted = {
      workouts: [
        {
          id: 'bad',
          date: 1,
          status: 'completed',
          title: 'corrupt',
          focus: [],
          exercises: [{ exerciseId: 'barbell-bench-press', targetReps: [8, 12] /* sets missing */ }],
        },
      ],
    }
    const merged = mergePersisted(persisted, base())
    expect(merged.workouts).toHaveLength(0)
  })

  it('keeps a well-formed workout untouched', () => {
    const good: Workout = {
      id: 'ok',
      date: 1,
      status: 'completed',
      title: 'fine',
      focus: [],
      completedAt: 1,
      exercises: [
        { exerciseId: 'barbell-bench-press', targetReps: [8, 12], sets: [{ id: 'a', weight: 135, reps: 8, done: true }] },
      ],
    }
    const merged = mergePersisted({ workouts: [good] }, base())
    expect(merged.workouts).toHaveLength(1)
    expect(merged.workouts[0].id).toBe('ok')
  })

  it('nulls a current session whose exercise is missing sets, instead of hydrating a crash', () => {
    const persisted = {
      current: {
        id: 'cur',
        date: 1,
        status: 'active',
        title: 'corrupt',
        focus: [],
        exercises: [{ exerciseId: 'barbell-bench-press', targetReps: [8, 12] /* sets missing */ }],
      },
    }
    const merged = mergePersisted(persisted, base())
    expect(merged.current).toBeNull()
  })

  it('drops an exercise with a null set element (unsalvageable), but REPAIRS a non-2-tuple targetReps', () => {
    const mk = (exercises: unknown) => ({
      workouts: [{ id: 'x', date: 1, status: 'completed', title: 't', focus: [], exercises }],
    })
    // a null/garbage set element can't be invented back → exercise filtered → no exercises left → drop
    expect(
      mergePersisted(mk([{ exerciseId: 'barbell-bench-press', targetReps: [8, 12], sets: [null] }]), base()).workouts,
    ).toHaveLength(0)
    // a non-2-tuple targetReps is cheaply repairable → default to [8,12] and KEEP the session
    const repaired = mergePersisted(
      mk([{ exerciseId: 'barbell-bench-press', targetReps: [8], sets: [] }]),
      base(),
    ).workouts
    expect(repaired).toHaveLength(1)
    expect(repaired[0].exercises[0].targetReps).toEqual([8, 12])
  })

  it('snaps an out-of-enum goal/experience/unit back to the defaults (no crash / no a11y trap)', () => {
    const merged = mergePersisted(
      { profile: { ...fullGymProfile, goal: 'bogus', experience: 'pro', unit: 'stone' } },
      base(),
    )
    expect(merged.profile.goal).toBe(fullGymProfile.goal)
    expect(merged.profile.experience).toBe(fullGymProfile.experience)
    expect(merged.profile.unit).toBe(fullGymProfile.unit)
  })

  it('keeps a valid persisted goal/experience/unit', () => {
    const merged = mergePersisted(
      { profile: { ...fullGymProfile, goal: 'powerlifting', experience: 'advanced', unit: 'kg' } },
      base(),
    )
    expect(merged.profile.goal).toBe('powerlifting')
    expect(merged.profile.experience).toBe('advanced')
    expect(merged.profile.unit).toBe('kg')
  })
})

describe('adjustRest anchors to the live clock', () => {
  it('+15 on an already-elapsed timer adds real remaining time (not a stale-anchored no-op)', () => {
    useStore.setState({ restEndsAt: Date.now() - 30000, restDuration: 90 }) // ended 30s ago
    useStore.getState().adjustRest(15)
    const { restEndsAt, restDuration } = useStore.getState()
    const remaining = (restEndsAt! - Date.now()) / 1000
    expect(remaining).toBeGreaterThan(10) // ~15s of real time, not 0
    expect(remaining).toBeLessThan(20)
    // duration tracks the actual remaining time, not inflated (was 90+15=105 before the fix)
    expect(restDuration).toBeLessThanOrEqual(17)
  })

  it('-15 removes 15s of remaining time and keeps restDuration in sync with the clock', () => {
    useStore.setState({ restEndsAt: Date.now() + 60000, restDuration: 90 })
    useStore.getState().adjustRest(-15)
    const { restEndsAt, restDuration } = useStore.getState()
    const remaining = (restEndsAt! - Date.now()) / 1000
    expect(remaining).toBeGreaterThan(40) // ~45s
    expect(remaining).toBeLessThan(50)
    expect(Math.abs(restDuration - remaining)).toBeLessThan(3) // duration ≈ remaining → correct progress bar
  })

  it('is a no-op when no rest timer is running', () => {
    useStore.setState({ restEndsAt: null, restDuration: 0 })
    useStore.getState().adjustRest(15)
    expect(useStore.getState().restEndsAt).toBeNull()
  })
})

describe('skipPlanDay', () => {
  it('untags an in-progress plan session so finishing it cannot advance the wrong day', () => {
    const cur = { ...sessionWith(100, false), planId: 'ppl-6', planDayLabel: 'Day 1 · Push (Strength)' }
    useStore.setState({ activePlan: { planId: 'ppl-6', dayIndex: 0, startedAt: 1 }, current: cur })
    useStore.getState().skipPlanDay()
    expect(useStore.getState().activePlan!.dayIndex).toBe(1)
    expect(useStore.getState().current!.planId).toBeUndefined()
  })
})

// Repro for the "next workout does not load" report: a bodyweight-only user following a barbell
// plan (bro-split-5) lands, after finishing a day, on days whose explicit lifts can't be equipped.
// generateFromPlan must STILL produce a usable bodyweight session (focus fallback) for every day —
// the home hero preview mirrors this, so an empty preview would be the bug.
describe('generateFromPlan never leaves an empty session on an equipment-mismatched plan', () => {
  it('builds a usable, all-bodyweight session for every bro-split-5 day', () => {
    const bw = { ...fullGymProfile, equipment: ['bodyweight'] as Equipment[] }
    const plan = getPlan('bro-split-5')!
    const owned = new Set<Equipment>(['bodyweight'])
    for (let di = 0; di < plan.schedule.length; di++) {
      useStore.setState({
        profile: bw,
        activePlan: { planId: 'bro-split-5', dayIndex: di, startedAt: 1 },
        current: null,
        workouts: [],
      })
      useStore.getState().generateFromPlan()
      const cur = useStore.getState().current
      expect(cur, `day ${di} (${plan.schedule[di].title}) produced no session`).not.toBeNull()
      expect(cur!.exercises.length, `day ${di} session is empty`).toBeGreaterThan(0)
      for (const we of cur!.exercises) {
        const ex = getExercise(we.exerciseId)!
        expect(isExerciseDoable(ex, owned), `${we.exerciseId} not bodyweight-doable on day ${di}`).toBe(true)
      }
    }
  })
})

describe('setUnit feedback toast', () => {
  it('emits a toast when the unit actually changes, but not on a no-op', async () => {
    const { subscribeToast } = await import('../lib/toast')
    const msgs: string[] = []
    const unsub = subscribeToast((t) => msgs.push(t.message))
    useStore.setState({ profile: { ...fullGymProfile, unit: 'lb' }, workouts: [] })
    useStore.getState().setUnit('lb') // same unit → no conversion, no toast
    expect(msgs).toHaveLength(0)
    useStore.getState().setUnit('kg') // real change → toast
    expect(msgs.some((m) => /kilograms/i.test(m))).toBe(true)
    unsub()
  })
})

describe('repeatWorkout (clone a past session)', () => {
  it('clones a completed workout into a fresh planned session, resetting sets and dropping plan/completion links', () => {
    const past: Workout = {
      id: 'past1', date: 1, status: 'completed', title: 'Push', focus: ['chest'],
      completedAt: 100, durationMin: 45, startedAt: 50, planId: 'ppl-6', planDayLabel: 'Day 1',
      exercises: [
        {
          exerciseId: 'barbell-bench-press',
          instanceId: 'we-old',
          targetReps: [5, 5],
          sets: [
            { id: 'a', weight: 185, reps: 5, done: true },
            { id: 'b', weight: 185, reps: 5, done: true },
          ],
        },
      ],
    }
    useStore.setState({ workouts: [past], current: null })
    expect(useStore.getState().repeatWorkout('past1')).toBe(true)
    const cur = useStore.getState().current!
    expect(cur.status).toBe('planned')
    expect(cur.id).not.toBe('past1')
    expect(cur.completedAt).toBeUndefined()
    expect(cur.durationMin).toBeUndefined()
    expect(cur.startedAt).toBeUndefined()
    expect(cur.planId).toBeUndefined() // standalone repeat must not advance plan rotation
    expect(cur.planDayLabel).toBeUndefined()
    // loads preserved, all sets reset to undone with fresh ids + a fresh instanceId
    expect(cur.exercises).toHaveLength(1)
    const we = cur.exercises[0]
    expect(we.exerciseId).toBe('barbell-bench-press')
    expect(we.instanceId).not.toBe('we-old')
    expect(we.sets.every((s) => !s.done)).toBe(true)
    expect(we.sets.map((s) => s.weight)).toEqual([185, 185])
    expect(we.sets.map((s) => s.id)).not.toContain('a')
    // the original history entry is unchanged
    expect(useStore.getState().workouts[0].exercises[0].sets[0].done).toBe(true)
  })

  it('returns false and leaves current untouched for an unknown id', () => {
    useStore.setState({ workouts: [], current: null })
    expect(useStore.getState().repeatWorkout('nope')).toBe(false)
    expect(useStore.getState().current).toBeNull()
  })
})

// Starting a plan day from the Plans screen must produce a LIVE session (timer running),
// matching Home — generateFromPlan() builds it, startWorkout() puts it underway.
describe('starting a plan day is a live session', () => {
  it('generateFromPlan + startWorkout yields an active, timed session for the day', () => {
    useStore.getState().addCustomPlan(customPlan('cstart'))
    useStore.getState().startPlan('cstart')
    // built-but-not-started: status is 'planned' until the user hits Start
    useStore.getState().generateFromPlan()
    expect(useStore.getState().current!.status).not.toBe('active')

    useStore.getState().startWorkout()
    const cur = useStore.getState().current!
    expect(cur.status).toBe('active')
    expect(cur.startedAt).toBeGreaterThan(0)
    expect(cur.planId).toBe('cstart')
  })
})

// "Replace in my plan" swap: future sessions of this plan day use the new exercise, WITHOUT
// editing the saved plan, and only while this plan is active.
describe('replaceInActivePlan (swap for the active plan)', () => {
  function setupPlanSession() {
    useStore.getState().addCustomPlan(customPlan('cov'))
    useStore.getState().startPlan('cov')
    useStore.getState().generateFromPlan()
  }

  it('records an override and future plan generations use the new exercise (plan def untouched)', () => {
    setupPlanSession()
    const cur0 = useStore.getState().current!
    const bench = cur0.exercises.find((e) => e.exerciseId === 'barbell-bench-press')!
    expect(bench).toBeTruthy()
    expect(bench.planLiftId).toBe('barbell-bench-press') // stamped for re-keying

    useStore.getState().replaceInActivePlan('barbell-bench-press', 'incline-bench-press')
    expect(useStore.getState().planOverrides['cov']['Day 1::barbell-bench-press']).toBe('incline-bench-press')

    // regenerate the plan day → now built with the override
    useStore.getState().generateFromPlan()
    const cur1 = useStore.getState().current!
    expect(cur1.exercises.some((e) => e.exerciseId === 'incline-bench-press')).toBe(true)
    expect(cur1.exercises.some((e) => e.exerciseId === 'barbell-bench-press')).toBe(false)
    // the override-built block still keys back to the plan's ORIGINAL lift
    expect(cur1.exercises.find((e) => e.exerciseId === 'incline-bench-press')!.planLiftId).toBe('barbell-bench-press')

    // the SAVED plan is never modified
    const saved = useStore.getState().customPlans.find((p) => p.id === 'cov')!
    expect(saved.schedule[0].lifts![0].exerciseId).toBe('barbell-bench-press')
  })

  it('swapping back to the plan original clears the override', () => {
    setupPlanSession()
    useStore.getState().replaceInActivePlan('barbell-bench-press', 'incline-bench-press')
    useStore.getState().replaceInActivePlan('barbell-bench-press', 'barbell-bench-press')
    expect(useStore.getState().planOverrides['cov']?.['Day 1::barbell-bench-press']).toBeUndefined()
  })

  it('deleting the plan drops its overrides; reset clears all', () => {
    setupPlanSession()
    useStore.getState().replaceInActivePlan('barbell-bench-press', 'incline-bench-press')
    useStore.getState().deleteCustomPlan('cov')
    expect(useStore.getState().planOverrides['cov']).toBeUndefined()
  })

  it('does nothing when the session is not bound to the active plan', () => {
    useStore.setState({ activePlan: null, current: null, planOverrides: {} })
    useStore.getState().replaceInActivePlan('barbell-bench-press', 'incline-bench-press')
    expect(useStore.getState().planOverrides).toEqual({})
  })
})

// Editing a working set's weight/reps should flow forward to the following sets the user hasn't
// individually changed — the "set my working weight once and the rest follow" UX.
describe('updateSetCascade (weight/reps flows to following sets)', () => {
  type SetSpec = { id: string; weight: number; reps: number; done?: boolean; warmup?: boolean }
  function loadSession(sets: SetSpec[]) {
    useStore.setState({
      current: {
        id: 'cur', date: 1, status: 'active', title: 'Test', focus: [], startedAt: 1,
        exercises: [{ exerciseId: 'barbell-bench-press', instanceId: 'blk', targetReps: [8, 12],
          sets: sets.map((s) => ({ done: false, ...s })) }],
      } as Workout,
    })
  }
  const sets = () => useStore.getState().current!.exercises[0].sets

  it('copies a weight edit forward to in-sync, not-yet-done working sets', () => {
    loadSession([
      { id: '1', weight: 100, reps: 5 },
      { id: '2', weight: 100, reps: 5 },
      { id: '3', weight: 100, reps: 5 },
    ])
    useStore.getState().updateSetCascade('blk', '1', { weight: 110 })
    expect(sets().map((s) => s.weight)).toEqual([110, 110, 110])
  })

  it('leaves a deliberately-different back-off set alone', () => {
    loadSession([
      { id: '1', weight: 100, reps: 5 },
      { id: '2', weight: 100, reps: 5 },
      { id: '3', weight: 80, reps: 8 }, // a back-off set the user set differently
    ])
    useStore.getState().updateSetCascade('blk', '1', { weight: 110 })
    expect(sets().map((s) => s.weight)).toEqual([110, 110, 80])
  })

  it('never overwrites a completed (done) set', () => {
    loadSession([
      { id: '1', weight: 100, reps: 5 },
      { id: '2', weight: 100, reps: 5, done: true }, // already logged
      { id: '3', weight: 100, reps: 5 },
    ])
    useStore.getState().updateSetCascade('blk', '1', { weight: 110 })
    expect(sets().map((s) => s.weight)).toEqual([110, 100, 110])
  })

  it('only flows FORWARD — earlier sets are untouched', () => {
    loadSession([
      { id: '1', weight: 100, reps: 5 },
      { id: '2', weight: 100, reps: 5 },
      { id: '3', weight: 100, reps: 5 },
    ])
    useStore.getState().updateSetCascade('blk', '2', { weight: 120 })
    expect(sets().map((s) => s.weight)).toEqual([100, 120, 120])
  })

  it('cascades reps independently of weight', () => {
    loadSession([
      { id: '1', weight: 100, reps: 8 },
      { id: '2', weight: 100, reps: 8 },
    ])
    useStore.getState().updateSetCascade('blk', '1', { reps: 5 })
    expect(sets().map((s) => s.reps)).toEqual([5, 5])
    expect(sets().map((s) => s.weight)).toEqual([100, 100]) // weights unchanged
  })

  it('fills an empty (0) following set', () => {
    loadSession([
      { id: '1', weight: 100, reps: 5 },
      { id: '2', weight: 0, reps: 5 }, // freshly added, unset weight
    ])
    useStore.getState().updateSetCascade('blk', '1', { weight: 105 })
    expect(sets().map((s) => s.weight)).toEqual([105, 105])
  })

  it('does not cascade warm-up edits and skips warm-ups when a working set cascades', () => {
    loadSession([
      { id: 'w', weight: 45, reps: 5, warmup: true },
      { id: '1', weight: 100, reps: 5 },
      { id: '2', weight: 100, reps: 5 },
    ])
    // a warm-up edit stays local (warm-ups are a deliberate ramp)
    useStore.getState().updateSetCascade('blk', 'w', { weight: 55 })
    expect(sets().map((s) => s.weight)).toEqual([55, 100, 100])
    // a working-set edit cascades to working sets but never touches the warm-up
    useStore.getState().updateSetCascade('blk', '1', { weight: 110 })
    expect(sets().map((s) => s.weight)).toEqual([55, 110, 110])
  })
})

// Destructive deletes (set / exercise / workout) must be reversible: each emits an Undo toast whose
// action restores the removed item at its original position. Guards against silent data loss.
describe('undo for destructive deletes', () => {
  type SetSpec = { id: string; weight: number; reps: number; done?: boolean; warmup?: boolean }
  function loadSession(blocks: { instanceId: string; sets: SetSpec[] }[]) {
    useStore.setState({
      current: {
        id: 'cur', date: 1, status: 'active', title: 'Test', focus: [], startedAt: 1,
        exercises: blocks.map((b) => ({
          exerciseId: 'barbell-bench-press', instanceId: b.instanceId, targetReps: [8, 12],
          sets: b.sets.map((s) => ({ done: false, ...s })),
        })),
      } as Workout,
    })
  }
  function captureToast(fn: () => void): ToastData | null {
    let captured: ToastData | null = null
    const unsub = subscribeToast((t) => { captured = t })
    fn()
    unsub()
    return captured
  }
  const wk = (id: string): Workout => ({ id, date: 1, status: 'completed', title: id, focus: [], exercises: [] })

  it('removeSet emits an Undo toast that restores the set at its position', () => {
    loadSession([{ instanceId: 'blk', sets: [
      { id: '1', weight: 100, reps: 5 },
      { id: '2', weight: 110, reps: 6 },
      { id: '3', weight: 120, reps: 7 },
    ] }])
    const toast = captureToast(() => useStore.getState().removeSet('blk', '2'))
    expect(useStore.getState().current!.exercises[0].sets.map((s) => s.id)).toEqual(['1', '3'])
    expect(toast?.action?.label).toBe('Undo')

    toast!.action!.onAction()
    const restored = useStore.getState().current!.exercises[0].sets
    expect(restored.map((s) => s.id)).toEqual(['1', '2', '3']) // back at index 1
    expect(restored[1]).toMatchObject({ weight: 110, reps: 6 })
  })

  it('does NOT emit an Undo toast when removeSet is blocked (last working set)', () => {
    loadSession([{ instanceId: 'blk', sets: [{ id: 'only', weight: 100, reps: 5 }] }])
    const toast = captureToast(() => useStore.getState().removeSet('blk', 'only'))
    expect(useStore.getState().current!.exercises[0].sets).toHaveLength(1) // guard kept it
    expect(toast).toBeNull()
  })

  it('removeExercise emits an Undo toast that restores the block at its position', () => {
    loadSession([
      { instanceId: 'a', sets: [{ id: 'a1', weight: 100, reps: 5 }] },
      { instanceId: 'b', sets: [{ id: 'b1', weight: 50, reps: 8 }] },
      { instanceId: 'c', sets: [{ id: 'c1', weight: 60, reps: 8 }] },
    ])
    const toast = captureToast(() => useStore.getState().removeExercise('b'))
    expect(useStore.getState().current!.exercises.map((e) => e.instanceId)).toEqual(['a', 'c'])
    expect(toast?.action?.label).toBe('Undo')

    toast!.action!.onAction()
    expect(useStore.getState().current!.exercises.map((e) => e.instanceId)).toEqual(['a', 'b', 'c'])
  })

  it('deleteWorkout emits an Undo toast that restores the workout at its position', () => {
    useStore.setState({ workouts: [wk('A'), wk('B'), wk('C')] })
    const toast = captureToast(() => useStore.getState().deleteWorkout('B'))
    expect(useStore.getState().workouts.map((w) => w.id)).toEqual(['A', 'C'])
    expect(toast?.action?.label).toBe('Undo')

    toast!.action!.onAction()
    expect(useStore.getState().workouts.map((w) => w.id)).toEqual(['A', 'B', 'C'])
  })

  it('undo is idempotent — invoking it twice does not duplicate the restored item', () => {
    loadSession([{ instanceId: 'blk', sets: [
      { id: '1', weight: 100, reps: 5 },
      { id: '2', weight: 110, reps: 6 },
    ] }])
    const toast = captureToast(() => useStore.getState().removeSet('blk', '2'))
    toast!.action!.onAction()
    toast!.action!.onAction() // second tap must be a no-op
    expect(useStore.getState().current!.exercises[0].sets.map((s) => s.id)).toEqual(['1', '2'])
  })
})

// reorderExercise must never split a superset/circuit: groups are CONSECUTIVE same-`group` runs, so
// moving a member out of its run (or into the middle of a neighbor's run) would dissolve the bracket.
describe('reorderExercise keeps supersets contiguous', () => {
  // a session of single-exercise blocks; `group` is carried per block so we can build a superset
  function loadBlocks(blocks: { exerciseId: string; instanceId: string; group?: string }[]) {
    useStore.setState({
      current: {
        id: 'cur', date: 1, status: 'active', title: 'Test', focus: [], startedAt: 1,
        exercises: blocks.map((b) => ({
          exerciseId: b.exerciseId, instanceId: b.instanceId, group: b.group, targetReps: [8, 12],
          sets: [{ id: b.instanceId + '-s', weight: 100, reps: 8, done: false }],
        })),
      } as Workout,
    })
  }
  const order = () => useStore.getState().current!.exercises.map((e) => e.instanceId)
  // the consecutive runs of same-group ids, as the UI would bracket them
  const runs = () => {
    const out: string[][] = []
    for (const e of useStore.getState().current!.exercises) {
      const last = out[out.length - 1]
      const g = e.group
      if (g && last && useStore.getState().current!.exercises.find((x) => x.instanceId === last[0])!.group === g)
        last.push(e.instanceId!)
      else out.push([e.instanceId!])
    }
    return out
  }

  it('moves a whole superset as a unit, keeping its members adjacent', () => {
    // [solo, A1, A2] — moving A1 up must carry A2 with it, not split the pair
    loadBlocks([
      { exerciseId: 'overhead-press', instanceId: 'solo' },
      { exerciseId: 'barbell-bench-press', instanceId: 'a1', group: 'A' },
      { exerciseId: 'pushup', instanceId: 'a2', group: 'A' },
    ])
    useStore.getState().reorderExercise('a1', -1)
    expect(order()).toEqual(['a1', 'a2', 'solo']) // pair moved together, ahead of the solo
    // the superset is still one contiguous run
    expect(runs().some((r) => r.length === 2 && r.includes('a1') && r.includes('a2'))).toBe(true)
  })

  it('moving a solo DOWN past a superset steps over the whole group (never lands mid-bracket)', () => {
    // [solo, A1, A2] — moving solo down must jump the ENTIRE A group, not split it (solo between A1/A2)
    loadBlocks([
      { exerciseId: 'overhead-press', instanceId: 'solo' },
      { exerciseId: 'barbell-bench-press', instanceId: 'a1', group: 'A' },
      { exerciseId: 'pushup', instanceId: 'a2', group: 'A' },
    ])
    useStore.getState().reorderExercise('solo', 1)
    expect(order()).toEqual(['a1', 'a2', 'solo']) // solo cleared the whole group
    expect(runs().some((r) => r.length === 2 && r[0] === 'a1' && r[1] === 'a2')).toBe(true)
  })

  it('moving a superset DOWN past a solo keeps the pair intact', () => {
    // [A1, A2, solo] — moving A1 down carries A2 and steps over the solo as a unit
    loadBlocks([
      { exerciseId: 'barbell-bench-press', instanceId: 'a1', group: 'A' },
      { exerciseId: 'pushup', instanceId: 'a2', group: 'A' },
      { exerciseId: 'overhead-press', instanceId: 'solo' },
    ])
    useStore.getState().reorderExercise('a1', 1)
    expect(order()).toEqual(['solo', 'a1', 'a2'])
    expect(runs().some((r) => r.length === 2 && r[0] === 'a1' && r[1] === 'a2')).toBe(true)
  })

  it('still reorders ordinary (ungrouped) exercises one slot at a time', () => {
    loadBlocks([
      { exerciseId: 'overhead-press', instanceId: 'x' },
      { exerciseId: 'barbell-bench-press', instanceId: 'y' },
      { exerciseId: 'pushup', instanceId: 'z' },
    ])
    useStore.getState().reorderExercise('y', 1)
    expect(order()).toEqual(['x', 'z', 'y'])
  })
})

// Renaming the day a followed in-progress session is tied to must keep the session attached: Home's
// currentIsPlanDay matches on day LABEL, so a stale planDayLabel silently detaches the session.
describe('updateCustomPlan remaps a followed session to the renamed day', () => {
  function multiDay(id: string): WorkoutPlan {
    const day = (label: string): WorkoutPlan['schedule'][number] => ({
      label, title: label, focus: ['chest'], goal: 'strength',
      lifts: [{ exerciseId: 'barbell-bench-press', sets: 3, repMin: 5, repMax: 5 }],
    })
    return { ...customPlan(id), schedule: [day('Day 1'), day('Day 2')] }
  }

  it('remaps current.planDayLabel to the SAME position’s new label so the session stays tied', () => {
    const plan = multiDay('crelabel')
    // following day index 1 ("Day 2"), with a live session tagged to that day
    const cur = { ...sessionWith(100, false), planId: 'crelabel', planDayLabel: 'Day 2' }
    useStore.setState({ customPlans: [plan], activePlan: { planId: 'crelabel', dayIndex: 1, startedAt: 1 }, current: cur })
    // rename day index 1's label
    const renamed: WorkoutPlan = {
      ...plan,
      schedule: [plan.schedule[0], { ...plan.schedule[1], label: 'Heavy Bench', title: 'Heavy Bench' }],
    }
    useStore.getState().updateCustomPlan('crelabel', renamed)
    // the session followed the day at index 1 → its label is remapped to the new one (not left stale)
    expect(useStore.getState().current!.planDayLabel).toBe('Heavy Bench')
    expect(useStore.getState().current!.planId).toBe('crelabel') // still tied to the plan
  })

  it('does not touch a session that is not following this plan', () => {
    const plan = multiDay('crelabel2')
    const cur = { ...sessionWith(100, false), planId: 'other-plan', planDayLabel: 'Day 2' }
    useStore.setState({ customPlans: [plan], activePlan: { planId: 'crelabel2', dayIndex: 1, startedAt: 1 }, current: cur })
    useStore.getState().updateCustomPlan('crelabel2', { ...plan, schedule: [plan.schedule[0], { ...plan.schedule[1], label: 'X', title: 'X' }] })
    expect(useStore.getState().current!.planDayLabel).toBe('Day 2') // unrelated session untouched
  })
})

describe('mergePersisted repairs legacy/partly-malformed sessions', () => {
  const base = (): AppState =>
    ({
      profile: { ...fullGymProfile },
      workouts: [],
      current: null,
      activePlan: null,
      restEndsAt: null,
      restDuration: 0,
    }) as unknown as AppState

  it('defaults a legacy exercise missing targetReps to [8,12] instead of dropping the whole session', () => {
    const persisted = {
      workouts: [
        {
          id: 'legacy', date: 1, status: 'completed', title: 'old', focus: [],
          exercises: [
            // persisted before targetReps existed — repairable, must NOT take the session down with it
            { exerciseId: 'barbell-bench-press', sets: [{ id: 'a', weight: 135, reps: 8, done: true }] },
          ],
        },
      ],
    }
    const merged = mergePersisted(persisted, base())
    expect(merged.workouts).toHaveLength(1)
    expect(merged.workouts[0].exercises[0].targetReps).toEqual([8, 12])
  })

  it('keeps a current session when only SOME exercises are malformed (filters the bad, keeps the good)', () => {
    const persisted = {
      current: {
        id: 'cur', date: 1, status: 'active', title: 'mixed', focus: [],
        exercises: [
          { exerciseId: 'barbell-bench-press', targetReps: [8, 12], sets: [{ id: 'a', weight: 135, reps: 8, done: false }] },
          { exerciseId: 'broken', targetReps: [5, 5] /* sets missing → unsalvageable */ },
        ],
      },
    }
    const merged = mergePersisted(persisted, base())
    expect(merged.current).not.toBeNull()
    expect(merged.current!.exercises.map((e) => e.exerciseId)).toEqual(['barbell-bench-press'])
  })

  it('nulls a session only when NO exercise survives the repair', () => {
    const persisted = {
      current: {
        id: 'cur', date: 1, status: 'active', title: 'allbad', focus: [],
        exercises: [{ exerciseId: 'broken', targetReps: [5, 5] /* sets missing */ }],
      },
    }
    expect(mergePersisted(persisted, base()).current).toBeNull()
  })
})

// On a bodyweight/unloaded exercise, 0 lb is a deliberate value — the cascade's "fill an empty 0"
// convenience must not overwrite the user's following bodyweight sets.
describe('updateSetCascade respects a deliberate 0 lb on bodyweight exercises', () => {
  function loadBodyweight(sets: { id: string; weight: number; reps: number; done?: boolean }[]) {
    useStore.setState({
      current: {
        id: 'cur', date: 1, status: 'active', title: 'Test', focus: [], startedAt: 1,
        exercises: [{ exerciseId: 'pushup', instanceId: 'blk', targetReps: [8, 12],
          sets: sets.map((s) => ({ done: false, ...s })) }],
      } as Workout,
    })
  }
  const sets = () => useStore.getState().current!.exercises[0].sets

  it('does not clobber a following 0 lb set when editing reps on a bodyweight lift', () => {
    loadBodyweight([
      { id: '1', weight: 0, reps: 10 },
      { id: '2', weight: 0, reps: 10 }, // deliberate bodyweight set, not "empty"
    ])
    useStore.getState().updateSetCascade('blk', '1', { reps: 12 })
    // reps cascade as usual, but the 0 lb weight is left untouched (not filled to anything)
    expect(sets().map((s) => s.reps)).toEqual([12, 12])
    expect(sets().map((s) => s.weight)).toEqual([0, 0])
  })

  it('cascades a real weight change on a bodyweight lift to in-sync 0 lb sets', () => {
    // weighted pull-up/push-up style: bumping set 1 from 0 → 25 still flows to the matching 0 sets,
    // because they equal the PRE-edit value (0), not because of the bare 0-fill
    loadBodyweight([
      { id: '1', weight: 0, reps: 8 },
      { id: '2', weight: 0, reps: 8 },
    ])
    useStore.getState().updateSetCascade('blk', '1', { weight: 25 })
    expect(sets().map((s) => s.weight)).toEqual([25, 25])
  })

  it('still fills a fresh 0-weight set on a LOADED exercise (unchanged behavior)', () => {
    // sanity: the bug fix is scoped to bodyweight lifts; a barbell lift keeps the 0-fill convenience
    useStore.setState({
      current: {
        id: 'cur', date: 1, status: 'active', title: 'Test', focus: [], startedAt: 1,
        exercises: [{ exerciseId: 'barbell-bench-press', instanceId: 'blk', targetReps: [8, 12],
          sets: [
            { id: '1', weight: 100, reps: 5, done: false },
            { id: '2', weight: 0, reps: 5, done: false },
          ] }],
      } as Workout,
    })
    useStore.getState().updateSetCascade('blk', '1', { weight: 105 })
    expect(useStore.getState().current!.exercises[0].sets.map((s) => s.weight)).toEqual([105, 105])
  })
})

describe('setWorkoutNote', () => {
  const wk = (id: string, note?: string): Workout => ({
    id,
    date: 1,
    status: 'completed',
    title: 't',
    focus: [],
    exercises: [],
    ...(note ? { note } : {}),
  })

  it('sets a trimmed note, updates it, and clears it on a blank value', () => {
    useStore.setState({ workouts: [wk('w1'), wk('w2', 'old')] })
    useStore.getState().setWorkoutNote('w1', '  felt strong  ')
    expect(useStore.getState().workouts.find((w) => w.id === 'w1')!.note).toBe('felt strong')

    useStore.getState().setWorkoutNote('w2', 'updated')
    expect(useStore.getState().workouts.find((w) => w.id === 'w2')!.note).toBe('updated')

    useStore.getState().setWorkoutNote('w2', '   ') // blank → clears
    const w2 = useStore.getState().workouts.find((w) => w.id === 'w2')!
    expect(w2.note).toBeUndefined()
    expect('note' in w2).toBe(false) // field dropped entirely, not left as ''
  })

  it('is a no-op for an unknown id and leaves other notes intact', () => {
    useStore.setState({ workouts: [wk('w1', 'keep')] })
    const before = useStore.getState().workouts
    useStore.getState().setWorkoutNote('nope', 'x')
    expect(useStore.getState().workouts).toBe(before) // unchanged reference (returned {})
    expect(useStore.getState().workouts[0].note).toBe('keep')
  })
})

describe('restSecondsFor (rest-timer default vs override)', () => {
  it('returns the goal-tuned default when no override is set', () => {
    expect(restSecondsFor({ goal: 'strength' })).toBe(165)
    expect(restSecondsFor({ goal: 'powerlifting' })).toBe(165)
    expect(restSecondsFor({ goal: 'endurance' })).toBe(45)
    expect(restSecondsFor({ goal: 'hypertrophy' })).toBe(90)
    expect(restSecondsFor({ goal: 'general' })).toBe(90)
  })

  it('uses the user override when set, ignoring the goal', () => {
    expect(restSecondsFor({ goal: 'endurance', restSeconds: 120 })).toBe(120)
    expect(restSecondsFor({ goal: 'strength', restSeconds: 60 })).toBe(60)
  })

  it('falls back to the goal default for a non-positive override', () => {
    expect(restSecondsFor({ goal: 'hypertrophy', restSeconds: 0 })).toBe(90)
    expect(restSecondsFor({ goal: 'strength', restSeconds: -5 })).toBe(165)
  })

  it('toggleSetDone auto-starts the rest timer using the override', () => {
    useStore.setState({ profile: { ...fullGymProfile, restSeconds: 120 }, current: sessionWith(100, false) })
    useStore.getState().toggleSetDone('barbell-bench-press', 'a')
    expect(useStore.getState().restDuration).toBe(120)
  })
})

describe('exercise-level RPE', () => {
  it('preserves the exercise rpe on the completed workout through finishWorkout', () => {
    const cur = sessionWith(100, true)
    cur.exercises[0].rpe = 9
    useStore.setState({ profile: fullGymProfile, current: cur, workouts: [] })
    useStore.getState().finishWorkout()
    expect(useStore.getState().workouts[0].exercises[0].rpe).toBe(9)
  })
})

describe('mergePersisted — profile numeric sanitization (corrupt-blob hardening)', () => {
  const cur = () => useStore.getState() as AppState
  const merge = (patch: Record<string, unknown>) =>
    mergePersisted({ profile: { ...cur().profile, ...patch } }, cur()).profile

  it('preserves the effects (sound & haptics) preference through update + hydration', () => {
    useStore.getState().updateProfile({ effects: false })
    expect(useStore.getState().profile.effects).toBe(false)
    expect(merge({ effects: false }).effects).toBe(false)
    expect(merge({ effects: true }).effects).toBe(true)
  })

  it('rejects NaN/Infinity/non-number bodyweight & restSeconds to undefined (→ safe defaults downstream)', () => {
    expect(merge({ bodyweight: NaN }).bodyweight).toBeUndefined()
    expect(merge({ bodyweight: Infinity }).bodyweight).toBeUndefined()
    expect(merge({ bodyweight: 'heavy' }).bodyweight).toBeUndefined()
    expect(merge({ restSeconds: NaN }).restSeconds).toBeUndefined()
    expect(merge({ daysPerWeek: NaN }).daysPerWeek).toBeUndefined()
  })

  it('clamps finite out-of-range numerics into sane bounds', () => {
    expect(merge({ bodyweight: 999999 }).bodyweight).toBe(1000)
    expect(merge({ sessionLength: 99999 }).sessionLength).toBe(240)
    expect(merge({ sessionLength: 1 }).sessionLength).toBe(10)
    expect(merge({ restSeconds: 99999 }).restSeconds).toBe(900)
    expect(merge({ daysPerWeek: 99 }).daysPerWeek).toBe(7)
    expect(merge({ daysPerWeek: 0 }).daysPerWeek).toBe(1)
  })

  it('rounds daysPerWeek and preserves valid values', () => {
    expect(merge({ daysPerWeek: 3.7 }).daysPerWeek).toBe(4)
    expect(
      merge({ bodyweight: 180, restSeconds: 120, sessionLength: 60, daysPerWeek: 4 }),
    ).toMatchObject({ bodyweight: 180, restSeconds: 120, sessionLength: 60, daysPerWeek: 4 })
  })

  it('falls back required sessionLength to the default when garbage', () => {
    const def = cur().profile.sessionLength
    expect(merge({ sessionLength: NaN }).sessionLength).toBe(def)
    expect(Number.isFinite(merge({ sessionLength: NaN }).sessionLength)).toBe(true)
  })
})
