/**
 * Pure, dependency-free fixed-window rate limiter shared by the attacker-reachable Edge Functions
 * (spec .pipeline/spec.md). Deliberately NO Deno or Stripe (esm.sh) imports here — only local
 * structural types and arithmetic — so the limiter logic is unit-testable under BOTH `deno test`
 * (supabase/functions/_shared/rateLimit_test.ts) and the repo's vitest runner
 * (src/__tests__/rateLimit.test.ts), exactly like ../_shared/subscription.ts. Keep it pure: the clock
 * is injected (`now`), the store is swappable, and there is no I/O in the decision function itself.
 */

/** Fixed-window budget: at most `limit` requests per `windowMs` per key. */
export interface RateLimitConfig {
  limit: number // > 0 integer; max allowed hits per window
  windowMs: number // > 0; window length in epoch ms
}

/** What a window currently holds for one key. Stored value; serialisable. */
export interface RateLimitEntry {
  count: number // hits so far in the current window
  windowStart: number // epoch ms at which the current window began
}

/** Outcome of one checkRateLimit call. */
export interface RateLimitResult {
  allowed: boolean
  limit: number // echoes config.limit
  remaining: number // max(0, limit - count) AFTER this hit (0 when blocked)
  resetAt: number // epoch ms when the current window ends (windowStart + windowMs)
  retryAfterMs: number // 0 when allowed; else ms until resetAt (>= 0)
}

/**
 * Pluggable store. Async so a real impl (Postgres/Redis) drops in unchanged. `get` returns the current
 * entry or null; `set` persists it. No atomic CAS is required — single-instance in-memory use is
 * race-free within an event loop tick; the interface is intentionally minimal (documented limitation,
 * spec §11). The pure fn decides expiry, NOT the store.
 */
export interface RateLimitStore {
  get(key: string): Promise<RateLimitEntry | null>
  set(key: string, entry: RateLimitEntry): Promise<void>
}

/** Default in-memory store: a Map, no eviction beyond overwrite-on-write (per-instance, per cold start). */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, RateLimitEntry>()

  get(key: string): Promise<RateLimitEntry | null> {
    return Promise.resolve(this.entries.get(key) ?? null)
  }

  set(key: string, entry: RateLimitEntry): Promise<void> {
    this.entries.set(key, entry)
    return Promise.resolve()
  }

  /** Test/ops helper: current number of tracked keys. */
  size(): number {
    return this.entries.size
  }

  /** Test helper: wipe all keys. */
  clear(): void {
    this.entries.clear()
  }
}

/**
 * Minimal structural shape of a Supabase client's `.rpc(...)` we depend on — declared locally so this
 * module stays import-free (no esm.sh / supabase-js) and unit-testable under both `deno test` and vitest,
 * exactly like the rest of the file. The caller injects the real service-role client at the edge.
 */
export interface RpcRunner {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
}

/**
 * Cross-instance store backed by the `public.consume_rate_limit` RPC (migration
 * 20260628210000_rate_limit_buckets_and_consume_rpc). Unlike the in-memory store, the budget is shared
 * across ALL warm function instances, so a per-uid budget can't be diluted by fan-out.
 *
 * It nominally satisfies RateLimitStore for interface conformance, but the ONLY supported path is the
 * atomic `consume()` below — it performs the read-modify-write in ONE statement server-side, which the
 * two-await get/set dance of `checkRateLimit` cannot do across instances. get()/set() therefore reject:
 * a non-atomic read/write would silently defeat the cross-instance guarantee. Callers use `consume()`.
 */
export class PostgresRateLimitStore implements RateLimitStore {
  constructor(private readonly client: RpcRunner) {}

