import { describe, it, expect } from 'vitest'
import {
  roundToAchievable,
  barWeight,
  platesPerSide,
  plateLoad,
  startingWeight,
  isBodyweightExercise,
  loadStep,
  minLoadable,
  nextLoadableUp,
  prevLoadableDown,
} from '../lib/weights'
import { getExercise } from '../data/exercises'
import { fullGymProfile } from './fixtures'

const bench = getExercise('barbell-bench-press')! // barbell
const dbPress = getExercise('incline-db-press')! // dumbbell
const legPress = getExercise('leg-press')! // machine
const pushup = getExercise('pushup')! // bodyweight

describe('roundToAchievable — barbell', () => {
  it('rounds to the bar plus symmetric plate pairs (multiples of 5 lb over the bar)', () => {
    expect(roundToAchievable(135, bench, 'lb')).toBe(135)
    expect(roundToAchievable(47, bench, 'lb')).toBe(45) // never an un-loadable 47 lb bar
    for (const target of [50, 63, 88, 137, 224]) {
      const w = roundToAchievable(target, bench, 'lb')
      expect((w - barWeight('lb')) % 5).toBe(0)
      expect(w).toBeGreaterThanOrEqual(barWeight('lb'))
    }
  })
  it('never goes below the empty bar', () => {
    expect(roundToAchievable(20, bench, 'lb')).toBe(45)
  })
  it('uses a 20 kg bar and 2.5 kg pair steps in kg', () => {
    const w = roundToAchievable(61, bench, 'kg')
    expect((w - 20) % 2.5).toBe(0)
  })
})

describe('roundToAchievable — dumbbell & machine', () => {
  it('snaps dumbbells to real 5 lb increments', () => {
    expect(roundToAchievable(47, dbPress, 'lb')).toBe(45)
    expect(roundToAchievable(48, dbPress, 'lb')).toBe(50)
    expect(roundToAchievable(45, dbPress, 'lb') % 5).toBe(0)
  })
  it('snaps machines to 5 lb stack increments', () => {
    expect(roundToAchievable(123, legPress, 'lb') % 5).toBe(0)
  })
})

describe('roundToAchievable — bodyweight', () => {
  it('returns 0 for unweighted bodyweight movements', () => {
    expect(roundToAchievable(0, pushup, 'lb')).toBe(0)
  })
})

describe('startingWeight — cold-start seeding', () => {
  it('seeds a realistic, loadable starting weight for weighted lifts', () => {
    const w = startingWeight(bench, fullGymProfile)
    expect(w).toBeGreaterThan(0)
    expect((w - barWeight('lb')) % 5).toBe(0) // loadable on a bar
  })
  it('returns 0 for bodyweight movements', () => {
    expect(startingWeight(pushup, fullGymProfile)).toBe(0)
  })
  it('scales with experience (advanced > beginner)', () => {
    const beginner = startingWeight(bench, { ...fullGymProfile, experience: 'beginner' })
    const advanced = startingWeight(bench, { ...fullGymProfile, experience: 'advanced' })
    expect(advanced).toBeGreaterThan(beginner)
  })

  it('seeds the new dumbbell movements near their siblings, not the 95 lb barbell default', () => {
    const dbBench = startingWeight(getExercise('db-bench-press')!, fullGymProfile)
    const inclineDb = startingWeight(getExercise('incline-db-press')!, fullGymProfile)
    const bss = startingWeight(getExercise('bulgarian-split-squat')!, fullGymProfile)
    // db bench tracks incline-db (~50 per hand), well under the 95 lb compound fallback
    expect(Math.abs(dbBench - inclineDb)).toBeLessThanOrEqual(5)
    expect(dbBench).toBeLessThan(80)
    expect(bss).toBeGreaterThan(0)
    expect(bss).toBeLessThan(60)
  })
})

describe('platesPerSide — barbell plate math', () => {
  it('computes plates per side, heaviest first', () => {
    expect(platesPerSide(135, bench, 'lb')).toEqual([45])
    expect(platesPerSide(225, bench, 'lb')).toEqual([45, 45])
    expect(platesPerSide(95, bench, 'lb')).toEqual([25])
    expect(platesPerSide(45, bench, 'lb')).toEqual([]) // empty bar
  })
  it('always sums back to the target weight', () => {
    for (const w of [50, 65, 135, 185, 230]) {
      const plates = platesPerSide(w, bench, 'lb')!
      const total = barWeight('lb') + 2 * plates.reduce((a, b) => a + b, 0)
      expect(total).toBe(w)
    }
  })
  it('returns null for non-barbell exercises', () => {
    expect(platesPerSide(50, dbPress, 'lb')).toBeNull()
  })
})

