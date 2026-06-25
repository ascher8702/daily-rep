import { describe, it, expect } from 'vitest'
import {
  groupExercises,
  supersetLabel,
  exerciseGroupLabel,
  supersetMembers,
  supersetPartnerBehind,
  nextSupersetIndex,
  planLiftGroupInfo,
  toggleGroupWithNext,
  normalizeGroups,
} from '../lib/supersets'
import type { WorkoutExercise } from '../types'

function we(exerciseId: string, group?: string): WorkoutExercise {
  return { exerciseId, instanceId: exerciseId, targetReps: [8, 12], sets: [], group }
}

/** like we() but with `total` working sets, the first `done` marked complete. */
function weS(exerciseId: string, group: string | undefined, done: number, total: number): WorkoutExercise {
  const sets = Array.from({ length: total }, (_, i) => ({ id: `${exerciseId}${i}`, weight: 100, reps: 8, done: i < done }))
  return { exerciseId, instanceId: exerciseId, targetReps: [8, 12] as [number, number], sets, group }
}

describe('groupExercises', () => {
  it('keeps ungrouped exercises as singletons (no letters)', () => {
    const groups = groupExercises([we('a'), we('b'), we('c')])
    expect(groups).toHaveLength(3)
    expect(groups.every((g) => g.members.length === 1 && g.letter === '')).toBe(true)
  })

  it('brackets consecutive same-group lifts and assigns letters in order', () => {
    const groups = groupExercises([
      we('squat'),
      we('curl', 'A'),
      we('pushdown', 'A'),
      we('calf'),
      we('lat', 'B'),
      we('reardelt', 'B'),
    ])
    expect(groups.map((g) => g.members.length)).toEqual([1, 2, 1, 2])
    expect(groups[1].letter).toBe('A') // first multi-member group
    expect(groups[3].letter).toBe('B') // second multi-member group
    // ungrouped singletons never get a letter
    expect(groups[0].letter).toBe('')
    expect(groups[2].letter).toBe('')
  })

  it('does NOT merge same-group ids that are not adjacent', () => {
    const groups = groupExercises([we('a', 'A'), we('b'), we('c', 'A')])
    // A … (B) … A are two separate single-member groups, so neither is a real superset
    expect(groups).toHaveLength(3)
    expect(groups.every((g) => g.members.length === 1)).toBe(true)
  })

  it('treats a collapsed one-member group as a straight set (no letter)', () => {
    // e.g. the partner lift got dropped by equipment substitution
    const groups = groupExercises([we('only', 'A'), we('next')])
    expect(groups[0].members).toHaveLength(1)
    expect(groups[0].letter).toBe('') // not rendered as a superset
  })
})

describe('supersetLabel', () => {
  it('names group sizes', () => {
    expect(supersetLabel(2)).toBe('Superset')
    expect(supersetLabel(3)).toBe('Tri-set')
    expect(supersetLabel(4)).toBe('Circuit')
    expect(supersetLabel(6)).toBe('Circuit')
    expect(supersetLabel(1)).toBe('')
  })
})

describe('exerciseGroupLabel', () => {
  it('returns A1/A2 for superset members and null for straight sets', () => {
    const list = [we('squat'), we('curl', 'A'), we('pushdown', 'A')]
    expect(exerciseGroupLabel(list, 0)).toBeNull()
    expect(exerciseGroupLabel(list, 1)).toBe('A1')
    expect(exerciseGroupLabel(list, 2)).toBe('A2')
  })
})

