import { describe, it, expect } from 'vitest'
import type { Equipment } from '../types'
import { substituteExercise, resolvePlanLifts, PATTERN } from '../lib/substitution'
import { getExercise, EXERCISES } from '../data/exercises'

const owned = (...e: Equipment[]) => new Set<Equipment>([...e, 'bodyweight'])

describe('substituteExercise', () => {
  it('keeps an exercise the user can already perform', () => {
    const r = substituteExercise('barbell-bench-press', owned('barbell', 'bench'), 'hypertrophy')
    expect(r.substituted).toBe(false)
    expect(r.id).toBe('barbell-bench-press')
  })

  it('swaps a barbell bench to an equippable horizontal-push that hits the chest', () => {
    // dumbbells + bench only → should land on a dumbbell/bodyweight press, not a leg lift
    const r = substituteExercise('barbell-bench-press', owned('dumbbell', 'bench'), 'hypertrophy')
    expect(r.substituted).toBe(true)
    const sub = getExercise(r.id)!
    expect(sub.primary).toContain('chest')
    expect(PATTERN[r.id]).toBe('horizontal-push')
  })

  it('falls back to a bodyweight push when only bodyweight is available', () => {
    const r = substituteExercise('barbell-bench-press', owned(), 'general')
    expect(r.substituted).toBe(true)
    const sub = getExercise(r.id)!
    expect(sub.equipment).toContain('bodyweight')
    expect(sub.primary).toContain('chest')
  })

  it('preserves the squat pattern + quads when a barbell squat is unavailable', () => {
    const r = substituteExercise('back-squat', owned('dumbbell'), 'hypertrophy')
    expect(r.substituted).toBe(true)
    const sub = getExercise(r.id)!
    expect(PATTERN[r.id]).toBe('squat')
    expect(sub.primary.some((m) => ['quads', 'glutes'].includes(m))).toBe(true)
  })

  it('is tighter for strength: a barbell squat prefers another free-weight squat over a machine when both are owned', () => {
    // owns dumbbells + machine, no barbell. For STRENGTH, modality specificity favors the
    // free-weight (dumbbell) squat over the machine leg-press.
    const strength = substituteExercise('back-squat', owned('dumbbell', 'machine'), 'strength')
    const subStrength = getExercise(strength.id)!
    expect(subStrength.primary.some((m) => ['quads', 'glutes'].includes(m))).toBe(true)
    // a free-weight (dumbbell) option should win the strength tiebreak, not the machine
    const mod = subStrength.equipment
    expect(mod.includes('dumbbell') || mod.includes('bodyweight')).toBe(true)
  })

  it('every exercise has a movement pattern (substitution invariant is total)', () => {
    for (const ex of EXERCISES) {
      expect(PATTERN[ex.id], `no pattern for ${ex.id}`).toBeDefined()
    }
  })

  it('NEVER returns an off-target swap — the result always shares a primary muscle with the original', () => {
    const goals = ['strength', 'hypertrophy', 'general', 'powerlifting'] as const
    const equipSets: Equipment[][] = [
      ['barbell'],
      ['dumbbell'],
      ['machine'],
      ['cable'],
      ['bodyweight'],
      ['dumbbell', 'bench'],
      ['barbell', 'bench', 'cable', 'machine', 'dumbbell', 'pullupbar'],
    ]
    for (const ex of EXERCISES) {
      for (const es of equipSets) {
        for (const g of goals) {
          const r = substituteExercise(ex.id, new Set<Equipment>([...es, 'bodyweight']), g)
          if (r.substituted) {
            const from = getExercise(ex.id)!
            const to = getExercise(r.id)!
            const shares = from.primary.some((m) => to.primary.includes(m))
            expect(shares, `${ex.id} → ${r.id} shares no primary muscle (${g}, ${es.join('+')})`).toBe(true)
          }
        }
      }
    }
  })

  it('keeps a triceps press a triceps movement, not a chest push-up (off-target regression)', () => {
    const r = substituteExercise('close-grip-bench', new Set<Equipment>(['dumbbell', 'bodyweight']), 'hypertrophy')
    if (r.substituted) expect(getExercise(r.id)!.primary).toContain('triceps')
    else expect(r.id).toBe('close-grip-bench')
  })
})

