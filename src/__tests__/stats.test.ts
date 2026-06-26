import { describe, it, expect } from 'vitest'
import type { Workout } from '../types'
import {
  computeStreak,
  computeWeeklyStreak,
  localWeek,
  regionBalance,
  workoutVolume,
  effectiveLoad,
  summarizeWorkout,
  tonnageComparison,
  detectSetPR,
  allTimeBestE1rm,
  exerciseE1rmSeries,
  averageRPE,
  bodyweightSeries,
  filterByRange,
} from '../lib/stats'
import type { LoggedSet } from '../types'
import { NOW } from './fixtures'

const DAY = 1000 * 60 * 60 * 24
const WEEK = 7 * DAY

function done(exerciseId: string, sets: number, when: number): Workout {
  return {
    id: 'w-' + exerciseId + when,
    date: when,
    status: 'completed',
    title: 't',
    focus: [],
    completedAt: when,
    exercises: [
      {
        exerciseId,
        targetReps: [5, 5],
        sets: Array.from({ length: sets }, (_, i) => ({ id: String(i), weight: 100, reps: 5, done: true })),
      },
    ],
  }
}

describe('computeStreak', () => {
  it('counts consecutive local days ending today', () => {
    expect(computeStreak([NOW, NOW - DAY, NOW - 2 * DAY], NOW)).toBe(3)
  })
  it('stays alive when only yesterday has a workout', () => {
    expect(computeStreak([NOW - DAY], NOW)).toBe(1)
  })
  it('breaks on a gap', () => {
    expect(computeStreak([NOW, NOW - 3 * DAY], NOW)).toBe(1)
  })
  it('is zero with no history', () => {
    expect(computeStreak([], NOW)).toBe(0)
  })
})

describe('computeWeeklyStreak (forgiving consistency streak)', () => {
  it('counts consecutive weeks with at least one workout', () => {
    expect(computeWeeklyStreak([NOW, NOW - WEEK, NOW - 2 * WEEK], NOW)).toBe(3)
  })

  it('survives planned rest days — a single workout this week is a 1-week streak', () => {
    // a 3×/week lifter resting today: daily streak would be 0, weekly stays alive
    expect(computeWeeklyStreak([NOW - 3 * DAY], NOW)).toBe(1)
    expect(computeStreak([NOW - 3 * DAY], NOW)).toBe(0) // contrast: daily streak already broke
  })

  it('does not zero out across a single quiet day within an active week', () => {
    // workouts Mon + Wed of the current week, "now" is Fri → still a 1-week streak
    const base = localWeek(NOW)
    const monThisWeek = NOW - 4 * DAY
    const wedThisWeek = NOW - 2 * DAY
    // guard: both fall in the same week as NOW for this fixture
    if (localWeek(monThisWeek) === base && localWeek(wedThisWeek) === base) {
      expect(computeWeeklyStreak([monThisWeek, wedThisWeek], NOW)).toBe(1)
    }
  })

  it('stays alive when only LAST week has a workout (this week not started yet)', () => {
    expect(computeWeeklyStreak([NOW - WEEK], NOW)).toBe(1)
  })

  it('breaks when a whole week is skipped', () => {
    // this week + three weeks ago, with two empty weeks between → streak of 1
    expect(computeWeeklyStreak([NOW, NOW - 3 * WEEK], NOW)).toBe(1)
  })

  it('is zero with no history', () => {
    expect(computeWeeklyStreak([], NOW)).toBe(0)
  })
})

