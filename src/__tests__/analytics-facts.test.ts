import { describe, it, expect } from 'vitest'
import { EXERCISES } from '../data/exercises'
import { MUSCLES } from '../data/muscles'
import { effectiveLoad } from '../lib/stats'

/**
 * Contract guard for the server-side, set-level analytics projection.
 *
 * Supabase `public.exercise_facts` mirrors two catalogue-derived facts that the extractor
 * (`analytics.reconcile_user`) needs so the DB projection reproduces stats.ts math exactly:
 *   is_bodyweight_lift = equipment ∋ 'bodyweight' AND category ∈ {compound, isolation}
 *   regions            = distinct MUSCLES[primary].region
 * It was seeded ONCE from this catalogue. If the catalogue changes (a lift added, re-typed, or
 * re-muscled), these assertions drift — that is the signal to re-derive & re-seed exercise_facts
 * so the projection keeps matching the client. Keep DERIVED_FACTS_COUNT == the seeded row count.
 */
const DERIVED_FACTS_COUNT = 53

type Region = 'push' | 'pull' | 'legs' | 'core'
type Ex = (typeof EXERCISES)[number]

const deriveIsBodyweightLift = (ex: Ex): boolean =>
  ex.equipment.includes('bodyweight') && (ex.category === 'compound' || ex.category === 'isolation')

const deriveRegions = (ex: Ex): Region[] => [...new Set(ex.primary.map((m) => MUSCLES[m].region))]

describe('exercise_facts derivation (DB analytics projection ↔ stats.ts contract)', () => {
  it('covers exactly the seeded catalogue (re-seed exercise_facts if this count changes)', () => {
    expect(EXERCISES).toHaveLength(DERIVED_FACTS_COUNT)
    expect(new Set(EXERCISES.map((e) => e.id)).size).toBe(DERIVED_FACTS_COUNT) // ids are unique
  })

  it('is_bodyweight_lift matches the ACTUAL effectiveLoad bodyweight behaviour (non-circular)', () => {
    // effectiveLoad(id, weight=0, bodyweight=100) is >0 iff the lift credits a share of bodyweight —
    // exactly the is_bodyweight_lift fact the projection stores. Probing the real function avoids
    // re-stating the rule the projection also uses.
    for (const ex of EXERCISES) {
      const byBehaviour = effectiveLoad(ex.id, 0, 100) > 0
      expect(byBehaviour, ex.id).toBe(deriveIsBodyweightLift(ex))
    }
  })

  it('regions are a non-empty, deduped subset of the four training regions', () => {
    for (const ex of EXERCISES) {
      const regions = deriveRegions(ex)
      expect(regions.length, ex.id).toBeGreaterThan(0)
      expect(new Set(regions).size, ex.id).toBe(regions.length)
      for (const r of regions) expect(['push', 'pull', 'legs', 'core']).toContain(r)
    }
  })

  it('matches the seeded anchors asserted in the DB build verification', () => {
    const facts = Object.fromEntries(
      EXERCISES.map((ex) => [ex.id, { bw: deriveIsBodyweightLift(ex), regions: deriveRegions(ex).sort() }]),
    )
    expect(facts['pushup']).toEqual({ bw: true, regions: ['push'] })
    expect(facts['barbell-bench-press']).toEqual({ bw: false, regions: ['push'] })
    expect(facts['deadlift']).toEqual({ bw: false, regions: ['core', 'legs'] })
  })
})
