import { describe, it, expect } from 'vitest'
import { computeRecovery, freshnessFromFatigue, recoveryToken } from '../lib/recovery'
import { ALL_MUSCLES } from '../data/muscles'
import { completedWorkout, NOW } from './fixtures'

describe('muscle recovery model', () => {
  it('a fresh athlete with no history is fully recovered everywhere', () => {
    const fatigue = computeRecovery([], NOW)
    const fresh = freshnessFromFatigue(fatigue)
    for (const m of ALL_MUSCLES) {
      expect(fatigue[m]).toBe(0)
      expect(fresh[m]).toBe(100)
    }
  })

  it('training a muscle reduces its freshness', () => {
    const fresh = freshnessFromFatigue(computeRecovery([completedWorkout('barbell-bench-press', NOW)], NOW))
    expect(fresh.chest).toBeLessThan(100)
    // triceps is a secondary mover on the bench press, so it takes some fatigue too
    expect(fresh.triceps).toBeLessThan(100)
    // an untrained muscle stays fresh
    expect(fresh.quads).toBe(100)
  })

  it('fatigue decays over time — an older session leaves you fresher now', () => {
    const recent = computeRecovery([completedWorkout('barbell-bench-press', NOW - 2 * 3600_000)], NOW).chest
    const old = computeRecovery([completedWorkout('barbell-bench-press', NOW - 6 * 24 * 3600_000)], NOW).chest
    expect(old).toBeLessThan(recent)
  })

  it('clamps fatigue to the 0..100 range even after huge volume', () => {
    const many = Array.from({ length: 20 }, (_, i) => completedWorkout('back-squat', NOW - i * 60_000))
    const fatigue = computeRecovery(many, NOW)
    for (const m of ALL_MUSCLES) {
      expect(fatigue[m]).toBeGreaterThanOrEqual(0)
      expect(fatigue[m]).toBeLessThanOrEqual(100)
    }
    expect(fatigue.quads).toBeGreaterThan(0)
  })
})

describe('recoveryToken (discrete tier → Blaze color token)', () => {
  it('maps the three tiers by threshold (fresh ≥70, moderate ≥40, else rest)', () => {
    expect(recoveryToken(100)).toBe('recovery-fresh')
    expect(recoveryToken(72)).toBe('recovery-fresh')
    expect(recoveryToken(70)).toBe('recovery-fresh') // boundary inclusive
    expect(recoveryToken(64)).toBe('recovery-moderate')
    expect(recoveryToken(40)).toBe('recovery-moderate') // boundary inclusive
    expect(recoveryToken(39)).toBe('recovery-rest')
    expect(recoveryToken(0)).toBe('recovery-rest')
  })
})
