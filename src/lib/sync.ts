import { supabase, STATE_TABLE } from './supabase'
import { reportError, reportEvent } from './telemetry'
import type { Json } from './database.types'
import { useStore, mergePersisted, partializeState, loggedSetCount, type AppState } from '../store/useStore'

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
// Logged-set count of the active session as of the last store change we observed. When it INCREASES
// (the user just logged a real set) we flush immediately instead of waiting out the 2s debounce, so the
// loss window for a freshly-logged set racing a crash / device switch is as small as possible.
let lastLoggedSetCount = 0

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

/**
 * Whether a store change should flush PAST the 2s debounce (push immediately). True ONLY when the active
 * session's logged-set count INCREASED (the user just logged a real set — the highest-value, most
 * loss-sensitive change) AND no pull/adopt is in flight.
 *
 * The `!pulling` guard is load-bearing: the store subscription also fires inside `pullAndReconcile`'s
 * `setState(merged)` — BEFORE that function updates `lastPushedJson` and stamps `clockAfterAdopt`. An
 * immediate push there would upload the just-adopted blob at the wrong (pre-adopt) clock, which the
 * server's `<=` monotonic guard would silently revert — losing the merge. Deferring to the debounce lets
 * the post-adopt write land first, after which the debounced push correctly unchanged-skips (or pushes
 * at the right clock). A decrease / no-change in the count is never an immediate flush. Pure + exported.
 */