  /**
   * Atomically consume one hit from `key`'s window and report the outcome. Errors are NOT swallowed here
   * (a rejecting/erroring RPC throws) so the caller owns the fail-open vs fail-closed policy — matching
   * `checkRateLimit`, whose store errors also propagate. `now` is epoch ms (injected clock) used only to
   * compute resetAt/retryAfterMs for the response headers; the authoritative window lives in Postgres.
   */
  async consume(key: string, config: RateLimitConfig, now: number): Promise<RateLimitResult> {
    const windowSeconds = Math.max(1, Math.ceil(config.windowMs / 1000))
    const { data, error } = await this.client.rpc('consume_rate_limit', {
      p_key: key,
      p_limit: config.limit,
      p_window_seconds: windowSeconds,
    })
    if (error) throw error instanceof Error ? error : new Error(String((error as { message?: string })?.message ?? error))
    const allowed = data === true
    const resetAt = now + config.windowMs
    return {
      allowed,
      limit: config.limit,
      remaining: allowed ? Math.max(0, config.limit - 1) : 0,
      resetAt,
      retryAfterMs: allowed ? 0 : config.windowMs,
    }
  }

  // get()/set() exist only to satisfy RateLimitStore. The decision is atomic and lives in `consume()`;
  // there is intentionally no non-atomic read/write path that could defeat the cross-instance guarantee.
  get(_key: string): Promise<RateLimitEntry | null> {
    return Promise.reject(new Error('PostgresRateLimitStore is atomic via consume(); get() is unsupported'))
  }

  set(_key: string, _entry: RateLimitEntry): Promise<void> {
    return Promise.reject(new Error('PostgresRateLimitStore is atomic via consume(); set() is unsupported'))
  }
}

/**
 * Pure fixed-window decision. Reads the key's entry, decides allow/deny for THIS hit, writes the
 * updated entry back, and returns the result. `now` is epoch ms (injectable clock) and is used raw — no
 * rounding. A hit that lands on/after `windowStart + windowMs` starts a fresh window (count = 1). Store
 * errors are NOT swallowed: a rejecting get() rejects this promise (fail-open is the caller's policy).
 */
export async function checkRateLimit(
  store: RateLimitStore,
  key: string,
  config: RateLimitConfig,
  now: number,
): Promise<RateLimitResult> {
  const { limit, windowMs } = config
  const entry = await store.get(key)

  // New window: no entry yet, or the prior window has elapsed (>= boundary opens a fresh window).
  if (entry === null || now >= entry.windowStart + windowMs) {
    const next: RateLimitEntry = { count: 1, windowStart: now }
    await store.set(key, next)
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - 1),
      resetAt: now + windowMs,
      retryAfterMs: 0,
    }
  }

  // Still inside the current window.
  const resetAt = entry.windowStart + windowMs
  if (entry.count >= limit) {
    // Blocked: never increment past the limit (don't let blocked hits inflate the count).
    await store.set(key, entry)
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetAt,
      retryAfterMs: Math.max(0, resetAt - now),
    }
  }

  // Allowed: consume one from the budget.
  entry.count += 1
  await store.set(key, entry)
  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - entry.count),
    resetAt,
    retryAfterMs: 0,
  }
}

/**
 * Build the standard 429 headers from a (blocked) result. Retry-After is integer SECONDS, clamped to a
 * minimum of 1 (a `Retry-After: 0` invites an instant retry). Reset is emitted as unix seconds.
 */
export function rateLimitResponseHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'Retry-After': String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))),
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.floor(result.resetAt / 1000)),
  }
}

/**
 * Named budgets (single source of truth; tuned per endpoint sensitivity). Set conservatively so no
 * legitimate human/Stripe traffic is ever throttled, while a scripted flood is stopped. Adjust here.
 */
export const LIMITS: {
  GATED_WRITE: RateLimitConfig
  DELETE_ACCOUNT: RateLimitConfig
  PUBLIC_IP: RateLimitConfig
} = {
  GATED_WRITE: { limit: 10, windowMs: 60_000 }, // checkout / portal / auto-renew, per uid
  DELETE_ACCOUNT: { limit: 3, windowMs: 600_000 }, // per uid, irreversible — stricter
  PUBLIC_IP: { limit: 60, windowMs: 60_000 }, // webhook / reconcile, per IP
}
