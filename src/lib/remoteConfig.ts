import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { supabase } from './supabase'
import { idbStorage } from './idbStorage'

/**
 * A reusable, resource-agnostic remote-config layer: fetch (supabase) → validate (schema, drop bad
 * rows) → merge (over a bundled seed) → cache (IndexedDB via idbStorage) → hydrate-from-cache-first →
 * background-refresh-and-overwrite-cache. The supabase client and storage are INJECTED (defaulting to
 * the app's real ones) so the whole thing is unit-testable in node with fakes.
 *
 * Today the only consumer is the plan catalogue (see plansRemote.ts); equipment and other bundled
 * settings can adopt the identical pattern by defining their own `RemoteConfigResource` — see
 * docs/remote-config.md. The layer never knows a resource's shape: it speaks in `Item` (one validated
 * catalogue entry) and `Value` (the merged catalogue the app consumes).
 */

/** A row as selected from the resource's table (only the projected columns are guaranteed). */
export type RemoteRow = Record<string, unknown>

/** Outcome of a refresh, so callers can distinguish "kept seed" from "applied N rows" w/o throwing. */
export type RefreshResult<T> =
  | { status: 'applied'; value: T; rowCount: number; dropped: number }
  | { status: 'empty'; value: T } // query ok, 0 valid rows → resolve to seed/merge([])
  | { status: 'unavailable'; value: T } // no client / offline / query error → keep current value

/**
 * Storage surface the cache needs — structurally satisfied by `idbStorage` (zustand's `StateStorage`,
 * whose set/remove return `unknown | Promise<unknown>`), and by a plain in-memory fake. We only ever
 * `await` these, so the write return type is intentionally wide.
 */
export interface AsyncKV {
  getItem(name: string): string | null | Promise<string | null>
  setItem(name: string, value: string): unknown
  removeItem(name: string): unknown
}

/**
 * A resource definition: everything generic `createRemoteConfig` needs to fetch+validate+merge+cache
 * one bundled-config resource (plans today; equipment/etc. later) without knowing its shape.
 *
 * `Item` = one validated catalogue entry (e.g. WorkoutPlan). `Value` = the merged catalogue the app
 * consumes (e.g. WorkoutPlan[]). They're separate so a resource can merge into something other than a
 * plain array if needed.
 */
export interface RemoteConfigResource<Item, Value> {
  /** stable key, also used to derive the cache key: `daily-rep-remote-config:<key>` */
  key: string
  /** the public-read table name in `public` */
  table: keyof Database['public']['Tables']
  /** column(s) to select; the row passed to `parseRows` has exactly these */
  select: string
  /** active-flag column (optional; mirror today's plans query) → `.eq(activeColumn, true)` */
  activeColumn?: string
  /** order column (optional; mirror today's plans query) → `.order(orderColumn)` */
  orderColumn?: string
  /** validate a batch of raw rows → the valid items (invalid rows dropped). Pure. */
  parseRows: (rows: RemoteRow[]) => { items: Item[]; dropped: number }
  /** merge validated remote items over the bundled seed → the value the app consumes. Pure. */
  merge: (items: readonly Item[]) => Value
  /** the bundled seed value (merge([]) equivalent); returned when remote is empty/unavailable on cold start */
  seed: Value
  /** validate a cache payload (untrusted: schema may have changed since it was written). Pure. */
  parseCache: (raw: unknown) => Item[] | null
  /** serialize items for the cache (default: identity → JSON). */
  serializeCache?: (items: readonly Item[]) => unknown
}

export interface RemoteConfigDeps {
  /** defaults to the app's `supabase`; pass null to simulate offline/unconfigured */
  client?: SupabaseClient<Database> | null
  /** defaults to `idbStorage` */
  storage?: AsyncKV
  /** for the cache envelope timestamp (testability) */
  now?: () => number
}

export interface RemoteConfigHandle<Item, Value> {
  /** Cache key in storage. */
  readonly cacheKey: string
  /**
   * Read + validate the cached items and merge them. Returns the seed value when there's no (valid)
   * cache. NEVER throws. Used for the first paint so the last DB catalogue shows offline/instantly.
   */
  hydrateFromCache(): Promise<{ value: Value; fromCache: boolean }>
  /**
   * Fetch live rows, validate, merge, and (on success with ≥1 valid row) overwrite the cache. On any
   * failure/offline returns `unavailable` and leaves the cache intact. NEVER throws.
   */
  refresh(): Promise<RefreshResult<Value>>
}

