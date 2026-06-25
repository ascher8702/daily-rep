import { describe, it, expect } from 'vitest'
import type { Workout } from '../types'
import { buildUserDataExport } from '../lib/dataExport'
import { fullGymProfile } from './fixtures'

describe('buildUserDataExport (GDPR/CCPA data portability)', () => {
  const workout: Workout = { id: 'w1', date: 1, status: 'completed', title: 't', focus: [], exercises: [] }

  it('packages the full user dataset with metadata and stays JSON-serializable', () => {
    const out = buildUserDataExport({
      profile: fullGymProfile,
      workouts: [workout],
      customPlans: [],
      activePlan: null,
      planProgress: { 'ppl-6': 3 },
      email: 'tester@dailyrep.app',
      when: '2026-06-24T12:00:00.000Z',
    })
    expect(out.app).toBe('Daily Rep')
    expect(out.schemaVersion).toBe(1)
    expect(out.exportedAt).toBe('2026-06-24T12:00:00.000Z')
    expect(out.account).toBe('tester@dailyrep.app')
    expect(out.profile).toBe(fullGymProfile)
    expect(out.workouts).toHaveLength(1)
    expect(out.planProgress).toEqual({ 'ppl-6': 3 })
    expect(() => JSON.stringify(out)).not.toThrow()
    expect(JSON.parse(JSON.stringify(out)).workouts[0].id).toBe('w1')
  })

  it('allows a null account (local-only / signed-out export)', () => {
    const out = buildUserDataExport({
      profile: fullGymProfile,
      workouts: [],
      customPlans: [],
      activePlan: null,
      planProgress: {},
      email: null,
      when: 'x',
    })
    expect(out.account).toBeNull()
    expect(out.workouts).toEqual([])
  })
})
