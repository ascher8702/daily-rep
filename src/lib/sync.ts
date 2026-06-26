import { supabase, STATE_TABLE } from './supabase'
import { reportError } from './telemetry'
import type { Json } from './database.types'
import { useStore, mergePersisted, type AppState } from '../store/useStore'

/**
 * Offline-first cloud sync. localStorage (the Zustand `persist` blob under `daily-rep-v1`) stays the
 * instant source of truth; this layer reconciles it with the user's `daily_rep_state` row in Supabase:
 *  - on sign-in: pull the cloud row; if it's newer than local (by a client logical clock) adopt it,
 *    otherwise push local up to claim/update it (covers first sign-in adopting existing local data),
 *  - on every local change: debounce-push the blob up.
 * It never blocks the UI and degrades to local-only when offline or unconfigured.
 */

const META_KEY = 'daily-rep-sync-meta' // { clientUpdatedAt } — our logical last-edit clock
const STORE_KEY = 'daily-rep-v1' // the Zustand persist key

let clientUpdatedAt = readClock()
let pushTimer: ReturnType<typeof setTimeout> | null = null
let unsubscribe: (() => void) | null = null
let userId: string | null = null
let lastPushedJson = '' // skip redundant upserts of identical state
let detachVisibility: (() => void) | null = null
let pulling = false // in-flight guard so rapid focus/visibility events don't stack pulls
let lastPushAt = 0 // wall-clock ms of the last SUCCESSFUL push (0 = nothing synced yet this session)
let pushRetry: ReturnType<typeof setTimeout> | null = null // pending backoff retry timer

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
 * Reset the local sync clock to 0 — call on SIGN-OUT (paired with useStore.resetAll()). Without this,
 * the next user to sign in on this device could have an OLDER cloud `client_updated_at` than the
 * lingering clock from the previous user, so pullAndReconcile would treat local as "newer" and push
 * this device's reset-default state OVER their real cloud data. Zeroing the clock guarantees their
 * cloud row is adopted instead.
 */
export function resetSyncClock(): void {
  writeClock(0)
  lastPushedJson = ''
  lastPushAt = 0
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

function persistedState(): Json | null {
  try {
    return parsePersistedState(localStorage.getItem(STORE_KEY))
  } catch {
    return null // localStorage unavailable (SSR / non-DOM env)
  }
}

async function pushNow(attempt = 0): Promise<void> {
  if (!supabase || !userId) return
  const data = persistedState()
  if (!data) return
  const json = JSON.stringify(data)
  if (json === lastPushedJson) return // nothing changed since the last push (or a newer push already won)
  const { error } = await supabase.from(STATE_TABLE).upsert(
    {
      user_id: userId,
      data,
      client_updated_at: new Date(clientUpdatedAt || Date.now()).toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (!error) {
    lastPushedJson = json
    lastPushAt = Date.now()
    return
  }
  // A push can fail transiently (offline / timeout) or hard (RLS / quota). Surface it instead of
  // silently swallowing it, then retry with bounded exponential backoff. The strictly-increasing client
  // clock (nextClock) means a later retry still wins, and the lastPushedJson guard means a retry
  // self-cancels once any newer push has already succeeded — so a stale retry can't clobber fresher data.
  console.warn(`[sync] push failed (attempt ${attempt + 1}/${MAX_PUSH_RETRIES + 1}): ${error.message}`)
  if (attempt >= MAX_PUSH_RETRIES) {
    reportError(error, { scope: 'sync.push', attempts: attempt + 1 }) // retries exhausted → report
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
      writeClock(cloudTs)
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

/** Stop syncing (sign-out): flush a final push, then detach. */
export async function stopSync(): Promise<void> {
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
  if (pushRetry) {
    clearTimeout(pushRetry)
    pushRetry = null
  }
  await pushNow() // best-effort final flush
  unsubscribe?.()
  unsubscribe = null
  detachVisibility?.()
  detachVisibility = null
  userId = null
}