describe('summarizeWorkout (post-workout stats)', () => {
  type SetSpec = { weight: number; reps: number; done?: boolean; warmup?: boolean }
  function wk(id: string, when: number, blocks: { exerciseId: string; sets: SetSpec[] }[]): Workout {
    return {
      id,
      date: when,
      completedAt: when,
      status: 'completed',
      title: id,
      focus: [],
      exercises: blocks.map((b) => ({
        exerciseId: b.exerciseId,
        targetReps: [5, 5],
        sets: b.sets.map((s, i) => ({ id: `${id}-${b.exerciseId}-${i}`, done: true, ...s })),
      })),
    }
  }

  it('totals only completed working sets/reps/volume (warm-ups + unfinished excluded)', () => {
    const w = wk('v', NOW, [
      { exerciseId: 'barbell-bench-press', sets: [
        { weight: 45, reps: 10, warmup: true },     // warm-up — excluded
        { weight: 100, reps: 5 },                    // counts
        { weight: 100, reps: 5 },                    // counts
        { weight: 100, reps: 5, done: false },       // unfinished — excluded
      ] },
    ])
    const s = summarizeWorkout(w, [w], 0)
    expect(s.sets).toBe(2)
    expect(s.reps).toBe(10)
    expect(s.volume).toBe(1000) // 100×5 ×2
    expect(s.exercises).toBe(1)
    expect(s.topSets[0].e1rm).toBe(117) // estimate1RM(100,5)
  })

  it('flags an est-1RM PR vs prior history, but never on a first-ever session of a lift', () => {
    const prior = wk('p', NOW - WEEK, [{ exerciseId: 'barbell-bench-press', sets: [{ weight: 100, reps: 5 }] }])
    const heavier = wk('n', NOW, [{ exerciseId: 'barbell-bench-press', sets: [{ weight: 110, reps: 5 }] }])
    const s = summarizeWorkout(heavier, [prior, heavier], 0)
    expect(s.prs).toHaveLength(1)
    expect(s.prs[0]).toMatchObject({ exerciseId: 'barbell-bench-press', previous: 117, e1rm: 128 })

    // the prior session itself, with no history before it, is NOT a PR
    const firstTime = summarizeWorkout(prior, [prior], 0)
    expect(firstTime.prs).toHaveLength(0)
  })

  it('does not flag a PR when the session does not beat the prior best', () => {
    const prior = wk('p', NOW - WEEK, [{ exerciseId: 'barbell-bench-press', sets: [{ weight: 120, reps: 5 }] }])
    const lighter = wk('n', NOW, [{ exerciseId: 'barbell-bench-press', sets: [{ weight: 100, reps: 5 }] }])
    expect(summarizeWorkout(lighter, [prior, lighter], 0).prs).toHaveLength(0)
  })

  it('credits working sets to each exercise primary muscle and computes vsAverage over ≥2 priors', () => {
    const p1 = wk('p1', NOW - 2 * WEEK, [{ exerciseId: 'barbell-bench-press', sets: [{ weight: 100, reps: 5 }] }]) // vol 500
    const p2 = wk('p2', NOW - WEEK, [{ exerciseId: 'barbell-bench-press', sets: [{ weight: 100, reps: 5 }] }]) // vol 500
    const now = wk('n', NOW, [{ exerciseId: 'barbell-bench-press', sets: [{ weight: 100, reps: 5 }, { weight: 100, reps: 5 }] }]) // vol 1000
    const s = summarizeWorkout(now, [p1, p2, now], 0)
    expect(s.muscles.length).toBeGreaterThan(0)
    expect(s.muscles[0].sets).toBeGreaterThanOrEqual(1)
    expect(s.vsAverage).toBeCloseTo(2, 5) // 1000 / avg(500,500)

    // a single prior session is not enough for a meaningful average → null
    expect(summarizeWorkout(now, [p1, now], 0).vsAverage).toBeNull()
  })
})

describe('tonnageComparison', () => {
  it('returns null for a tiny tonnage', () => {
    expect(tonnageComparison(100, 'lb')).toBeNull()
  })
  it('returns a relatable comparison string for a real session volume', () => {
    expect(tonnageComparison(15830, 'lb')).toMatch(/piano|bear|car|truck|elephant|bus|whale/)
  })
  it('is unit-aware (kg volume is converted to lb references)', () => {
    expect(tonnageComparison(5000, 'kg')).toMatch(/piano|bear|car|truck|elephant|bus|whale/)
  })
})

describe('regionBalance', () => {
  it('counts each set once per DISTINCT region, not per primary muscle', () => {
    // deadlift primaries: hamstrings (legs), glutes (legs), lowerback (core)
    const counts = regionBalance([done('deadlift', 1, NOW)], NOW - DAY)
    expect(counts.legs).toBe(1) // not 2, despite two leg-region primaries
    expect(counts.core).toBe(1)
    expect(counts.push).toBe(0)
    expect(counts.pull).toBe(0)
  })
  it('ignores workouts older than the window', () => {
    const counts = regionBalance([done('back-squat', 3, NOW - 30 * DAY)], NOW - 14 * DAY)
    expect(counts.legs).toBe(0)
  })
})