describe('resolvePlanLifts', () => {
  it('substitutes undoable lifts and reports the swaps', () => {
    const lifts = [
      { exerciseId: 'barbell-bench-press', sets: 3, repMin: 5, repMax: 5 },
      { exerciseId: 'pushup', sets: 3, repMin: 8, repMax: 12 },
    ]
    const { resolved, swaps } = resolvePlanLifts(lifts, owned(), 'general')
    expect(resolved).toHaveLength(2)
    // pushup stays (bodyweight, doable); bench gets swapped
    expect(resolved.find((r) => r.lift.exerciseId === 'pushup')!.exerciseId).toBe('pushup')
    expect(swaps.some((s) => s.from === 'barbell-bench-press')).toBe(true)
  })

  it('resolves to EMPTY when no lift can be equipped (drives the honest "no preview" Home state)', () => {
    // a Bro-Split "Arms" day is all weighted isolations with no bodyweight primary-muscle
    // equivalent in the library → a bodyweight-only user gets zero resolvable lifts
    const armsDay = [
      { exerciseId: 'barbell-curl', sets: 3, repMin: 8, repMax: 12 },
      { exerciseId: 'close-grip-bench', sets: 3, repMin: 8, repMax: 12 },
      { exerciseId: 'triceps-pushdown', sets: 3, repMin: 10, repMax: 15 },
      { exerciseId: 'cable-curl', sets: 3, repMin: 10, repMax: 15 },
    ]
    const { resolved } = resolvePlanLifts(armsDay, new Set<Equipment>(['bodyweight']), 'hypertrophy')
    expect(resolved).toHaveLength(0)
  })

  it('leaves fully-equippable lifts untouched', () => {
    const lifts = [{ exerciseId: 'back-squat', sets: 5, repMin: 5, repMax: 5 }]
    const { resolved, swaps } = resolvePlanLifts(lifts, owned('barbell'), 'strength')
    expect(resolved[0].exerciseId).toBe('back-squat')
    expect(swaps).toHaveLength(0)
  })

  it('does NOT collapse several undoable lifts onto the same substitute (no 4× Pike Push-Up)', () => {
    // a barbell/dumbbell shoulder day for a bodyweight-only user — every lift would otherwise
    // substitute to the single bodyweight shoulder option
    const shoulderDay = [
      { exerciseId: 'overhead-press', sets: 4, repMin: 6, repMax: 12 },
      { exerciseId: 'db-shoulder-press', sets: 4, repMin: 8, repMax: 12 },
      { exerciseId: 'lateral-raise', sets: 4, repMin: 12, repMax: 20 },
    ]
    const { resolved } = resolvePlanLifts(shoulderDay, new Set<Equipment>(['bodyweight']), 'hypertrophy')
    const ids = resolved.map((r) => r.exerciseId)
    expect(new Set(ids).size).toBe(ids.length) // every resolved exercise is distinct
  })

  it('preserves an INTENTIONAL same-lift repeat for an equipped user (5/3/1 main + supplemental)', () => {
    const lifts = [
      { exerciseId: 'barbell-bench-press', sets: 5, repMin: 3, repMax: 5 },
      { exerciseId: 'barbell-bench-press', sets: 5, repMin: 10, repMax: 10 },
    ]
    const { resolved } = resolvePlanLifts(lifts, owned('barbell', 'bench'), 'strength')
    expect(resolved).toHaveLength(2)
    expect(resolved.every((r) => r.exerciseId === 'barbell-bench-press')).toBe(true)
  })

  it('skips a null / exerciseId-less lift without throwing (corrupt-data guard)', () => {
    const lifts = [null, { sets: 3, repMin: 8, repMax: 12 }, { exerciseId: 'pushup', sets: 3, repMin: 8, repMax: 12 }]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const run = () => resolvePlanLifts(lifts as any, owned(), 'general')
    expect(run).not.toThrow()
    const { resolved } = run()
    expect(resolved).toHaveLength(1)
    expect(resolved[0].exerciseId).toBe('pushup')
  })
})
