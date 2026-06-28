import { supabase, STATE_TABLE } from './supabase'
import { reportError, reportEvent } from './telemetry'
import type { Json } from './database.types'
import { useStore, mergePersisted, partializeState, type AppState } from '../store/useStore'

/**
 * Offline-first cloud sync. localStorage (the Zustand `persist` blob under `daily-rep-v1`) stays the
 * instant source of truth; this layer reconciles it with the user's `daily_rep_state` row in Supabase:
 *  - on sign-in: pull the cloud row; if it's newer than local (by a client logical clock) adopt it,
 *    otherwise push local up to claim/update it (covers first sign-in adopting existing local data),
 *  - on every local change: debounce-push the blob up.
 * It never blocks the UI and degrades to local-only when offline or unconfigured.
 */

const META_KEY = 'daily-rep-sync-meta' // { clientUpdatedAt } — our logical last-edit clock

let clientUpdatedAt = readClock()
let pushTimer: ReturnType<typeof setTimeout> | null = null
let unsubscribe: (() => void) | null = null
let userId: string | null = null
let lastPushedJson = '' // skip redundant upserts of identical state
let detachVisibility: (() => void) | null = null
let pulling = false // in-flight guard so rapid focus/visibility events don't stack pulls
let lastPushAt = 0 // wall-clock ms of the last SUCCESSFUL push (0 = nothing synced yet this session)
let pushRetry: ReturnType<typeof setTimeout> | null = null // pending backoff retry timer

// DEFAULT read-WRITE: today's behavior is byte-identical (the gate is a no-op `if (false) return`). The
// future web-analytics-dashboard build calls setSyncReadOnly(true) at startup so it NEVER writes the
// user's blob (it only reads / adopts). No in-app caller yet.
let syncReadOnly = false

/** Enable/disable read-only sync. When ON, the sync layer NEVER calls the DB upsert (pushNow) — neither
 *  the debounced local-change push NOR the focus/visibility else-branch push in pullAndReconcile, the
 *  stopSync flush, or the retry. Pull / adopt is unaffected. Default OFF (read-write). Exported for the
 *  future dashboard build + unit tests. */
export function setSyncReadOnly(value: boolean): void {
  syncReadOnly = value
}

/** Whether sync is currently read-only (no writes). Exported for tests / a future status indicator. */
export function isSyncReadOnly(): boolean {
  return syncReadOnly
}

const MAX_PUSH_RETRIES = 4 // attempts = 1 initial + 4 retries
const PUSH_BACKOFF_BASE_MS = 1000

/** Exponential backoff (ms) for push retry `attempt` (0-based): 1s, 2s, 4s, 8s… capped at 30s. Pure. */
export function backoffMs(attempt: number): number {
  return Math.min(PUSH_BACKOFF_BASE_MS * 2 ** attempt, 30_000)
}

/** Wall-clock ms of the last successful cloud push this session (0 if none yet) — for a "synced ·
 *  Xm ago" indicator / debugging. */
export function lastSyncedAt(): number {
  return lastPushAt
}

/** Parse the persisted sync-clock meta, guarding the value: only a FINITE NUMBER is a valid clock.
 *  A corrupt blob (string/null/Infinity/garbage JSON) → 0, so `new Date(clientUpdatedAt)` in pushNow
 *  can't be fed an invalid value and emit an "Invalid Date" / RangeError. Pure + exported for tests. */
export function parseClock(raw: string | null): number {
  try {
    const v = JSON.parse(raw || '{}')?.clientUpdatedAt
    return typeof v === 'number' && Number.isFinite(v) ? v : 0
  } catch {
    return 0
  }
}

function readClock(): number {
  try {
    return parseClock(localStorage.getItem(META_KEY))
  } catch {
    return 0 // localStorage unavailable (SSR / non-DOM env) → start from 0
  }
}
function writeClock(ts: number) {
  clientUpdatedAt = ts
  try {
    localStorage.setItem(META_KEY, JSON.stringify({ clientUpdatedAt: ts }))
  } catch {
    /* storage full / unavailable — sync still works in-memory this session */
  }
}

