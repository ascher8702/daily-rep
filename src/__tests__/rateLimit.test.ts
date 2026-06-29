// Vitest suite for the pure fixed-window rate limiter (spec .pipeline/spec.md).
// Mirrors subscriptionShared.test.ts: imports the canonical _shared source via a relative path.
// One test per §7 row (1–16, the unit-testable pure logic / store / headers). Rows 17–27 are
// Edge-wiring integration contracts → manual QA (see .pipeline/tests.md).
//
// This file is RED until supabase/functions/_shared/rateLimit.ts exists.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  checkRateLimit,
  consumeRateLimitWithFallback,
  rateLimitResponseHeaders,
  InMemoryRateLimitStore,
  LIMITS,
  type RateLimitConfig,
  type RateLimitEntry,
  type RateLimitResult,
  type RateLimitStore,
  type RpcRunner,
} from '../../supabase/functions/_shared/rateLimit'

// Literal configs used throughout — kept small so the boundaries are obvious.
const ONE_PER_SEC: RateLimitConfig = { limit: 1, windowMs: 1000 }
const TWO_PER_SEC: RateLimitConfig = { limit: 2, windowMs: 1000 }
const THREE_PER_SEC: RateLimitConfig = { limit: 3, windowMs: 1000 }

describe('checkRateLimit — pure fixed-window decision', () => {
  let store: InMemoryRateLimitStore
  beforeEach(() => {
    store = new InMemoryRateLimitStore()
  })

  // §7 row 1
  it('row 1: first-ever hit is allowed, remaining = limit-1, retryAfterMs 0, resetAt = now+windowMs, store holds {count:1, windowStart:now}', async () => {
    const r = await checkRateLimit(store, 'k', THREE_PER_SEC, 0)
    expect(r).toEqual({
      allowed: true,
      limit: 3,
      remaining: 2,
      resetAt: 1000,
      retryAfterMs: 0,
    } satisfies RateLimitResult)
    const entry = await store.get('k')
    expect(entry).toEqual({ count: 1, windowStart: 0 } satisfies RateLimitEntry)
  })

  // §7 row 2
  it('row 2: hits 2..limit within one window all allowed, remaining decrements 2,1,0 (limit:3)', async () => {
    const first = await checkRateLimit(store, 'k', THREE_PER_SEC, 0)
    const second = await checkRateLimit(store, 'k', THREE_PER_SEC, 100)
    const third = await checkRateLimit(store, 'k', THREE_PER_SEC, 200)
    expect(first.remaining).toBe(2)
    expect(second.remaining).toBe(1)
    expect(third.remaining).toBe(0)
    expect([first.allowed, second.allowed, third.allowed]).toEqual([true, true, true])
    // resetAt stays pinned to the original window throughout
    expect([first.resetAt, second.resetAt, third.resetAt]).toEqual([1000, 1000, 1000])
  })

  // §7 row 3
  it('row 3: the (limit+1)-th hit in the same window is blocked, remaining 0, retryAfterMs>0, count never exceeds limit', async () => {
    await checkRateLimit(store, 'k', THREE_PER_SEC, 0)
    await checkRateLimit(store, 'k', THREE_PER_SEC, 100)
    await checkRateLimit(store, 'k', THREE_PER_SEC, 200)
    const fourth = await checkRateLimit(store, 'k', THREE_PER_SEC, 300)
    expect(fourth.allowed).toBe(false)
    expect(fourth.remaining).toBe(0)
    expect(fourth.resetAt).toBe(1000)
    expect(fourth.retryAfterMs).toBe(700) // 1000 - 300
    const entry = await store.get('k')
    expect(entry?.count).toBe(3) // stays at limit, does NOT grow to 4
  })

  // §7 row 4
  it('row 4: repeated blocked hits stay blocked; count never grows past limit; retryAfterMs shrinks as now advances', async () => {
    await checkRateLimit(store, 'k', TWO_PER_SEC, 0)
    await checkRateLimit(store, 'k', TWO_PER_SEC, 0)
    const b1 = await checkRateLimit(store, 'k', TWO_PER_SEC, 200)
    const b2 = await checkRateLimit(store, 'k', TWO_PER_SEC, 600)
    const b3 = await checkRateLimit(store, 'k', TWO_PER_SEC, 900)
    expect([b1.allowed, b2.allowed, b3.allowed]).toEqual([false, false, false])
    expect([b1.retryAfterMs, b2.retryAfterMs, b3.retryAfterMs]).toEqual([800, 400, 100])
    const entry = await store.get('k')
    expect(entry?.count).toBe(2) // never past limit
  })

  // §7 row 5
  it('row 5: a hit exactly at now === windowStart+windowMs starts a new window (>= boundary), allowed, count reset to 1', async () => {
    await checkRateLimit(store, 'k', TWO_PER_SEC, 0)
    await checkRateLimit(store, 'k', TWO_PER_SEC, 0) // window now full (count 2)
    const boundary = await checkRateLimit(store, 'k', TWO_PER_SEC, 1000) // exactly windowStart+windowMs
    expect(boundary.allowed).toBe(true)
    expect(boundary.remaining).toBe(1) // fresh window, limit 2, this is hit #1
    expect(boundary.resetAt).toBe(2000) // 1000 + 1000
    expect(boundary.retryAfterMs).toBe(0)
    const entry = await store.get('k')
    expect(entry).toEqual({ count: 1, windowStart: 1000 } satisfies RateLimitEntry)
  })

  // §7 row 6
  it('row 6: at now === windowStart+windowMs-1 (1ms before reset) with count at limit → still blocked, retryAfterMs === 1', async () => {
    await checkRateLimit(store, 'k', ONE_PER_SEC, 0) // count 1, at limit
    const justBefore = await checkRateLimit(store, 'k', ONE_PER_SEC, 999)
    expect(justBefore.allowed).toBe(false)
    expect(justBefore.retryAfterMs).toBe(1) // 1000 - 999
    expect(justBefore.resetAt).toBe(1000)
  })

  // §7 row 7
  it('row 7: a new window after expiry re-allows a previously-blocked key with count:1 and windowStart at the new now', async () => {
    await checkRateLimit(store, 'k', ONE_PER_SEC, 0)
    const blocked = await checkRateLimit(store, 'k', ONE_PER_SEC, 500)
    expect(blocked.allowed).toBe(false)
    // advance well past resetAt (1000)
    const reopened = await checkRateLimit(store, 'k', ONE_PER_SEC, 1500)
    expect(reopened.allowed).toBe(true)
    expect(reopened.remaining).toBe(0) // limit:1, this hit consumes it
    expect(reopened.resetAt).toBe(2500) // 1500 + 1000
    const entry = await store.get('k')
    expect(entry).toEqual({ count: 1, windowStart: 1500 } satisfies RateLimitEntry)
  })

  // §7 row 8
  it('row 8: limit:1 — first hit allowed remaining 0; second in-window hit blocked (strictest config)', async () => {
    const first = await checkRateLimit(store, 'k', ONE_PER_SEC, 0)
    expect(first.allowed).toBe(true)
    expect(first.remaining).toBe(0)
    const second = await checkRateLimit(store, 'k', ONE_PER_SEC, 500)
    expect(second.allowed).toBe(false)
    expect(second.remaining).toBe(0)
    expect(second.retryAfterMs).toBe(500) // 1000 - 500
    expect(second.resetAt).toBe(1000)
  })

  // §7 row 9
  it('row 9: two distinct keys are independent — exhausting key A never blocks key B', async () => {
    // exhaust key A
    await checkRateLimit(store, 'A', ONE_PER_SEC, 0)
    const aBlocked = await checkRateLimit(store, 'A', ONE_PER_SEC, 100)
    expect(aBlocked.allowed).toBe(false)
    // key B is untouched
    const bFirst = await checkRateLimit(store, 'B', ONE_PER_SEC, 100)
    expect(bFirst.allowed).toBe(true)
    expect(bFirst.remaining).toBe(0)
  })

  // §7 row 10
  it('row 10: a stale/expired entry (count at limit but now past window) is treated as a fresh window by the pure fn', async () => {
    // Inject a stale entry directly: count at limit, window started long ago.
    await store.set('k', { count: 1, windowStart: 0 })
    const r = await checkRateLimit(store, 'k', ONE_PER_SEC, 5000) // 5000 >> 0+1000
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(0) // fresh window of limit 1
    expect(r.resetAt).toBe(6000) // 5000 + 1000
    const entry = await store.get('k')
    expect(entry).toEqual({ count: 1, windowStart: 5000 } satisfies RateLimitEntry)
  })

  // §7 row 11
  it('row 11: when the store get() throws, checkRateLimit rejects (it does not swallow store errors)', async () => {
    const throwingStore: RateLimitStore = {
      get: () => Promise.reject(new Error('down')),
      set: async () => {},
    }
    await expect(
      checkRateLimit(throwingStore, 'k', LIMITS.PUBLIC_IP, 0),
    ).rejects.toThrow('down')
  })

  // §7 row 15
  it('row 15: a fractional now (1000.5) is used raw with no internal rounding', async () => {
    const r = await checkRateLimit(store, 'k', ONE_PER_SEC, 1000.5)
    expect(r.allowed).toBe(true)
    expect(r.resetAt).toBe(2000.5) // 1000.5 + 1000, no floor
    const entry = await store.get('k')
    expect(entry).toEqual({ count: 1, windowStart: 1000.5 } satisfies RateLimitEntry)
    // a blocked follow-up keeps the fractional arithmetic exact
    const blocked = await checkRateLimit(store, 'k', ONE_PER_SEC, 1500.25)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBeCloseTo(500.25, 6) // 2000.5 - 1500.25
  })

  // §7 row 16
  it('row 16: large epoch-ms values (windowMs + now well within MAX_SAFE_INTEGER) compute resetAt exactly', async () => {
    const now = 4_000_000_000_000 // ~year 2096 in epoch ms, far below Number.MAX_SAFE_INTEGER
    const config: RateLimitConfig = { limit: 2, windowMs: 60_000 }
    const r = await checkRateLimit(store, 'k', config, now)
    expect(r.allowed).toBe(true)
    expect(r.resetAt).toBe(now + 60_000)
    expect(Number.isSafeInteger(r.resetAt)).toBe(true)
  })

  it('clamps remaining and retryAfterMs to >= 0 even for a deeply over-budget key', async () => {
    await checkRateLimit(store, 'k', ONE_PER_SEC, 0)
    const blocked = await checkRateLimit(store, 'k', ONE_PER_SEC, 999)
    expect(blocked.remaining).toBeGreaterThanOrEqual(0)
    expect(blocked.retryAfterMs).toBeGreaterThanOrEqual(0)
  })
})

