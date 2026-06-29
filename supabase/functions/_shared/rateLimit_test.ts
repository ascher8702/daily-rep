// Deno mirror test for the pure fixed-window rate limiter. Run with `deno test supabase/functions/`.
// Named *_test.ts (Deno convention) so the repo's vitest runner — which globs **/*.test.* — ignores it;
// the identical behavior is covered by src/__tests__/rateLimit.test.ts under vitest (the `pnpm test` gate).
// This file is RED until ./rateLimit.ts exists.
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { assertRejects } from 'https://deno.land/std@0.224.0/assert/assert_rejects.ts'
import {
  checkRateLimit,
  consumeRateLimitWithFallback,
  rateLimitResponseHeaders,
  InMemoryRateLimitStore,
  LIMITS,
  PostgresRateLimitStore,
  type RateLimitConfig,
  type RateLimitStore,
  type RpcRunner,
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

// --- PostgresRateLimitStore (cross-instance store backed by the consume_rate_limit RPC) ---

/** Build a fake RpcRunner that asserts the call shape and returns a canned { data, error }. */
function fakeRpc(impl: (fn: string, args: Record<string, unknown>) => { data: unknown; error: unknown }): {
  runner: RpcRunner
  calls: Array<{ fn: string; args: Record<string, unknown> }>
} {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
  return {
    calls,
    runner: {
      rpc(fn, args) {
        calls.push({ fn, args })
        return Promise.resolve(impl(fn, args))
      },
    },
  }
}

Deno.test('PostgresRateLimitStore.consume: allowed result maps RPC true and converts windowMs→seconds', async () => {
  const { runner, calls } = fakeRpc(() => ({ data: true, error: null }))
  const store = new PostgresRateLimitStore(runner)
  const r = await store.consume('delete-account:u1', LIMITS.DELETE_ACCOUNT, 10_000)
  assertEquals(r, { allowed: true, limit: 3, remaining: 2, resetAt: 610_000, retryAfterMs: 0 })
  assertEquals(calls[0], {
    fn: 'consume_rate_limit',
    args: { p_key: 'delete-account:u1', p_limit: 3, p_window_seconds: 600 },
  })
})

Deno.test('PostgresRateLimitStore.consume: blocked result maps RPC false', async () => {
  const { runner } = fakeRpc(() => ({ data: false, error: null }))
  const store = new PostgresRateLimitStore(runner)
  const r = await store.consume('delete-account:u1', LIMITS.DELETE_ACCOUNT, 0)
  assertEquals(r.allowed, false)
  assertEquals(r.remaining, 0)
  assertEquals(r.retryAfterMs, LIMITS.DELETE_ACCOUNT.windowMs)
})

Deno.test('PostgresRateLimitStore.consume: RPC error throws (caller owns fail-open)', async () => {
  const { runner } = fakeRpc(() => ({ data: null, error: { message: 'rpc down' } }))
  const store = new PostgresRateLimitStore(runner)
  await assertRejects(() => store.consume('k', LIMITS.DELETE_ACCOUNT, 0), Error, 'rpc down')
})

Deno.test('PostgresRateLimitStore: get/set are unsupported (atomic via consume only)', async () => {
  const { runner } = fakeRpc(() => ({ data: true, error: null }))
  const store = new PostgresRateLimitStore(runner)
  await assertRejects(() => store.get('k'), Error)
  await assertRejects(() => store.set('k', { count: 1, windowStart: 0 }), Error)
})

Deno.test('consumeRateLimitWithFallback: uses the Postgres RPC when available', async () => {
  const { runner, calls } = fakeRpc(() => ({ data: true, error: null }))
  const fallback = new InMemoryRateLimitStore()
  const r = await consumeRateLimitWithFallback(runner, fallback, 'delete-account:u1', LIMITS.DELETE_ACCOUNT, 0)
  assertEquals(r?.allowed, true)
  assertEquals(calls.length, 1)
  assertEquals(fallback.size(), 0)
})

Deno.test('consumeRateLimitWithFallback: falls back to in-memory when the RPC fails', async () => {
  const { runner, calls } = fakeRpc(() => ({ data: null, error: { message: 'rpc down' } }))
  const fallback = new InMemoryRateLimitStore()
  const r = await consumeRateLimitWithFallback(runner, fallback, 'delete-account:u1', LIMITS.DELETE_ACCOUNT, 0)
  assertEquals(r?.allowed, true)
  assertEquals(calls.length, 1)
  assertEquals(fallback.size(), 1)
})