/** Clear per-account sync metadata after the local app state is intentionally scrubbed. */
export function clearSyncMetadata(): void {
  clientUpdatedAt = 0
  lastPushedJson = ''
  lastPushAt = 0
  try {
    localStorage.removeItem(META_KEY)
  } catch {
    /* storage unavailable — in-memory reset above is enough for this session */
  }
}

/**
 * Strictly-increasing sync clock. Using `Date.now()` alone can move the clock BACKWARD — below a value
 * this device previously synced or adopted from the cloud (another device wrote with a slightly-ahead
 * clock, a clock-skewed device, or a future-dated import/seed). A push with a non-greater
 * `client_updated_at` is treated as stale by the server's monotonic guard, which silently reverts it —
 * so the latest local data never reaches the DB. Advancing past the last value (and never emitting two
 * equal timestamps for two edits in the same millisecond, which the guard also rejects) guarantees a
 * device can always sync its own latest data forward.
 */
export function nextClock(prev: number, now: number): number {
  return Math.max(prev + 1, now)
}

/**
 * The clock to stamp AFTER adopting a newer cloud blob: strictly past BOTH the old local clock and the
 * adopted `cloudTs`, via `Math.max(local, cloud) + 1`. The `+1` is load-bearing: at the adopt branch
 * `local < cloud`, so `nextClock(local, cloud)` returns exactly `cloud`, and a push at
 * `client_updated_at == cloud` is REVERTED by the server's `<=` monotonic guard
 * (`daily_rep_guard_monotonic`) — silently losing the merged (unioned) blob. Strictly `> cloud` lets the
 * next push survive that guard so the union actually reaches the DB. Pure + exported for tests.
 */
export function clockAfterAdopt(local: number, cloud: number): number {
  return Math.max(local, cloud) + 1
}

/** The partialized state blob exactly as persisted to localStorage. */
/** Parse the Zustand persist blob's `.state`, guarding it's a real (non-null, non-array) OBJECT before
 *  it's pushed as the cloud `data` — a corrupt blob whose `.state` is a string/array/null/garbage → null
 *  (so pushNow skips it) rather than uploading a malformed shape. Pure + exported for tests. */
export function parsePersistedState(raw: string | null): Json | null {
  try {
    const s = JSON.parse(raw || '{}')?.state
    return s && typeof s === 'object' && !Array.isArray(s) ? (s as Json) : null
  } catch {
    return null
  }
}

/**
 * The exact blob we sync, read from the in-memory store — the source of truth once hydrated — rather
 * than from storage. This decouples sync from the (now async, IndexedDB) persistence backend: we no
 * longer read the raw localStorage blob, and `partializeState` guarantees local + cloud serialize the
 * identical shape. (`parsePersistedState` above stays for parsing a raw stored/cloud blob in tests.)
 */
function persistedState(): Json | null {
  return partializeState(useStore.getState()) as unknown as Json
}

/**
 * Resolve once `persist` has finished its async (IndexedDB) rehydration, so the very first reconcile
 * can't read pre-hydration default state and push it over the user's cloud data.
 */
function waitForHydration(): Promise<void> {
  try {
    if (useStore.persist.hasHydrated()) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const unsub = useStore.persist.onFinishHydration(() => {
        unsub()
        resolve()
      })
    })
  } catch {
    return Promise.resolve() // persist API unavailable → don't block sync
  }
}

/**
 * A push error that will NEVER succeed on retry, so it must not trigger the backoff retry or an error
 * report. Currently: a row-level-security denial (Postgres `42501`), e.g. the server-side entitlement
 * gate blocking a lapsed/un-entitled user's write. Exported for unit testing.
 */
export function isTerminalPushError(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42501'
}

/** UTF-8 byte length of a string (NOT String.length, so a multi-byte note/name isn't undercounted —
 *  the whole point of the size metric is an accurate p95 payload BYTES figure). Pure + exported. */
export function byteLength(s: string): number {
  return typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(s).length
    : Buffer.byteLength(s, 'utf8')
}

/** Number of completed workouts carried by a blob — `0` when the field is absent or not an array (no
 *  throw). Pure + exported. */