describe('InMemoryRateLimitStore', () => {
  // §7 row 14
  it('row 14: size() reflects distinct keys written, clear() empties it, and a missing key returns null', async () => {
    const store = new InMemoryRateLimitStore()
    expect(store.size()).toBe(0)
    expect(await store.get('missing')).toBeNull()

    await store.set('a', { count: 1, windowStart: 0 })
    await store.set('b', { count: 2, windowStart: 0 })
    await store.set('a', { count: 5, windowStart: 0 }) // overwrite, not a new key
    expect(store.size()).toBe(2)
    expect(await store.get('a')).toEqual({ count: 5, windowStart: 0 })

    store.clear()
    expect(store.size()).toBe(0)
    expect(await store.get('a')).toBeNull()
  })
})

describe('rateLimitResponseHeaders', () => {
  // §7 row 12
  it('row 12: a blocked result with retryAfterMs 1500 → Retry-After "2" (ceil) and correct X-RateLimit-* headers', () => {
    const result: RateLimitResult = {
      allowed: false,
      limit: 10,
      remaining: 0,
      resetAt: 5000,
      retryAfterMs: 1500,
    }
    expect(rateLimitResponseHeaders(result)).toEqual({
      'Retry-After': '2',
      'X-RateLimit-Limit': '10',
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': '5', // floor(5000/1000)
    })
  })

  // §7 row 13
  it('row 13: retryAfterMs that rounds to 0 → Retry-After clamped to "1" (never 0)', () => {
    const result: RateLimitResult = {
      allowed: false,
      limit: 60,
      remaining: 0,
      resetAt: 60_000,
      retryAfterMs: 0,
    }
    expect(rateLimitResponseHeaders(result)['Retry-After']).toBe('1')
  })

  it('rounds a sub-second remainder up: retryAfterMs 1 → Retry-After "1"', () => {
    const result: RateLimitResult = {
      allowed: false,
      limit: 1,
      remaining: 0,
      resetAt: 1000,
      retryAfterMs: 1,
    }
    expect(rateLimitResponseHeaders(result)['Retry-After']).toBe('1')
  })
})