describe('effectiveLoad — bodyweight', () => {
  it('credits bodyweight strength movements with a share of bodyweight', () => {
    expect(effectiveLoad('pushup', 0, 155)).toBeGreaterThan(0)
    // weighted bodyweight move adds external weight on top
    expect(effectiveLoad('pullup', 10, 155)).toBeGreaterThan(effectiveLoad('pushup', 0, 155))
  })
  it('does not add bodyweight to externally-loaded lifts', () => {
    expect(effectiveLoad('barbell-bench-press', 135, 155)).toBe(135)
  })
  it('does not credit core/cardio bodyweight movements with tonnage', () => {
    expect(effectiveLoad('plank', 0, 155)).toBe(0)
  })
  it('credits nothing when no bodyweight is known', () => {
    expect(effectiveLoad('pushup', 0, 0)).toBe(0)
  })
})

describe('workoutVolume', () => {
  it('sums weight*reps over completed working sets', () => {
    expect(workoutVolume(done('back-squat', 2, NOW))).toBe(2 * 100 * 5)
  })

  it('counts bodyweight workouts once a bodyweight is supplied', () => {
    const w = done('pushup', 3, NOW)
    w.exercises[0].sets.forEach((s) => (s.weight = 0)) // real push-ups carry no external load
    expect(workoutVolume(w, 0)).toBe(0)
    expect(workoutVolume(w, 155)).toBeGreaterThan(0)
  })
  it('excludes warmups and undone sets', () => {
    const w = done('back-squat', 1, NOW)
    w.exercises[0].sets.push({ id: 'wu', weight: 50, reps: 5, done: true, warmup: true })
    w.exercises[0].sets.push({ id: 'undone', weight: 200, reps: 5, done: false })
    expect(workoutVolume(w)).toBe(100 * 5)
  })
})

describe('detectSetPR (live PR toast)', () => {
  const S = (id: string, weight: number, reps: number, done = true, warmup = false): LoggedSet => ({
    id,
    weight,
    reps,
    done,
    warmup,
  })
  const wk = (id: string, exerciseId: string, sets: LoggedSet[], bodyweight?: number): Workout => ({
    id,
    date: 1,
    status: 'completed',
    title: 't',
    focus: [],
    completedAt: 1,
    bodyweight,
    exercises: [{ exerciseId, targetReps: [5, 5], sets }],
  })

  it('allTimeBestE1rm takes the max est-1RM across history', () => {
    const hist = [wk('h1', 'barbell-bench-press', [S('a', 100, 5)]), wk('h2', 'barbell-bench-press', [S('b', 120, 3)])]
    expect(allTimeBestE1rm('barbell-bench-press', hist, 180)).toBe(132) // max(117, 132)
  })

  it('flags a set that beats the prior all-time best', () => {
    const history = [wk('h1', 'barbell-bench-press', [S('a', 100, 5)])] // e1rm 117
    const session = wk('cur', 'barbell-bench-press', [S('s1', 110, 5)]) // e1rm 128
    expect(detectSetPR('barbell-bench-press', 's1', session, history, 180)).toEqual({
      isPR: true,
      e1rm: 128,
      previousBest: 117,
    })
  })

  it('does NOT flag a first-ever attempt at a lift (no prior record)', () => {
    const session = wk('cur', 'barbell-bench-press', [S('s1', 110, 5)])
    expect(detectSetPR('barbell-bench-press', 's1', session, [], 180).isPR).toBe(false)
  })

  it('does NOT flag a set that only ties the prior best', () => {
    const history = [wk('h1', 'barbell-bench-press', [S('a', 110, 5)])] // 128
    const session = wk('cur', 'barbell-bench-press', [S('s1', 110, 5)]) // 128
    expect(detectSetPR('barbell-bench-press', 's1', session, history, 180).isPR).toBe(false)
  })

  it('does NOT flag a lighter set once a heavier set this session already set the bar', () => {
    const session = wk('cur', 'barbell-bench-press', [S('heavy', 120, 5), S('light', 110, 5)])
    const r = detectSetPR('barbell-bench-press', 'light', session, [], 180)
    expect(r.isPR).toBe(false)
    expect(r.previousBest).toBe(140) // the heavier 120×5
  })

  it('ignores warm-up and not-yet-done sets', () => {
    const warm = wk('cur', 'barbell-bench-press', [S('w', 300, 5, true, true)])
    expect(detectSetPR('barbell-bench-press', 'w', warm, [], 180).isPR).toBe(false)
    const undone = wk('cur', 'barbell-bench-press', [S('u', 300, 5, false)])
    expect(detectSetPR('barbell-bench-press', 'u', undone, [], 180).isPR).toBe(false)
  })

  it('uses effective bodyweight load for a bodyweight lift PR', () => {
    const history = [wk('h', 'pushup', [S('a', 0, 8)], 200)] // eff 130 → e1rm 165
    const session = wk('cur', 'pushup', [S('s1', 0, 10)], 200) // eff 130 → e1rm 173
    expect(detectSetPR('pushup', 's1', session, history, 200)).toEqual({
      isPR: true,
      e1rm: 173,
      previousBest: 165,
    })
  })
})