export function workoutCount(data: Json): number {
  const w = (data as { workouts?: unknown } | null)?.workouts
  return Array.isArray(w) ? w.length : 0
}

/** The push attempt's outcome, so the caller (`pushNow`) can drive the retry/terminal handling without
 *  the inner helper needing to know about timers. */
export interface PushResult {
  ok: boolean
  skipped?: boolean // the blob was identical to the last successful push → upsert deliberately skipped
  error?: { code?: string; message?: string }
}

/**
 * The minimal supabase surface `runPush` uses — just `from(table).upsert(row, opts)` resolving to an
 * `{ error }` result. Typed structurally (not `Pick<SupabaseClient<Database>, 'from'>`) so the real
 * client AND a hand-rolled FAKE (the repo's no-supabase-mock test convention) both satisfy it without
 * the full PostgrestQueryBuilder surface. The real `supabase.from(...).upsert(...)` is a thenable that
 * resolves to a superset of `{ error }`, so it's assignable here.
 */
export interface PushClient {
  from(table: string): {
    upsert(
      row: { user_id: string; data: Json; client_updated_at: string },
      opts: { onConflict: string },
    ): PromiseLike<{ error: { code?: string; message?: string } | null }>
  }
}

/**
 * The injectable push body: read-only gate → unchanged-skip → upsert → success bookkeeping + telemetry.
 * Extracted from `pushNow` so the read-only suppression and the `sync.push` telemetry are unit-testable
 * with a FAKE supabase client (the repo's no-supabase-mock convention) — `pushNow` calls it with the
 * real `supabase` singleton + module clock. Side effects (lastPushedJson / lastPushAt) are shared module
 * state so the unchanged-skip and the "synced Xm ago" clock work the same on both paths. Exported for tests.
 */
export async function runPush(
  client: PushClient,
  uid: string,
  blob: Json,
  clockMs: number,
  opts: { readOnly?: boolean } = {},
): Promise<PushResult> {
  // Read-only mode: NEVER write. Returns before persistedState/JSON-compare/upsert, so it covers EVERY
  // pushNow caller (debounced push, the pullAndReconcile focus else-branch, the stopSync flush, the retry).
  if (opts.readOnly) return { ok: true, skipped: true }
  const json = JSON.stringify(blob)
  if (json === lastPushedJson) return { ok: true, skipped: true } // nothing changed since the last push
  const t0 = Date.now()
  const { error } = await client.from(STATE_TABLE).upsert(
    {
      user_id: uid,
      data: blob,
      client_updated_at: new Date(clockMs).toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (!error) {
    lastPushedJson = json
    lastPushAt = Date.now()
    // The size/latency sensor: emit ONLY on a real, successful, non-skipped write so the deferred
    // "normalize at p95 >256KB / >1s" decision becomes an observed trigger rather than a guess.
    reportEvent('sync.push', {
      bytes: byteLength(json),
      workouts: workoutCount(blob),
      ms: lastPushAt - t0,
    })
    return { ok: true }
  }
  // A row-level-security denial (Postgres 42501) is a PERMANENT, expected outcome — e.g. a lapsed /
  // un-entitled user blocked by the server-side entitlement gate (is_active_subscriber). Treat it as
  // terminal: record a low-severity event and stop (no retry, no reportError, no sync.push success).
  if (isTerminalPushError(error)) {
    reportEvent('sync.push.denied', { code: error.code })
    return { ok: false, error }
  }
  return { ok: false, error }
}

async function pushNow(attempt = 0): Promise<void> {
  if (!supabase || !userId) return
  const data = persistedState()
  if (!data) return
  const res = await runPush(supabase, userId, data, clientUpdatedAt || Date.now(), {
    readOnly: syncReadOnly,
  })
  if (res.ok || res.skipped || !res.error) return
  // A terminal 42501 denial already emitted sync.push.denied inside runPush — nothing more to do.
  if (isTerminalPushError(res.error)) return
  // Otherwise a push can fail transiently (offline / timeout) or hard (quota). Surface it instead of
  // silently swallowing it, then retry with bounded exponential backoff. The strictly-increasing client
  // clock (nextClock) means a later retry still wins, and the lastPushedJson guard means a retry
  // self-cancels once any newer push has already succeeded — so a stale retry can't clobber fresher data.
  console.warn(
    `[sync] push failed (attempt ${attempt + 1}/${MAX_PUSH_RETRIES + 1}): ${res.error.message}`,
  )
  if (attempt >= MAX_PUSH_RETRIES) {
    reportError(res.error, { scope: 'sync.push', attempts: attempt + 1 }) // retries exhausted → report
    return
  }
  if (pushRetry) clearTimeout(pushRetry)
  pushRetry = setTimeout(() => {
    pushRetry = null
    void pushNow(attempt + 1)
  }, backoffMs(attempt))
}

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer)
  // a fresh local change supersedes any pending failure-retry (it'll re-read the latest state anyway)
  if (pushRetry) {
    clearTimeout(pushRetry)
    pushRetry = null
  }
  pushTimer = setTimeout(() => {
    pushTimer = null
    void pushNow()
  }, 2000)
}

