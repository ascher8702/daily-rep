import { describe, it, expect } from 'vitest'
import type { Equipment } from '../types'
import { isExerciseDoable } from '../lib/equipment'
import { getExercise } from '../data/exercises'

const owned = (...e: Equipment[]) => new Set<Equipment>(e)

describe('isExerciseDoable — equipment co-requirements', () => {
  it('requires the bench for bench movements (barbell alone is not enough)', () => {
    const bench = getExercise('barbell-bench-press')!
    expect(isExerciseDoable(bench, owned('barbell'))).toBe(false)
    expect(isExerciseDoable(bench, owned('barbell', 'bench'))).toBe(true)
  })

  it('requires a pull-up bar for pull-ups (bodyweight alone is not enough)', () => {
    const pullup = getExercise('pullup')!
    expect(isExerciseDoable(pullup, owned('bodyweight'))).toBe(false)
    expect(isExerciseDoable(pullup, owned('pullupbar'))).toBe(true)
  })

  it('treats listed alternatives as any-of', () => {
    const pulldown = getExercise('lat-pulldown')! // ['cable','machine']
    expect(isExerciseDoable(pulldown, owned('cable'))).toBe(true)
    expect(isExerciseDoable(pulldown, owned('machine'))).toBe(true)
    expect(isExerciseDoable(pulldown, owned('barbell'))).toBe(false)
  })

  it('always allows pure bodyweight movements', () => {
    const pushup = getExercise('pushup')!
    expect(isExerciseDoable(pushup, owned())).toBe(true)
  })
})
