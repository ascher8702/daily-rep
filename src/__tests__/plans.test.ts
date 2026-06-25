import { describe, it, expect, afterEach } from 'vitest'
import { PLANS, getPlan, planFrequencies, planScheduleSummary, mergeCatalogue, setRuntimePlans } from '../data/plans'
import { generateWorkout } from '../lib/generator'
import { getExercise } from '../data/exercises'
import { fullGymProfile, NOW } from './fixtures'

describe('planScheduleSummary (honest cycle vs frequency)', () => {
  it('reports the real cycle length (schedule.length), not the filter frequency', () => {
    // nsuns: fixed 5-day schedule but listed under 4/5/6-day filters → must read as a 5-day cycle
    const nsuns = getPlan('nsuns-531')!
    expect(planScheduleSummary(nsuns)).toBe('5-day cycle · 4–6×/wk')
    // stronglifts: 2 distinct days (A/B), trained 2–3×/week
    expect(planScheduleSummary(getPlan('stronglifts-5x5')!)).toBe('2-day cycle · 2–3×/wk')
  })

  it('labels a single-session program "Repeatable"', () => {
    const single = PLANS.find((p) => p.schedule.length === 1)!
    expect(planScheduleSummary(single).startsWith('Repeatable · ')).toBe(true)
  })

  it('the stated cycle always equals the actual rotation length for every plan', () => {
    for (const p of PLANS) {
      const expectedCycle = p.schedule.length <= 1 ? 'Repeatable' : `${p.schedule.length}-day cycle`
      expect(planScheduleSummary(p).startsWith(expectedCycle), `${p.id}`).toBe(true)
    }
  })
})

describe('workout plans', () => {
  it('every plan has a non-empty schedule whose days each target muscles', () => {
    expect(PLANS.length).toBeGreaterThan(0)
    for (const p of PLANS) {
      expect(p.schedule.length, `${p.id} has no days`).toBeGreaterThan(0)
      for (const day of p.schedule) {
        expect(day.focus.length, `${p.id}/${day.label} has no focus`).toBeGreaterThan(0)
        expect(day.title.length).toBeGreaterThan(0)
      }
    }
  })

  it('plan ids are unique and resolvable', () => {
    const ids = PLANS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(getPlan(id)).toBeDefined()
  })

  it('each plan day generates a session focused on that day', () => {
    const ppl = getPlan('ppl-6')!
    for (const day of ppl.schedule) {
      const w = generateWorkout(fullGymProfile, [], NOW, { focusOverride: day.focus })
      expect(w.exercises.length).toBeGreaterThan(0)
      for (const we of w.exercises) {
        const ex = getExercise(we.exerciseId)!
        const onFocus = [...ex.primary, ...ex.secondary].some((m) => day.focus.includes(m))
        expect(onFocus, `${we.exerciseId} is off-focus for ${day.label}`).toBe(true)
      }
    }
  })

  it('every prescribed plan lift maps to a real exercise (no dangling ids)', () => {
    for (const p of PLANS) {
      for (const day of p.schedule) {
        for (const lift of day.lifts ?? []) {
          expect(getExercise(lift.exerciseId), `${p.id}/${day.label}: bad id ${lift.exerciseId}`).toBeDefined()
          expect(lift.sets).toBeGreaterThan(0)
          expect(lift.repMin).toBeGreaterThan(0)
          expect(lift.repMax).toBeGreaterThanOrEqual(lift.repMin)
        }
      }
    }
  })

  it('is a large, level-spanning catalogue with explicit lifts', () => {
    expect(PLANS.length).toBeGreaterThanOrEqual(15)
    const levels = new Set(PLANS.map((p) => p.level))
    expect(levels.has('beginner')).toBe(true)
    expect(levels.has('intermediate')).toBe(true)
    expect(levels.has('advanced')).toBe(true)
    // most programs are encoded with explicit lifts (hybrid fidelity)
    const withLifts = PLANS.filter((p) => p.schedule.every((d) => d.lifts && d.lifts.length > 0))
    expect(withLifts.length).toBeGreaterThanOrEqual(15)
  })

  it('covers the full 2-6 day availability range and all equipment contexts', () => {
    const freqs = new Set(PLANS.flatMap(planFrequencies))
    // every availability chip (2-6 days) must match at least one program (no dead-end filter)
    for (const d of [2, 3, 4, 5, 6]) expect(freqs.has(d), `no plan offers ${d} days`).toBe(true)
    const contexts = new Set(PLANS.map((p) => p.equipmentContext ?? p.equipment))
    expect(contexts.size).toBeGreaterThanOrEqual(3)
  })

  it("keeps ppl-6's first day a Push day (generation-context contract)", () => {
    const ppl = getPlan('ppl-6')!
    expect(ppl.schedule[0].focus).toEqual(['chest', 'shoulders', 'triceps'])
  })

  it('includes the community-loved additions (Reddit/forum research)', () => {
    expect(PLANS.length).toBeGreaterThanOrEqual(29)
    const added = [
      'rfit-bbr',
      'wendler-531-beginners',
      'fierce-5',
      'lyle-gbr',
      'nippard-pure-hypertrophy',
      'gzcl-jt2',
      'bullmastiff',
      'arnold-split',
      'super-squats',
      'arnold-golden-six',
    ]
    for (const id of added) expect(getPlan(id), `missing added plan ${id}`).toBeDefined()
  })

  it('strengthened barbell programs are no longer thin (≥4 lifts on every day)', () => {
    for (const id of ['stronglifts-5x5', 'starting-strength', 'greyskull-lp', 'madcow-5x5', 'texas-method', 'sheiko']) {
      const p = getPlan(id)!
      for (const day of p.schedule) {
        expect(day.lifts!.length, `${id}/${day.label} only has ${day.lifts!.length} lifts`).toBeGreaterThanOrEqual(4)
      }
    }
  })
})

describe('mergeCatalogue + DB-plan registry (plans configurable via DB, offline-first)', () => {
  const sample = PLANS[0]
  afterEach(() => setRuntimePlans(PLANS)) // restore the bundled registry for other tests

  it('returns the bundled catalogue unchanged when there are no remote plans', () => {
    expect(mergeCatalogue(null)).toBe(PLANS)
    expect(mergeCatalogue([])).toBe(PLANS)
  })

  it('overrides a bundled plan by id (in place) and appends remote-only plans, without mutating PLANS', () => {
    const override = { ...sample, name: `${sample.name} (DB)`, tagline: 'edited via DB' }
    const novel = { ...sample, id: 'db-only-plan', name: 'DB-Only Program' }
    const merged = mergeCatalogue([override, novel])
    expect(merged.length).toBe(PLANS.length + 1) // override replaces in place, novel appended
    expect(merged.find((p) => p.id === sample.id)!.name).toBe(`${sample.name} (DB)`)
    expect(merged.find((p) => p.id === 'db-only-plan')).toBeDefined()
    // the bundled source array is never mutated
    expect(PLANS.find((p) => p.id === sample.id)!.name).toBe(sample.name)
  })

  it('getPlan resolves a DB-only plan once the runtime registry points at the merged catalogue', () => {
    const novel = { ...sample, id: 'db-only-plan-2', name: 'Another DB Plan' }
    expect(getPlan('db-only-plan-2')).toBeUndefined() // not in the bundled set
    setRuntimePlans(mergeCatalogue([novel]))
    expect(getPlan('db-only-plan-2')!.name).toBe('Another DB Plan')
  })
})
