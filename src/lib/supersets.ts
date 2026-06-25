import type { WorkoutExercise } from '../types'

export interface ExerciseGroup {
  /** the shared group id, or null for a standalone (straight-set) exercise */
  groupId: string | null
  /** display letter (A, B, …) for a real multi-member group; '' for singletons */
  letter: string
  members: { we: WorkoutExercise; index: number }[]
}

/**
 * Partition a session's exercises into ordered groups: CONSECUTIVE exercises sharing the same
 * non-empty `group` id become one superset/tri-set/circuit; everything else is its own singleton.
 * Only multi-member groups get a display letter (A, B, …), so a group that collapsed to one lift
 * (e.g. its partner was dropped by equipment substitution) renders as a normal straight set.
 */
export function groupExercises(exercises: WorkoutExercise[]): ExerciseGroup[] {
  const groups: ExerciseGroup[] = []
  exercises.forEach((we, index) => {
    const gid = we.group && we.group.trim() ? we.group : null
    const last = groups[groups.length - 1]
    if (gid && last && last.groupId === gid) {
      last.members.push({ we, index })
    } else {
      groups.push({ groupId: gid, letter: '', members: [{ we, index }] })
    }
  })
  let code = 65 // 'A'
  for (const g of groups) {
    if (g.groupId && g.members.length >= 2) g.letter = String.fromCharCode(code++)
  }
  return groups
}

/** Human label for N exercises performed together. '' for fewer than 2. */
export function supersetLabel(size: number): string {
  if (size === 2) return 'Superset'
  if (size === 3) return 'Tri-set'
  if (size >= 4) return 'Circuit'
  return ''
}

/** The A1/B2-style label for one exercise, given its session, or null if it's a straight set. */
export function exerciseGroupLabel(exercises: WorkoutExercise[], index: number): string | null {
  for (const g of groupExercises(exercises)) {
    if (!g.letter) continue
    const pos = g.members.findIndex((m) => m.index === index)
    if (pos >= 0) return `${g.letter}${pos + 1}`
  }
  return null
}

// ---- interleaved set flow (superset "increment 2") ----

const workingDone = (we: WorkoutExercise) => we.sets.filter((s) => !s.warmup && s.done).length
const hasUndoneWorking = (we: WorkoutExercise) => we.sets.some((s) => !s.warmup && !s.done)

/** Ordered member indices of the multi-member superset containing `index`, or null for a straight set
 *  / a group that collapsed to one lift (so the interleave logic only kicks in for real supersets). */
export function supersetMembers(exercises: WorkoutExercise[], index: number): number[] | null {
  for (const g of groupExercises(exercises)) {
    if (!g.letter) continue
    if (g.members.some((m) => m.index === index)) return g.members.map((m) => m.index)
  }
  return null
}

/**
 * True when this exercise has just pulled AHEAD of a superset partner (some partner has fewer completed
 * working sets) — meaning the round isn't finished, so you should alternate to the partner rather than
 * rest. Drives the SHARED rest: auto-rest is suppressed until the round completes (counts even out).
 */
export function supersetPartnerBehind(exercises: WorkoutExercise[], index: number): boolean {
  const members = supersetMembers(exercises, index)
  if (!members) return false
  const mine = workingDone(exercises[index])
  return members.some((i) => i !== index && workingDone(exercises[i]) < mine)
}

/**
 * The next superset partner to alternate to — the member cyclically after `index` that still has an
 * undone working set — or null when no partner needs work (finish here / leave the group). Powers the
 * A1→A2→A1… "Next" flow on the exercise screen.
 */
export function nextSupersetIndex(exercises: WorkoutExercise[], index: number): number | null {
  const members = supersetMembers(exercises, index)
  if (!members) return null
  const pos = members.indexOf(index)
  for (let k = 1; k < members.length; k++) {
    const i = members[(pos + k) % members.length]
    if (hasUndoneWorking(exercises[i])) return i
  }
  return null
}

// ---- plan-builder superset authoring (increment 3) ----
// Operate on any item carrying an optional `group` id (e.g. PlanLift), so the builder can author the
// same CONSECUTIVE-same-group supersets the session flow consumes. A "bond" exists between adjacent
// lifts i and i+1 when they share a non-empty group id; group ids are reassigned A,B,… per run so the
// stored data always reflects actual adjacency (no orphaned single-member groups).

interface Grouped {
  group?: string
}

/** Bond[i] = lift i is supersetted with lift i+1 (same non-empty group id). Length = lifts.length-1. */
function currentBonds(lifts: Grouped[]): boolean[] {
  return lifts.slice(0, Math.max(0, lifts.length - 1)).map(
    (l, i) => !!(l.group && l.group.trim()) && l.group === lifts[i + 1].group,
  )
}

/** Reassign group ids from an adjacency bond array: each maximal run of bonded lifts gets one fresh
 *  letter id; lifts in no run have their group cleared. Deterministic + idempotent. */
function assignGroupsFromBonds<T extends Grouped>(lifts: T[], bonds: boolean[]): T[] {
  const ids: (string | undefined)[] = lifts.map(() => undefined)
  let code = 65 // 'A'
  let r = 0
  while (r < lifts.length) {
    let end = r
    while (end < lifts.length - 1 && bonds[end]) end++
    if (end > r) {
      const id = String.fromCharCode(code++)
      for (let k = r; k <= end; k++) ids[k] = id
    }
    r = end + 1
  }
  return lifts.map((l, idx) => {
    const { group: _drop, ...rest } = l as T & Grouped
    return (ids[idx] ? { ...rest, group: ids[idx] } : { ...rest }) as T
  })
}

/** Re-derive clean group ids from the lifts' current adjacency — call after a reorder/remove so a lift
 *  moved out of a superset (or an orphaned single member) stops claiming a group. */
export function normalizeGroups<T extends Grouped>(lifts: T[]): T[] {
  return assignGroupsFromBonds(lifts, currentBonds(lifts))
}

/** Toggle the superset bond between lift `i` and lift `i+1`, returning a new lifts array with group ids
 *  reassigned. No-op when `i` is the last lift (nothing to group with). */
export function toggleGroupWithNext<T extends Grouped>(lifts: T[], i: number): T[] {
  if (i < 0 || i >= lifts.length - 1) return lifts
  const bonds = currentBonds(lifts)
  bonds[i] = !bonds[i]
  return assignGroupsFromBonds(lifts, bonds)
}

/** Per-lift superset display info: `letter` (A,B,… or '' for a straight set), group `size`, and 0-based
 *  `pos` within the group — so the builder can badge A1/A2 exactly like the session screen. */
export function planLiftGroupInfo(lifts: Grouped[]): { letter: string; size: number; pos: number }[] {
  const info = lifts.map(() => ({ letter: '', size: 1, pos: 0 }))
  const runs: { gid: string | null; ids: number[] }[] = []
  lifts.forEach((l, idx) => {
    const gid = l.group && l.group.trim() ? l.group : null
    const last = runs[runs.length - 1]
    if (gid && last && last.gid === gid) last.ids.push(idx)
    else runs.push({ gid, ids: [idx] })
  })
  let code = 65
  for (const run of runs) {
    if (run.gid === null || run.ids.length < 2) continue
    const letter = String.fromCharCode(code++)
    run.ids.forEach((idx, pos) => (info[idx] = { letter, size: run.ids.length, pos }))
  }
  return info
}