describe('plateLoad — structured breakdown for the plate-calculator sheet', () => {
  it('groups per-side plates + computes the exact loaded total', () => {
    const pl = plateLoad(225, bench, 'lb')!
    expect(pl.bar).toBe(45)
    expect(pl.perSide).toEqual([{ plate: 45, count: 2 }])
    expect(pl.loaded).toBe(225)
    expect(pl.remainderPerSide).toBe(0)
  })
  it('reports the empty bar (no plates)', () => {
    const pl = plateLoad(45, bench, 'lb')!
    expect(pl.perSide).toEqual([])
    expect(pl.loaded).toBe(45)
    expect(pl.remainderPerSide).toBe(0)
  })
  it('groups mixed plates heaviest-first', () => {
    expect(plateLoad(185, bench, 'lb')!.perSide).toEqual([
      { plate: 45, count: 1 },
      { plate: 25, count: 1 },
    ])
  })
  it('flags an un-loadable remainder + the nearest standard load', () => {
    const pl = plateLoad(137, bench, 'lb')! // per side 46 → one 45, 1 lb left over
    expect(pl.perSide).toEqual([{ plate: 45, count: 1 }])
    expect(pl.loaded).toBe(135)
    expect(pl.remainderPerSide).toBe(1)
  })
  it('returns null for non-barbell lifts (dumbbell / machine / bodyweight)', () => {
    expect(plateLoad(50, dbPress, 'lb')).toBeNull()
    expect(plateLoad(200, legPress, 'lb')).toBeNull()
    expect(plateLoad(0, pushup, 'lb')).toBeNull()
  })
})

describe('loadStep / nextLoadableUp / prevLoadableDown', () => {
  const curl = getExercise('barbell-curl')! // barbell upper-isolation

  it('loadStep is the real plate-pair / stack-notch resolution', () => {
    expect(loadStep(bench, 'lb')).toBe(5) // symmetric barbell pair
    expect(loadStep(bench, 'kg')).toBe(2.5)
    expect(loadStep(dbPress, 'lb')).toBe(5) // dumbbell notch
    expect(loadStep(legPress, 'lb')).toBe(5) // machine stack
    expect(loadStep(pushup, 'lb')).toBe(1) // added bodyweight load is fine-grained
  })

  it('nextLoadableUp returns the smallest achievable weight strictly above', () => {
    expect(nextLoadableUp(135, bench, 'lb')).toBe(140)
    // the exact case that used to stall: a barbell at 65 lb has no loadable +1.25
    expect(nextLoadableUp(65, curl, 'lb')).toBe(70)
    expect(nextLoadableUp(65, curl, 'lb')).toBeGreaterThan(65)
  })

  it('prevLoadableDown returns the largest achievable weight strictly below, floored at the bar', () => {
    expect(prevLoadableDown(140, bench, 'lb')).toBe(135)
    expect(prevLoadableDown(45, bench, 'lb')).toBe(45) // can't load below the empty bar
  })

  it('minLoadable is the lightest real load per equipment, never 0 for dumbbell/machine', () => {
    expect(minLoadable(bench, 'lb')).toBe(45) // empty bar
    expect(minLoadable(bench, 'kg')).toBe(20)
    expect(minLoadable(dbPress, 'lb')).toBe(5) // a 5 lb dumbbell, not 0
    expect(minLoadable(legPress, 'lb')).toBe(5) // one stack pin
    expect(minLoadable(pushup, 'lb')).toBe(0) // a bodyweight move can carry no added load
  })

  it('prevLoadableDown floors a dumbbell/machine at one notch, never a non-loadable 0 (regression)', () => {
    // the deload-to-zero hole: a lift already at its lightest notch must NOT drop to 0
    expect(prevLoadableDown(5, dbPress, 'lb')).toBe(5)
    expect(prevLoadableDown(2.5, dbPress, 'kg')).toBe(2.5)
    expect(prevLoadableDown(5, legPress, 'lb')).toBe(5)
    // but it still steps down a real notch when there is room
    expect(prevLoadableDown(15, dbPress, 'lb')).toBe(10)
    expect(prevLoadableDown(10, dbPress, 'lb')).toBe(5)
  })
})

describe('isBodyweightExercise — "BW" display rule', () => {
  it('flags bodyweight strength moves', () => {
    expect(isBodyweightExercise(pushup)).toBe(true)
  })
  it('flags bodyweight CORE moves too (category-agnostic — they still read "BW", not "—")', () => {
    expect(isBodyweightExercise(getExercise('plank')!)).toBe(true)
    expect(isBodyweightExercise(getExercise('hanging-leg-raise')!)).toBe(true)
  })
  it('does not flag externally-loaded moves', () => {
    expect(isBodyweightExercise(bench)).toBe(false)
    expect(isBodyweightExercise(getExercise('cable-crunch')!)).toBe(false) // core, but cable-loaded
  })
})