export function shouldFlushImmediately(prevCount: number, nextCount: number, pulling: boolean): boolean {
  return nextCount > prevCount && !pulling
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

/** The synced blob for an ARBITRARY state (not the live store) — exactly `partializeState`, so the
 *  equal-clock tie-break in `reconcileDecision` compares the cloud row against the SAME serialized shape
 *  the device would push. Pure (no store/IO access). */
function persistedBlob(state: AppState): Json {
  return partializeState(state) as unknown as Json
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

/**
 * Push NOW, bypassing the 2s debounce — used the instant the user logs a set, where the extra debounce
 * delay is a real data-loss window if the tab closes / device dies. Cancels any pending debounced push
 * and failure-retry first (they'd re-read the same latest state, so they're redundant), then pushes the
 * current blob. Goes through the same pushNow path, so the read-only gate, the strictly-increasing clock,
 * and the lastPushedJson unchanged-skip all still apply unchanged.
 */
function pushImmediate() {
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
  if (pushRetry) {
    clearTimeout(pushRetry)
    pushRetry = null
  }
  void pushNow()
}

/** A cloud row as read for reconcile: its blob and the raw `client_updated_at` ISO string (or null
 *  for an empty/absent row). The minimal shape `reconcileDecision` needs — the real
 *  `supabase.select('data, client_updated_at').maybeSingle()` result is assignable to it. */
export interface CloudRow {
  data: Json | null
  client_updated_at: string | null
}

/**
 * The pure result of reconciling a fetched cloud row against local state:
 *  - `adopt`  → the cloud row is newer; carries the merged next state (mergePersisted of cloud over
 *               local) and the next clock value (clockAfterAdopt of local + cloudTs) to apply.
 *  - `push`   → local is newer or the cloud row is empty; the caller pushes local up.
 *  The `cloudTs` is included for telemetry/debugging; it never changes the action.
 */
export type ReconcileResult =
  | { action: 'adopt'; nextState: AppState; nextClock: number; cloudTs: number }
  | { action: 'push'; cloudTs: number }

/**
 * The PURE decision + merge core of `pullAndReconcile`, factored out so the stateful adopt/push race
 * gets real (node-friendly, supabase-free) integration coverage. Given the already-fetched cloud row
 * (or null), the current local state, the current local clock, and opts, it decides the branch and —
 * for adopt — precomputes the merged next state and the post-adopt clock. It performs NO side effects:
 * no supabase calls, no useStore.setState, no timers, no global/document/window access. The caller
 * (`pullAndReconcile`) applies the result with the same side effects, in the same order, as before.
 *
 * Branch contract:
 *   cloudTs = row.client_updated_at ? Date(...).getTime() : 0
 *   adopt  ⇔ row.data is present AND (cloudTs > localClock OR (cloudTs == localClock AND blobs DIFFER))
 *   else   ⇒ push
 * The adopt branch merges cloud OVER local via mergePersisted and stamps clockAfterAdopt(localClock,
 * cloudTs) — strictly past cloudTs so the post-adopt push survives the server's `<=` monotonic guard.
 *
 * The `cloudTs == localClock` tie-break is load-bearing, NOT cosmetic: two devices can independently
 * reach the SAME clock (same-millisecond completion, or convergent nextClock values) and push concurrently.
 * The first push wins the server's strictly-greater guard; the second device's push is then rejected
 * (its clock is `<=` the stored one) and — with a strict `>` predicate — it would NEVER adopt either,
 * permanently splitting brains (it keeps its own blob, the cloud keeps the winner's, each loses the
 * other's committed workouts). Adopting on the equal-clock tie when the blobs actually differ runs the
 * loss-free union-merge and bumps clockAfterAdopt past the tie, so the union reaches the cloud on the
 * next genuine edit and both devices converge. The blobs-differ guard keeps an idempotent equal-clock
 * repull (this device's own last write echoed back) on the push/unchanged-skip path — no needless
 * adopt + clock bump. `opts` is accepted for parity with the call site (and future field-merge gating);
 * it does not change the decision today. Pure + exported for tests.
 */
export function reconcileDecision(
  row: CloudRow | null,
  localState: AppState,
  localClock: number,
  _opts: { readOnly?: boolean } = {},
): ReconcileResult {
  const cloudTs = row?.client_updated_at ? new Date(row.client_updated_at).getTime() : 0
  if (row?.data) {
    // adopt when cloud is strictly newer, OR on an exact-clock tie whose blob genuinely differs (the
    // same-clock-collision case — see the tie-break note above). A tie with an identical blob is the
    // device's own write echoed back: fall through to push (which unchanged-skips), not a wasted adopt.
    const tieDiffers =
      cloudTs === localClock && JSON.stringify(row.data) !== JSON.stringify(persistedBlob(localState))
    if (cloudTs > localClock || tieDiffers) {
      // cloud is newer (or a divergent tie) → adopt it (hardened through the store's own union-merge)
      const nextState = mergePersisted(row.data as unknown as Partial<AppState>, localState)
      // Bump strictly past cloudTs (NOT pin at cloudTs): clockAfterAdopt = max(local, cloud)+1 so the
      // next push lands at client_updated_at > cloudTs and survives the server's `<=` revert guard.
      return { action: 'adopt', nextState, nextClock: clockAfterAdopt(localClock, cloudTs), cloudTs }
    }
  }
  // local is newer or the cloud row is empty → claim/update the cloud copy from local
  return { action: 'push', cloudTs }
}

/**
 * Pull the cloud row and reconcile against local (offline-first last-write-wins). Runs on the initial
 * sign-in reconcile AND on every returning/refocused-tab repull: when the cloud row is newer we adopt
 * it through the store's union-merge (mergePersisted/unionWorkouts), which is loss-free for workouts[]
 * and the current session even if the newer cloud row was written by another device. A focus repull
 * does NOT defer the adopt to protect an unsynced LOCAL wholesale-field edit (profile/activePlan/…):
 * that would require field-level merge (deferred — whole-blob LWW), and the unmerged-push deferral it
 * replaced could permanently overwrite committed workouts another device had added. Plain adopt (cloud
 * wholesale wins on the race) is the accepted, documented LWW limitation and is strictly safer than
 * losing committed workouts.
 *
 * The branch + merge is computed by the pure `reconcileDecision`; this function only FETCHES the row
 * and APPLIES the result (setState of the merged state, lastPushedJson bookkeeping, writeClock, or the
 * else-branch pushNow) — the same side effects, in the same order, as the previous inline body.
 */
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
    const decision = reconcileDecision(row, useStore.getState(), clientUpdatedAt, {
      readOnly: syncReadOnly,
    })
    if (decision.action === 'adopt') {
      // cloud is newer → adopt the precomputed merged state, then stamp the post-adopt clock
      useStore.setState(decision.nextState)
      lastPushedJson = JSON.stringify(persistedState())
      // setState above already fired the store subscription, which set the clock to
      // nextClock(oldLocal, Date.now()) — but that can be < cloudTs if cloud was written by a
      // clock-ahead device, so the next push would be reverted by the server's <= guard. The explicit
      // clockAfterAdopt (max(local, cloud)+1) overrides that and guarantees the next push survives.
      writeClock(decision.nextClock)
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
  // baseline the logged-set counter to the post-reconcile session so the first real set logged after
  // sign-in counts as an INCREASE (and flushes immediately), not a same-as-baseline no-op
  lastLoggedSetCount = loggedSetCount(useStore.getState().current)
  unsubscribe?.()
  // any persisted state change advances our logical clock (strictly increasing — see nextClock) and
  // queues a push, so this device always syncs its latest data forward past whatever it last stored
  unsubscribe = useStore.subscribe(() => {
    writeClock(nextClock(clientUpdatedAt, Date.now()))
    // A newly-logged set is the highest-value, most loss-sensitive change — flush it past the debounce
    // immediately (unless a pull/adopt is in flight). Any other change (or a decrease/no-change in the
    // count) takes the normal 2s debounce. The decision + its load-bearing !pulling guard live in the
    // pure, unit-tested `shouldFlushImmediately`.
    const count = loggedSetCount(useStore.getState().current)
    const flushNow = shouldFlushImmediately(lastLoggedSetCount, count, pulling)
    lastLoggedSetCount = count
    if (flushNow) pushImmediate()
    else schedulePush()
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
