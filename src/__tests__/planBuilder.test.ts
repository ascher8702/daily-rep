import { describe, it, expect } from 'vitest'
import { scaffoldPlan, removeScheduleDay, blankDay } from '../lib/planBuilder'
import { getExercise } from '../data/exercises'
import { fullGymProfile } from './fixtures'

describe('scaffoldPlan (guided custom plan)', () => {
  it('builds the requested number of days, each with valid lifts', () => {
    for (const days of [2, 3, 4, 5, 6]) {
      const plan = scaffoldPlan(
        { name: 'Test', level: 'intermediate', goal: 'hypertrophy', equipmentContext: 'full-gym', daysPerWeek: days },
        fullGymProfile,
      )
      expect(plan.schedule).toHaveLength(days)
      expect(plan.custom).toBe(true)
      expect(plan.daysPerWeek).toBe(days)
      for (const d of plan.schedule) {
        expect(d.lifts && d.lifts.length, `${days}-day plan: empty day`).toBeGreaterThan(0)
        for (const l of d.lifts!) expect(getExercise(l.exerciseId)).toBeDefined()
      }
    }
  })

  it('respects a bodyweight equipment context (no barbell lifts scaffolded)', () => {
    const plan = scaffoldPlan(
      { name: 'BW', level: 'beginner', goal: 'general', equipmentContext: 'bodyweight', daysPerWeek: 3 },
      { ...fullGymProfile, equipment: ['bodyweight', 'pullupbar'] },
    )
    for (const d of plan.schedule) {
      for (const l of d.lifts!) {
        const ex = getExercise(l.exerciseId)!
        // every scaffolded lift must be doable with only bodyweight/pullup gear
        expect(ex.equipment.some((e) => ['bodyweight', 'pullupbar', 'bands'].includes(e))).toBe(true)
      }
    }
  })

  it('falls back the name and clamps an out-of-range frequency', () => {
    const plan = scaffoldPlan(
      { name: '   ', level: 'beginner', goal: 'strength', equipmentContext: 'full-gym', daysPerWeek: 99 },
      fullGymProfile,
    )
    expect(plan.name).toBe('My Plan')
    expect(plan.schedule.length).toBeLessThanOrEqual(6)
    expect(plan.schedule.length).toBeGreaterThanOrEqual(2)
  })
})

describe('removeScheduleDay (builder dead-end guard)', () => {
  it('removes the day at the given index when more than one remains', () => {
    const sched = [blankDay(0), blankDay(1), blankDay(2)]
    const next = removeScheduleDay(sched, 1)
    expect(next).toHaveLength(2)
    expect(next.map((d) => d.title)).toEqual(['Day 1', 'Day 3'])
  })

  it('never drops below one day — deleting the last day is a no-op (unsaveable dead-end guard)', () => {
    const sched = [blankDay(0)]
    const next = removeScheduleDay(sched, 0)
    // a zero-day schedule can't be saved (canSave requires schedule.length > 0), so the builder
    // must keep at least one day; the call returns the schedule unchanged
    expect(next).toBe(sched)
    expect(next).toHaveLength(1)
  })
})