describe('exerciseE1rmSeries (per-exercise progression chart)', () => {
  const S = (id: string, weight: number, reps: number, done = true, warmup = false): LoggedSet => ({
    id,
    weight,
    reps,
    done,
    warmup,
  })
  const wk = (
    id: string,
    exerciseId: string,
    sets: LoggedSet[],
    when: number,
    bodyweight?: number,
    status: Workout['status'] = 'completed',
  ): Workout => ({
    id,
    date: when,
    completedAt: when,
    status,
    title: 't',
    focus: [],
    bodyweight,
    exercises: [{ exerciseId, targetReps: [5, 5], sets }],
  })

  it('returns the best est-1RM per completed session, oldest first', () => {
    const ws = [
      wk('w2', 'barbell-bench-press', [S('a', 110, 5)], 2000), // 128
      wk('w1', 'barbell-bench-press', [S('b', 100, 5)], 1000), // 117
      wk('w3', 'barbell-bench-press', [S('c', 120, 5), S('d', 100, 5)], 3000), // best 140
    ]
    const series = exerciseE1rmSeries('barbell-bench-press', ws, 180)
    expect(series.map((p) => p.e1rm)).toEqual([117, 128, 140])
    expect(series.map((p) => p.ts)).toEqual([1000, 2000, 3000])
  })

  it('skips sessions without a working set of the exercise', () => {
    const ws = [
      wk('a', 'barbell-bench-press', [S('s', 100, 5)], 1000),
      wk('b', 'deadlift', [S('s', 200, 5)], 2000), // different lift
      wk('c', 'barbell-bench-press', [S('w', 45, 10, true, true)], 3000), // warm-up only
    ]
    expect(exerciseE1rmSeries('barbell-bench-press', ws, 180).map((p) => p.ts)).toEqual([1000])
  })

  it('ignores non-completed sessions (e.g. an active one)', () => {
    const ws = [
      wk('done', 'barbell-bench-press', [S('s', 100, 5)], 1000),
      wk('active', 'barbell-bench-press', [S('s', 200, 5)], 2000, undefined, 'active'),
    ]
    expect(exerciseE1rmSeries('barbell-bench-press', ws, 180).map((p) => p.e1rm)).toEqual([117])
  })

  it('uses each session frozen bodyweight for a bodyweight-lift curve', () => {
    const ws = [
      wk('w1', 'pushup', [S('s', 0, 8)], 1000, 200), // eff 130 → 165
      wk('w2', 'pushup', [S('s', 0, 8)], 2000, 240), // eff 156 → 198
    ]
    expect(exerciseE1rmSeries('pushup', ws, 200).map((p) => p.e1rm)).toEqual([165, 198])
  })
})

