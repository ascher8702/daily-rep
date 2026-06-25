import { describe, it, expect } from 'vitest'
import { recommendPlans, planUndoableRatio, profileEquipmentContext } from '../lib/planMatch'
import { PLANS } from '../data/plans'
import { fullGymProfile } from './fixtures'
import type { Profile } from '../types'

describe('recommendPlans', () => {
  it('ranks plans and returns at most the requested limit', () => {
    const top = recommendPlans(PLANS, fullGymProfile, { limit: 3 })
    expect(top.length).toBeLessThanOrEqual(3)
    // scores are sorted descending
    for (let i = 1; i < top.length; i++) expect(top[i - 1].score).toBeGreaterThanOrEqual(top[i].score)
    // every recommendation is a built-in (non-custom) plan
    for (const m of top) expect(m.plan.custom).toBeFalsy()
  })

  it('prefers a plan that matches the user goal + experience', () => {
    const strengthBeginner: Profile = { ...fullGymProfile, goal: 'strength', experience: 'beginner', daysPerWeek: 3 }
    const ranked = recommendPlans(PLANS, strengthBeginner)
    const top = ranked[0]
    // the top match should fit the goal (the strongest single signal, +3)
    expect(top.plan.goalFit).toContain('strength')
    expect(top.reasons).toContain('matches your goal')
  })

  it('rewards equipment fit — a bodyweight-only user ranks a bodyweight plan above a barbell one', () => {
    const bw: Profile = { ...fullGymProfile, equipment: ['bodyweight', 'pullupbar'], goal: 'general' }
    const ranked = recommendPlans(PLANS, bw)
    const idx = (pred: (p: (typeof ranked)[number]) => boolean) => ranked.findIndex(pred)
    const bestBodyweight = idx((m) => m.plan.equipment === 'Bodyweight')
    const bestFullGym = idx((m) => m.plan.equipment === 'Full gym')
    if (bestBodyweight >= 0 && bestFullGym >= 0) {
      expect(bestBodyweight).toBeLessThan(bestFullGym)
    }
  })

  it('nudges a gender-affinity plan up for a matching profile and adds an honest reason', () => {
    const female: Profile = { ...fullGymProfile, gender: 'female', goal: 'hypertrophy' }
    const neutral: Profile = { ...fullGymProfile, goal: 'hypertrophy' }
    const rankOf = (list: ReturnType<typeof recommendPlans>, id: string) => list.findIndex((m) => m.plan.id === id)
    const f = recommendPlans(PLANS, female)
    const n = recommendPlans(PLANS, neutral)
    // 'strong-curves' is a female-affinity plan: it should rank at least as high for a female profile
    expect(rankOf(f, 'strong-curves')).toBeLessThanOrEqual(rankOf(n, 'strong-curves'))
    const m = f.find((x) => x.plan.id === 'strong-curves')!
    expect(m.reasons).toContain('popular with women')
    // a male profile gets no female-affinity nudge (inclusive, not exclusive — plan still present)
    const male = recommendPlans(PLANS, { ...fullGymProfile, gender: 'male', goal: 'hypertrophy' })
    expect(male.find((x) => x.plan.id === 'strong-curves')!.reasons).not.toContain('popular with women')
  })
})

describe('profileEquipmentContext (seeds the catalogue equipment filter)', () => {
  it('maps a barbell/gym setup to full-gym', () => {
    expect(profileEquipmentContext(['barbell', 'bench', 'dumbbell'])).toBe('full-gym')
    expect(profileEquipmentContext(['machine', 'cable'])).toBe('full-gym')
  })
  it('maps a home dumbbell setup to home-dumbbell', () => {
    expect(profileEquipmentContext(['dumbbell', 'bench'])).toBe('home-dumbbell')
    expect(profileEquipmentContext(['kettlebell'])).toBe('home-dumbbell')
  })
  it('maps bodyweight/bands setups to bodyweight', () => {
    expect(profileEquipmentContext(['bodyweight', 'pullupbar'])).toBe('bodyweight')
    expect(profileEquipmentContext(['bands'])).toBe('bodyweight')
  })
  it('returns any when there is no gear on file (avoids over-filtering a new profile)', () => {
    expect(profileEquipmentContext([])).toBe('any')
  })
})

describe('planUndoableRatio', () => {
  it('is 0 for a full-equipment user and >0 when gear is missing', () => {
    const barbellPlan = PLANS.find((p) => p.equipment === 'Full gym')!
    const fullOwned = new Set(fullGymProfile.equipment)
    expect(planUndoableRatio(barbellPlan, fullOwned)).toBe(0)
    const bwOwned = new Set<typeof fullGymProfile.equipment[number]>(['bodyweight'])
    expect(planUndoableRatio(barbellPlan, bwOwned)).toBeGreaterThan(0)
  })
})