describe('LIMITS — named budgets are the single source of truth', () => {
  it('exposes the tuned per-endpoint budgets exactly', () => {
    expect(LIMITS.GATED_WRITE).toEqual({ limit: 10, windowMs: 60_000 })
    expect(LIMITS.DELETE_ACCOUNT).toEqual({ limit: 3, windowMs: 600_000 })
    expect(LIMITS.PUBLIC_IP).toEqual({ limit: 60, windowMs: 60_000 })
  })

  it('GATED_WRITE allows exactly 10 hits/min per key then blocks the 11th', async () => {
    const store = new InMemoryRateLimitStore()
    let last: RateLimitResult | undefined
    for (let i = 0; i < 10; i++) {
      last = await checkRateLimit(store, 'checkout:uid', LIMITS.GATED_WRITE, i * 100)
      expect(last.allowed).toBe(true)
    }
    expect(last?.remaining).toBe(0)
    const eleventh = await checkRateLimit(store, 'checkout:uid', LIMITS.GATED_WRITE, 1100)
    expect(eleventh.allowed).toBe(false)
  })

  it('DELETE_ACCOUNT (stricter) blocks the 4th call within 10 minutes', async () => {
    const store = new InMemoryRateLimitStore()
    for (let i = 0; i < 3; i++) {
      const r = await checkRateLimit(store, 'delete-account:uid', LIMITS.DELETE_ACCOUNT, i * 1000)
      expect(r.allowed).toBe(true)
    }
    const fourth = await checkRateLimit(store, 'delete-account:uid', LIMITS.DELETE_ACCOUNT, 4000)
    expect(fourth.allowed).toBe(false)
    expect(fourth.retryAfterMs).toBe(600_000 - 4000)
  })
})

