// Deno mirror test for the pure fixed-window rate limiter. Run with `deno test supabase/functions/`.
// Named *_test.ts (Deno convention) so the repo's vitest runner — which globs **/*.test.* — ignores it;
// the identical behavior is covered by src/__tests__/rateLimit.test.ts under vitest (the `pnpm test` gate).
// This file is RED until ./rateLimit.ts exists.
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { assertRejects } from 'https://deno.land/std@0.224.0/assert/assert_rejects.ts'
import {
  checkRateLimit,
  rateLimitResponseHeaders,
  InMemoryRateLimitStore,
  LIMITS,
  type RateLimitConfig,
  type RateLimitStore,
} from './rateLimit.ts'

const ONE_PER_SEC: RateLimitConfig = { limit: 1, windowMs: 1000 }
const THREE_PER_SEC: RateLimitConfig = { limit: 3, windowMs: 1000 }

Deno.test('row 1: first hit allowed, remaining limit-1, store holds count 1', async () => {
  const store = new InMemoryRateLimitStore()
  const r = await checkRateLimit(store, 'k', THREE_PER_SEC, 0)
  assertEquals(r, { allowed: true, limit: 3, remaining: 2, resetAt: 1000, retryAfterMs: 0 })
  assertEquals(await store.get('k'), { count: 1, windowStart: 0 })
})

Deno.test('row 3: (limit+1)-th hit blocked, count never exceeds limit', async () => {
  const store = new InMemoryRateLimitStore()
  await checkRateLimit(store, 'k', THREE_PER_SEC, 0)
  await checkRateLimit(store, 'k', THREE_PER_SEC, 100)
  await checkRateLimit(store, 'k', THREE_PER_SEC, 200)
  const fourth = await checkRateLimit(store, 'k', THREE_PER_SEC, 300)
  assertEquals(fourth.allowed, false)
  assertEquals(fourth.retryAfterMs, 700)
  assertEquals((await store.get('k'))?.count, 3)
})

Deno.test('row 5: hit exactly at windowStart+windowMs starts a fresh window', async () => {
  const store = new InMemoryRateLimitStore()
  await checkRateLimit(store, 'k', ONE_PER_SEC, 0)
  const boundary = await checkRateLimit(store, 'k', ONE_PER_SEC, 1000)
  assertEquals(boundary.allowed, true)
  assertEquals(boundary.resetAt, 2000)
})

Deno.test('row 6: 1ms before reset with count at limit is still blocked, retryAfterMs 1', async () => {
  const store = new InMemoryRateLimitStore()
  await checkRateLimit(store, 'k', ONE_PER_SEC, 0)
  const justBefore = await checkRateLimit(store, 'k', ONE_PER_SEC, 999)
  assertEquals(justBefore.allowed, false)
  assertEquals(justBefore.retryAfterMs, 1)
})

Deno.test('row 9: distinct keys are independent', async () => {
  const store = new InMemoryRateLimitStore()
  await checkRateLimit(store, 'A', ONE_PER_SEC, 0)
  assertEquals((await checkRateLimit(store, 'A', ONE_PER_SEC, 100)).allowed, false)
  assertEquals((await checkRateLimit(store, 'B', ONE_PER_SEC, 100)).allowed, true)
})

Deno.test('row 11: store get() that throws makes checkRateLimit reject', async () => {
  const throwingStore: RateLimitStore = {
    get: () => Promise.reject(new Error('down')),
    set: async () => {},
  }
  await assertRejects(() => checkRateLimit(throwingStore, 'k', LIMITS.PUBLIC_IP, 0), Error, 'down')
})

Deno.test('row 12: rateLimitResponseHeaders ceils Retry-After and emits X-RateLimit-*', () => {
  assertEquals(
    rateLimitResponseHeaders({ allowed: false, limit: 10, remaining: 0, resetAt: 5000, retryAfterMs: 1500 }),
    { 'Retry-After': '2', 'X-RateLimit-Limit': '10', 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '5' },
  )
})

Deno.test('row 13: retryAfterMs 0 clamps Retry-After to 1', () => {
  assertEquals(
    rateLimitResponseHeaders({ allowed: false, limit: 60, remaining: 0, resetAt: 60_000, retryAfterMs: 0 })['Retry-After'],
    '1',
  )
})

Deno.test('row 14: store size/clear/missing-key semantics', async () => {
  const store = new InMemoryRateLimitStore()
  assertEquals(store.size(), 0)
  assertEquals(await store.get('missing'), null)
  await store.set('a', { count: 1, windowStart: 0 })
  await store.set('b', { count: 1, windowStart: 0 })
  assertEquals(store.size(), 2)
  store.clear()
  assertEquals(store.size(), 0)
})

Deno.test('LIMITS exposes the tuned budgets', () => {
  assertEquals(LIMITS.GATED_WRITE, { limit: 10, windowMs: 60_000 })
  assertEquals(LIMITS.DELETE_ACCOUNT, { limit: 3, windowMs: 600_000 })
  assertEquals(LIMITS.PUBLIC_IP, { limit: 60, windowMs: 60_000 })
})