/**
 * Cache envelope written under `cacheKey`. The `v`/`key` guards let a future schema change invalidate a
 * stale cache cleanly (a mismatched envelope is treated as "no cache" → seed).
 */
interface CacheEnvelope {
  v: number
  key: string
  updatedAt: number
  items: unknown
}

const CACHE_KEY_PREFIX = 'daily-rep-remote-config:'
const CACHE_SCHEMA_VERSION = 1

export function createRemoteConfig<Item, Value>(
  resource: RemoteConfigResource<Item, Value>,
  deps?: RemoteConfigDeps,
): RemoteConfigHandle<Item, Value> {
  const cacheKey = `${CACHE_KEY_PREFIX}${resource.key}`
  // Read deps lazily at call time (not bind time) so the real `supabase`/`idbStorage` are picked up even
  // if they initialize after this handle is constructed at module load.
  const getClient = (): SupabaseClient<Database> | null =>
    deps && 'client' in deps ? (deps.client ?? null) : supabase
  const getStorage = (): AsyncKV => deps?.storage ?? idbStorage
  const now = deps?.now ?? Date.now
  const serialize = resource.serializeCache ?? ((items: readonly Item[]) => items)

  async function refresh(): Promise<RefreshResult<Value>> {
    const client = getClient()
    if (!client) return { status: 'unavailable', value: resource.seed }

    let data: unknown
    try {
      // Build the query exactly as today's plans fetch: select → (eq active) → (order). We assert the
      // builder type loosely because the projected columns aren't statically known to the layer.
      let query = client.from(resource.table).select(resource.select) as unknown as {
        eq(column: string, value: unknown): typeof query
        order(column: string): Promise<{ data: unknown; error: unknown }>
        then: Promise<{ data: unknown; error: unknown }>['then']
      }
      if (resource.activeColumn) query = query.eq(resource.activeColumn, true)
      const res = resource.orderColumn
        ? await query.order(resource.orderColumn)
        : await (query as unknown as Promise<{ data: unknown; error: unknown }>)
      if (res.error || !res.data) return { status: 'unavailable', value: resource.seed }
      data = res.data
    } catch {
      return { status: 'unavailable', value: resource.seed }
    }

    const rows = Array.isArray(data) ? (data as RemoteRow[]) : []
    const { items, dropped } = resource.parseRows(rows)

    // 0 valid rows → "no override". Resolve to the seed/merge([]) and DON'T touch the cache: an empty
    // or all-invalid read must never wipe a previously-good cache (offline-first, edge case §7.12).
    if (items.length === 0) return { status: 'empty', value: resource.merge([]) }

    const envelope: CacheEnvelope = {
      v: CACHE_SCHEMA_VERSION,
      key: resource.key,
      updatedAt: now(),
      items: serialize(items),
    }
    try {
      await getStorage().setItem(cacheKey, JSON.stringify(envelope))
    } catch {
      // best-effort cache (quota / private mode): keep the live value, just don't persist it this run.
    }
    return { status: 'applied', value: resource.merge(items), rowCount: items.length, dropped }
  }

  async function hydrateFromCache(): Promise<{ value: Value; fromCache: boolean }> {
    const seed = { value: resource.seed, fromCache: false }
    let raw: string | null
    try {
      raw = await getStorage().getItem(cacheKey)
    } catch {
      return seed
    }
    if (!raw) return seed

    let envelope: CacheEnvelope
    try {
      envelope = JSON.parse(raw) as CacheEnvelope
    } catch {
      void removeCorrupt()
      return seed
    }
    if (!envelope || envelope.v !== CACHE_SCHEMA_VERSION || envelope.key !== resource.key) {
      void removeCorrupt()
      return seed
    }

    // The cache is untrusted (schema may have changed since it was written) → re-validate fully.
    const items = resource.parseCache(envelope.items)
    if (!items || items.length === 0) return seed
    return { value: resource.merge(items), fromCache: true }
  }

  async function removeCorrupt(): Promise<void> {
    try {
      await getStorage().removeItem(cacheKey)
    } catch {
      // best-effort cleanup
    }
  }

  return { cacheKey, hydrateFromCache, refresh }
}