describe('consumeRateLimitWithFallback', () => {
  function rpc(data: boolean, error: unknown = null): { runner: RpcRunner; calls: number } {
    const state = {
      calls: 0,
      runner: {
        rpc(fn: string, args: Record<string, unknown>) {
          state.calls++
          expect(fn).toBe('consume_rate_limit')
          expect(args).toEqual({ p_key: 'checkout:uid', p_limit: 10, p_window_seconds: 60 })
          return Promise.resolve({ data, error })
        },
      } satisfies RpcRunner,
    }
    return state
  }

  it('uses the Postgres RPC when available', async () => {
    const primary = rpc(true)
    const fallback = new InMemoryRateLimitStore()
    const r = await consumeRateLimitWithFallback(
      primary.runner,
      fallback,
      'checkout:uid',
      LIMITS.GATED_WRITE,
      1000,
    )

    expect(primary.calls).toBe(1)
    expect(r?.allowed).toBe(true)
    expect(fallback.size()).toBe(0)
  })

  it('falls back to the in-memory store when the RPC fails', async () => {
    const primary = rpc(false, { message: 'down' })
    const fallback = new InMemoryRateLimitStore()
    const r = await consumeRateLimitWithFallback(
      primary.runner,
      fallback,
      'checkout:uid',
      LIMITS.GATED_WRITE,
      1000,
    )

    expect(primary.calls).toBe(1)
    expect(r?.allowed).toBe(true)
    expect(fallback.size()).toBe(1)
  })
})