describe('superset interleave (increment 2)', () => {
  it('supersetMembers returns the group indices, or null for a straight / collapsed set', () => {
    const list = [we('squat'), we('curl', 'A'), we('pushdown', 'A'), we('only', 'B'), we('calf')]
    expect(supersetMembers(list, 0)).toBeNull() // straight set
    expect(supersetMembers(list, 1)).toEqual([1, 2])
    expect(supersetMembers(list, 2)).toEqual([1, 2])
    expect(supersetMembers(list, 3)).toBeNull() // 'B' collapsed to one member
  })

  it('supersetPartnerBehind drives shared rest: ahead of a partner = suppress, even = rest', () => {
    // A1 has done 1 set, A2 has done 0 → from A1 you are ahead → suppress rest (go to A2)
    const ahead = [we('squat'), weS('curl', 'A', 1, 3), weS('pushdown', 'A', 0, 3)]
    expect(supersetPartnerBehind(ahead, 1)).toBe(true)
    expect(supersetPartnerBehind(ahead, 2)).toBe(false) // A2 is behind, not ahead
    // round complete (both did 1) → no partner behind → rest fires
    const even = [we('squat'), weS('curl', 'A', 1, 3), weS('pushdown', 'A', 1, 3)]
    expect(supersetPartnerBehind(even, 1)).toBe(false)
    // a straight set never suppresses
    expect(supersetPartnerBehind([weS('squat', undefined, 1, 3)], 0)).toBe(false)
  })

  it('nextSupersetIndex alternates A1↔A2 then leaves the group once a partner is done', () => {
    const mid = [weS('curl', 'A', 1, 3), weS('pushdown', 'A', 0, 3)]
    expect(nextSupersetIndex(mid, 0)).toBe(1) // A1 → A2
    expect(nextSupersetIndex(mid, 1)).toBe(0) // A2 → A1
    // A1 fully done, A2 still has sets → from A2 there is no partner needing work
    const partnerDone = [weS('curl', 'A', 3, 3), weS('pushdown', 'A', 1, 3)]
    expect(nextSupersetIndex(partnerDone, 1)).toBeNull()
    // straight set → null
    expect(nextSupersetIndex([weS('squat', undefined, 0, 3)], 0)).toBeNull()
  })
})

describe('plan-builder superset authoring (increment 3)', () => {
  type L = { id: string; group?: string }
  const lift = (id: string, group?: string): L => (group ? { id, group } : { id })
  const groupsOf = (ls: L[]) => ls.map((l) => l.group ?? null)
  const labels = (ls: L[]) => planLiftGroupInfo(ls).map((g) => (g.letter ? `${g.letter}${g.pos + 1}` : '-'))

  it('planLiftGroupInfo labels consecutive same-group lifts A1/A2, singletons blank', () => {
    const ls = [lift('a'), lift('b', 'A'), lift('c', 'A'), lift('d')]
    expect(labels(ls)).toEqual(['-', 'A1', 'A2', '-'])
    expect(planLiftGroupInfo(ls)[1]).toEqual({ letter: 'A', size: 2, pos: 0 })
    expect(planLiftGroupInfo(ls)[2]).toEqual({ letter: 'A', size: 2, pos: 1 })
  })

  it('planLiftGroupInfo treats a lone group member as a straight set', () => {
    expect(labels([lift('a', 'A'), lift('b')])).toEqual(['-', '-'])
  })

  it('toggleGroupWithNext bonds adjacent lifts, then ungroups on a second toggle', () => {
    let ls: L[] = [lift('a'), lift('b'), lift('c')]
    ls = toggleGroupWithNext(ls, 0)
    expect(labels(ls)).toEqual(['A1', 'A2', '-'])
    expect(ls[0].group).toBe(ls[1].group)
    ls = toggleGroupWithNext(ls, 0)
    expect(groupsOf(ls)).toEqual([null, null, null])
  })

  it('toggleGroupWithNext extends a group into a tri-set', () => {
    let ls: L[] = [lift('a', 'A'), lift('b', 'A'), lift('c')]
    ls = toggleGroupWithNext(ls, 1)
    expect(labels(ls)).toEqual(['A1', 'A2', 'A3'])
    expect(new Set(ls.map((l) => l.group)).size).toBe(1)
  })

  it('toggleGroupWithNext keeps two separate supersets as A and B', () => {
    let ls: L[] = [lift('a'), lift('b'), lift('c'), lift('d')]
    ls = toggleGroupWithNext(ls, 0)
    ls = toggleGroupWithNext(ls, 2)
    expect(labels(ls)).toEqual(['A1', 'A2', 'B1', 'B2'])
    expect(ls[0].group).not.toBe(ls[2].group)
  })

  it('toggleGroupWithNext is a no-op on the last lift', () => {
    const ls: L[] = [lift('a'), lift('b')]
    expect(toggleGroupWithNext(ls, 1)).toBe(ls)
  })

  it('normalizeGroups dissolves a group whose members are no longer adjacent', () => {
    const ls: L[] = [lift('a', 'A'), lift('x'), lift('b', 'A')]
    expect(groupsOf(normalizeGroups(ls))).toEqual([null, null, null])
  })

  it('normalizeGroups preserves an intact adjacent group (reassigning the letter id)', () => {
    const out = normalizeGroups([lift('a', 'Z'), lift('b', 'Z'), lift('c')])
    expect(out[0].group).toBe(out[1].group)
    expect(out[0].group).toBe('A')
    expect(out[2].group).toBeUndefined()
    expect(labels(out)).toEqual(['A1', 'A2', '-'])
  })
})