/** Pull the cloud row and reconcile against local (offline-first last-write-wins). */
async function pullAndReconcile(): Promise<void> {
  if (!supabase || !userId || pulling) return
  pulling = true
  try {
    const { data: row, error } = await supabase
      .from(STATE_TABLE)
      .select('data, client_updated_at')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      reportError(error, { scope: 'sync.pull' })
      return
    }
    const cloudTs = row?.client_updated_at ? new Date(row.client_updated_at).getTime() : 0
    if (row?.data && cloudTs > clientUpdatedAt) {
      // cloud is newer → adopt it (hardened through the store's own merge for safety)
      const merged = mergePersisted(row.data as unknown as Partial<AppState>, useStore.getState())
      useStore.setState(merged)
      lastPushedJson = JSON.stringify(persistedState())
      // Bump strictly past cloudTs (NOT pin at cloudTs). setState above already fired the store
      // subscription, which set the clock to nextClock(oldLocal, Date.now()) — but if cloudTs was
      // written by a clock-ahead device that value can be < cloudTs, so the next push would land at
      // client_updated_at < cloudTs and be reverted by the server's <= guard (the union never reaches
      // the DB). The explicit max(local, cloud)+1 overrides that and guarantees the next push survives.
      writeClock(clockAfterAdopt(clientUpdatedAt, cloudTs))
    } else {
      // local is newer or the cloud row is empty → claim/update the cloud copy from local
      await pushNow()
    }
  } finally {
    pulling = false
  }
}

/** Begin syncing for a signed-in user: reconcile once, then push on local changes (debounced). */
export async function startSync(uid: string): Promise<void> {
  if (!supabase) return
  userId = uid
  lastPushedJson = ''
  // Persisted state loads asynchronously from IndexedDB; wait for it before the first reconcile so we
  // never adopt-or-overwrite based on empty default state (which could clobber the cloud copy).
  await waitForHydration()
  await pullAndReconcile()
  unsubscribe?.()
  // any persisted state change advances our logical clock (strictly increasing — see nextClock) and
  // queues a push, so this device always syncs its latest data forward past whatever it last stored
  unsubscribe = useStore.subscribe(() => {
    writeClock(nextClock(clientUpdatedAt, Date.now()))
    schedulePush()
  })

  // A returning / refocused tab refetches before it can clobber newer cloud data written by another
  // device (pairs with the server-side monotonic-clock guard). reconcile decides push-vs-adopt.
  detachVisibility?.()
  if (typeof document !== 'undefined') {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void pullAndReconcile()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    detachVisibility = () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }
}

/** Stop syncing. By default this flushes once before detaching; destructive account deletion skips it. */
export async function stopSync(opts: { flush?: boolean } = {}): Promise<void> {
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
  if (pushRetry) {
    clearTimeout(pushRetry)
    pushRetry = null
  }
  if (opts.flush !== false) await pushNow() // best-effort final flush
  unsubscribe?.()
  unsubscribe = null
  detachVisibility?.()
  detachVisibility = null
  userId = null
}
