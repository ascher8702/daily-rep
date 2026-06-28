import { describe, it, expect } from 'vitest'
import { idbStorage } from '../lib/idbStorage'
import { partializeState, useStore } from '../store/useStore'

/**
 * The real IndexedDB path can't run under vitest's node environment (no `indexedDB`), so it's verified
 * live in the browser. These cover the parts that DO run in node: the graceful-degradation fallback
 * chain (IndexedDB → localStorage → in-memory) and the persisted-snapshot shape that both local
 * storage and cloud sync serialize.
 */

describe('idbStorage fallback (no IndexedDB / no localStorage → in-memory)', () => {
  it('round-trips a value through set → get → remove', async () => {
    await idbStorage.setItem('idb-test-key', 'hello')
    expect(await idbStorage.getItem('idb-test-key')).toBe('hello')
    await idbStorage.removeItem('idb-test-key')
    expect(await idbStorage.getItem('idb-test-key')).toBeNull()
  })

  it('returns null for a missing key', async () => {
    expect(await idbStorage.getItem('idb-never-written')).toBeNull()
  })

  it('overwrites an existing value', async () => {
    await idbStorage.setItem('idb-test-key2', 'first')
    await idbStorage.setItem('idb-test-key2', 'second')
    expect(await idbStorage.getItem('idb-test-key2')).toBe('second')
    await idbStorage.removeItem('idb-test-key2')
  })
})

describe('partializeState (persisted/synced snapshot shape)', () => {
  const PERSISTED_KEYS = [
    'activePlan',
    'avoidNoticeDismissedId',
    'current',
    'customPlans',
    'deletedWorkoutIds',
    'planDayEdits',
    'planOverrides',
    'planProgress',
    'profile',
    'workouts',
  ]

  it('persists exactly the intended keys', () => {
    const snap = partializeState(useStore.getState())
    expect(Object.keys(snap).sort()).toEqual(PERSISTED_KEYS)
  })

  it('never persists the hydration flag, its setter, or transient rest-timer UI', () => {
    const snap = partializeState(useStore.getState()) as Record<string, unknown>
    expect('_hasHydrated' in snap).toBe(false)
    expect('setHasHydrated' in snap).toBe(false)
    expect('restEndsAt' in snap).toBe(false)
    expect('restDuration' in snap).toBe(false)
  })
})