describe('bodyweightSeries (Progress bodyweight trend)', () => {
  const wk = (
    id: string,
    when: number,
    bodyweight?: number,
    status: Workout['status'] = 'completed',
  ): Workout => ({
    id,
    date: when,
    completedAt: when,
    status,
    title: 't',
    focus: [],
    bodyweight,
    exercises: [],
  })

  it('returns each completed session frozen bodyweight, oldest first', () => {
    const ws = [wk('b', 2000, 181), wk('a', 1000, 180), wk('c', 3000, 178)]
    const series = bodyweightSeries(ws)
    expect(series.map((p) => p.bw)).toEqual([180, 181, 178]) // sorted by ts, not input order
    expect(series.map((p) => p.ts)).toEqual([1000, 2000, 3000])
  })

  it('captures a real trend (a cut shows as a descending series with a negative net delta)', () => {
    const ws = [wk('a', 1000, 200), wk('b', 2000, 196), wk('c', 3000, 192)]
    const bws = bodyweightSeries(ws).map((p) => p.bw)
    expect(bws).toEqual([200, 196, 192])
    expect(bws[bws.length - 1] - bws[0]).toBe(-8) // the net delta the chart footer reports
  })

  it('skips sessions without a usable frozen bodyweight, and non-completed sessions', () => {
    const ws = [
      wk('ok', 1000, 180),
      wk('nobw', 2000, undefined),
      wk('zero', 3000, 0),
      wk('active', 4000, 185, 'active'),
    ]
    expect(bodyweightSeries(ws).map((p) => p.ts)).toEqual([1000])
  })

  it('is empty when nothing qualifies (Progress shows the <2-point note instead)', () => {
    expect(bodyweightSeries([])).toEqual([])
    expect(bodyweightSeries([wk('a', 1000, undefined)])).toEqual([])
  })
})

describe('filterByRange (Progress time-range selector)', () => {
  const D = 24 * 60 * 60 * 1000
  const T = 1_700_000_000_000
  const wk = (id: string, when: number, useCompleted = true): Workout => ({
    id,
    date: useCompleted ? 0 : when,
    completedAt: useCompleted ? when : undefined,
    status: 'completed',
    title: 't',
    focus: [],
    exercises: [],
  })
  const ws = [
    wk('today', T - 1 * D),
    wk('6d', T - 6 * D),
    wk('boundary7', T - 7 * D), // exactly on the week cutoff
    wk('20d', T - 20 * D),
    wk('40d', T - 40 * D),
  ]

  it("'all' returns everything unfiltered (default — zero behaviour change)", () => {
    expect(filterByRange(ws, 'all', T)).toBe(ws) // same reference, no copy
    expect(filterByRange(ws, 'all', T)).toHaveLength(5)
  })

  it("'week' keeps the last 7 days, cutoff inclusive", () => {
    expect(filterByRange(ws, 'week', T).map((w) => w.id)).toEqual(['today', '6d', 'boundary7'])
  })

  it("'month' keeps the last 30 days", () => {
    expect(filterByRange(ws, 'month', T).map((w) => w.id)).toEqual(['today', '6d', 'boundary7', '20d'])
  })

  it('windows on completedAt, falling back to date when absent', () => {
    const noCompleted = [wk('recent', T - 2 * D, false), wk('old', T - 50 * D, false)]
    expect(filterByRange(noCompleted, 'week', T).map((w) => w.id)).toEqual(['recent'])
  })
})

describe('averageRPE (session intensity)', () => {
  const oneSet: LoggedSet = { id: 's', weight: 100, reps: 5, done: true }
  // effort is now logged once per exercise; build a workout from a list of exercise RPEs
  const wk = (rpes: (number | undefined)[]): Workout => ({
    id: 'w',
    date: 1,
    completedAt: 1,
    status: 'completed',
    title: 't',
    focus: [],
    exercises: rpes.map((rpe, i) => ({
      exerciseId: 'barbell-bench-press',
      instanceId: `e${i}`,
      targetReps: [5, 5],
      sets: [{ ...oneSet, id: `s${i}` }],
      ...(rpe == null ? {} : { rpe }),
    })),
  })

  it('returns null when no exercise has an rpe', () => {
    expect(averageRPE(wk([undefined, undefined]))).toBeNull()
  })

  it('averages rpe over the rated exercises, ignoring unrated ones', () => {
    expect(averageRPE(wk([8, 9, undefined]))).toBe(8.5)
  })

  it('rounds to one decimal', () => {
    expect(averageRPE(wk([7, 8, 8]))).toBe(7.7)
  })
})
