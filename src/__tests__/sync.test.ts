import { describe, it, expect } from 'vitest'
import { nextClock, backoffMs, parseClock, parsePersistedState } from '../lib/sync'

describe('nextClock (strictly-increasing sync clock)', () => {
  it('tracks wall time when it is ahead of the last clock', () => {
    expect(nextClock(1000, 2000)).toBe(2000)
    expect(nextClock(0, 1_700_000_000_000)).toBe(1_700_000_000_000)
  })

  it('advances past the last clock when wall time is equal or behind (no stale/equal push)', () => {
    // two edits in the same millisecond must NOT emit the same timestamp — the server guard rejects
    // a non-greater client_updated_at, which would silently drop the second edit.
    expect(nextClock(2000, 2000)).toBe(2001)
    // wall clock behind the last clock (device skew, or a previously-adopted ahead-of-wall clock)
    expect(nextClock(5000, 3000)).toBe(5001)
  })

  it('keeps advancing from a future-dated clock so the device always syncs forward', () => {
    const future = 1_700_000_000_000 + 60 * 24 * 3600 * 1000
    const wall = 1_700_000_000_000
    const c1 = nextClock(future, wall)
    expect(c1).toBe(future + 1)
    expect(nextClock(c1, wall)).toBe(future + 2) // strictly monotonic across successive edits
  })
})

describe('backoffMs (push retry backoff)', () => {
  it('doubles each attempt starting at 1s', () => {
    expect(backoffMs(0)).toBe(1000)
    expect(backoffMs(1)).toBe(2000)
    expect(backoffMs(2)).toBe(4000)
    expect(backoffMs(3)).toBe(8000)
  })
  it('caps at 30s for large attempts (no unbounded growth)', () => {
    expect(backoffMs(5)).toBe(30000) // 32s → capped
    expect(backoffMs(20)).toBe(30000)
  })
})

describe('parseClock (sync-meta guard)', () => {
  it('returns a finite-number clock unchanged', () => {
    expect(parseClock('{"clientUpdatedAt": 1700000000000}')).toBe(1700000000000)
  })
  it('falls back to 0 for non-number / missing / non-finite / garbage', () => {
    expect(parseClock('{"clientUpdatedAt": "1700000000000"}')).toBe(0) // string, not a number
    expect(parseClock('{"clientUpdatedAt": null}')).toBe(0)
    expect(parseClock('{"clientUpdatedAt": 1e999}')).toBe(0) // Infinity
    expect(parseClock('{}')).toBe(0)
    expect(parseClock(null)).toBe(0)
    expect(parseClock('not json')).toBe(0)
  })
})

describe('parsePersistedState (persist-blob guard)', () => {
  it('returns the .state object', () => {
    expect(parsePersistedState('{"state": {"workouts": []}}')).toEqual({ workouts: [] })
  })
  it('returns null for a non-object / array / missing / garbage .state', () => {
    expect(parsePersistedState('{"state": "garbage"}')).toBeNull()
    expect(parsePersistedState('{"state": [1,2]}')).toBeNull() // an array is not a valid state shape
    expect(parsePersistedState('{"state": null}')).toBeNull()
    expect(parsePersistedState('{}')).toBeNull()
    expect(parsePersistedState(null)).toBeNull()
    expect(parsePersistedState('bad json')).toBeNull()
  })
})
