import { describe, it, expect } from 'vitest'
import {
  mergePersisted,
  partializeState,
  loggedSetCount,
  type AppState,
} from '../store/useStore'
import {
  reconcileDecision,
  shouldFlushImmediately,
  nextClock,
  clockAfterAdopt,
  type CloudRow,
} from '../lib/sync'
import type { Json } from '../lib/database.types'
import type { Workout } from '../types'
import { fullGymProfile } from './fixtures'

/**
 * Multi-device reconcile simulation. The stateful adopt/push race in `pullAndReconcile` is exercised
 * here through the pure `reconcileDecision` plus tiny apply/push helpers that mirror the real apply step
 * and the SERVER monotonic guard — node-friendly, no supabase, no jsdom, deterministic time. The
 * invariants (I1–I6) pin the loss-free / convergence / monotonicity guarantees the flagship sync layer
 * relies on, including a regression guard for the reverted iteration-1 unmerged-push-on-focus bug.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A live AppState (mirrors sync-merge.test.ts's base) — cast through unknown since we omit the actions.
const baseState = (over: Partial<AppState> = {}): AppState =>
  ({
    profile: { ...fullGymProfile },
    workouts: [],
    deletedWorkoutIds: [],
    deletedPlanIds: [],
    current: null,
    activePlan: null,
    restEndsAt: null,
    restDuration: 0,
    customPlans: [],
    planProgress: {},
    planOverrides: {},
    planDayEdits: {},
    ...over,
  }) as unknown as AppState

// A minimal completed workout whose id/date/completedAt are settable.
function wk(id: string, over: Partial<Workout> = {}): Workout {
  return {
    id,
    date: 1,
    status: 'completed',
    title: id,
    focus: [],
    completedAt: 1,
    exercises: [
      { exerciseId: 'barbell-bench-press', targetReps: [8, 12], sets: [{ id: 'a', weight: 135, reps: 8, done: true }] },
    ],
    ...over,
  }
}

// An in-progress (active) session with exactly `n` logged sets plus one pristine pending set, so
// loggedSetCount === n. Mirrors mergePersisted-hydration.test.ts's activeSession.
function activeSession(id: string, loggedSets: number, over: Partial<Workout> = {}): Workout {
  const sets = [
    ...Array.from({ length: loggedSets }, (_, i) => ({ id: `l${i}`, weight: 135, reps: 8, done: true })),
    { id: 'pending', weight: 0, reps: 0, done: false },
  ]
  return {
    id,
    date: 1,
    status: 'active',
    title: id,
    focus: ['chest'],
    startedAt: 1000,
    exercises: [{ exerciseId: 'barbell-bench-press', targetReps: [8, 12], sets }],
    ...over,
  } as Workout
}

// ---------------------------------------------------------------------------
// In-memory cloud row with the SERVER MONOTONIC GUARD
// ---------------------------------------------------------------------------

/**
 * Simulates the `daily_rep_state` row + the server-side BEFORE-UPDATE monotonic guard
 * (`daily_rep_guard_monotonic`): a write is accepted ONLY when its client_updated_at is STRICTLY
 * greater than the stored one; otherwise the stored row is left untouched (the upsert "succeeds" from
 * the client's view but is silently reverted — exactly what the real guard does). Time is passed in
 * as epoch ms so tests are deterministic.
 */
class CloudStore {
  private storedTs = 0 // 0 = no row yet
  data: Json | null = null
  client_updated_at: string | null = null
  accepted = 0
  rejected = 0

  /** A reconcile-shaped read of the current row (null blob/ts when nothing has been written). */
  read(): CloudRow {
    return { data: this.data, client_updated_at: this.client_updated_at }
  }

  /** Attempt a write stamped at `clientUpdatedAtMs`; honor the strictly-greater monotonic guard.
   *  Returns true if the row was actually updated. */
  write(blob: Json, clientUpdatedAtMs: number): boolean {
    if (clientUpdatedAtMs <= this.storedTs) {
      this.rejected += 1
      return false // server guard reverts a non-greater write — stored row unchanged
    }
    this.storedTs = clientUpdatedAtMs
    this.data = blob
    this.client_updated_at = new Date(clientUpdatedAtMs).toISOString()
    this.accepted += 1
    return true
  }
}

// ---------------------------------------------------------------------------
// Device model + helpers that mirror pullAndReconcile's apply step and pushNow
// ---------------------------------------------------------------------------

interface Device {
  name: string
  state: AppState
  clock: number
  lastPushedJson: string
}

function makeDevice(name: string, over: Partial<AppState> = {}, clock = 0): Device {
  return { name, state: baseState(over), clock, lastPushedJson: '' }
}

/** The blob a device persists/syncs — exactly partializeState, as the real push reads it. */
function blobOf(state: AppState): Json {
  return partializeState(state) as unknown as Json
}

/**
 * Mirror the store subscription's clock bump on a LOCAL edit: writeClock(nextClock(clock, now)). The
 * `now` is deterministic. Used to model a device making an unsynced local change before reconciling.
 */
function localEdit(dev: Device, mutate: (s: AppState) => AppState, nowMs: number): void {
  dev.state = mutate(dev.state)
  dev.clock = nextClock(dev.clock, nowMs)
}

/**
 * Mirror `pullAndReconcile`'s apply step exactly: decide via the pure `reconcileDecision`, then
 *  - adopt → setState(merged), recompute lastPushedJson from the merged blob, writeClock(nextClock).
 *  - push  → call pushNow (here: pushTo with the simulated guard).
 * Returns the chosen action so tests can assert which branch fired.
 */
function reconcile(dev: Device, cloud: CloudStore, nowMs: number): 'adopt' | 'push' {
  const decision = reconcileDecision(cloud.read(), dev.state, dev.clock)
  if (decision.action === 'adopt') {
    dev.state = decision.nextState
    dev.lastPushedJson = JSON.stringify(blobOf(dev.state))
    dev.clock = decision.nextClock
    return 'adopt'
  }
  pushTo(dev, cloud, nowMs)
  return 'push'
}

/**
 * Mirror `pushNow`: stamp client_updated_at at the device's current clock (clientUpdatedAt || now) and
 * upsert the partialized blob, skipping a byte-identical re-push (the lastPushedJson guard). The cloud
 * honors its monotonic guard. Records lastPushedJson only on a real attempt, like runPush.
 */
function pushTo(dev: Device, cloud: CloudStore, nowMs: number): void {
  const json = JSON.stringify(blobOf(dev.state))
  if (json === dev.lastPushedJson) return // unchanged-skip (runPush's identical-blob short-circuit)
  cloud.write(JSON.parse(json) as Json, dev.clock || nowMs)
  dev.lastPushedJson = json
}

/** The set of completed-workout ids a device currently persists (sorted) — the converged history. */
function workoutIds(dev: Device): string[] {
  return [...dev.state.workouts.map((w) => w.id)].sort()
}

// ===========================================================================
// I1 — NO COMMITTED-WORKOUT LOSS across a 2-device interleaving
// ===========================================================================
describe('I1 no committed-workout loss: both devices converge to contain X and Y', () => {
  it('A finishes X, B finishes Y, both reconcile → both hold X and Y', () => {
    const cloud = new CloudStore()
    // Both devices start from a shared baseline workout W already in the cloud (seeded at clock 1000).
    cloud.write(blobOf(baseState({ workouts: [wk('W')] })), 1000)
    const A = makeDevice('A', { workouts: [wk('W')] }, 1000)
    A.lastPushedJson = JSON.stringify(blobOf(A.state)) // A is in sync with the seed (no spurious push)
    const B = makeDevice('B', { workouts: [wk('W')] }, 1000)
    B.lastPushedJson = JSON.stringify(blobOf(B.state))

    // A logs sets and finishes workout X locally (unsynced). B independently finishes workout Y.
    localEdit(A, (s) => ({ ...s, workouts: [...s.workouts, wk('X', { completedAt: 2000 })] }), 2000)
    localEdit(B, (s) => ({ ...s, workouts: [...s.workouts, wk('Y', { completedAt: 1800 })] }), 1800)

    // A reconciles first: cloud (W @1000) is NOT newer than A's clock (2000) → A pushes [W,X].
    expect(reconcile(A, cloud, 3000)).toBe('push')
    expect(blobIdsOf(cloud.data as Json)).toEqual(['W', 'X'])

    // B reconciles: cloud now holds [W,X] @ A's clock (2000), strictly > B's clock (1800) → B adopts and
    // UNIONS its local Y with the cloud's X (no loss of either committed workout).
    expect(reconcile(B, cloud, 3100)).toBe('adopt')
    expect(workoutIds(B)).toEqual(['W', 'X', 'Y'])

    // The union reaches the cloud on B's next genuine local edit (the post-adopt unchanged-skip is the
    // documented LWW behavior — an adopt does not auto-re-push). B finishes one more workout Z.
    localEdit(B, (s) => ({ ...s, workouts: [...s.workouts, wk('Z', { completedAt: 4000 })] }), 4000)
    expect(reconcile(B, cloud, 4100)).toBe('push') // B clock (4000) > cloud (2000) → push the union up

    // A reconciles again: cloud now holds the full union (strictly past A's clock) → A adopts it.
    expect(reconcile(A, cloud, 5000)).toBe('adopt')

    // CONVERGED: neither X (A's) nor Y (B's) committed workout was ever lost on the interleaving.
    expect(workoutIds(A)).toEqual(['W', 'X', 'Y', 'Z'])
    expect(workoutIds(B)).toEqual(['W', 'X', 'Y', 'Z'])
  })
})

// ===========================================================================
// I2 — SELF-FORWARD: a post-adopt push clears the monotonic guard
// ===========================================================================
describe('I2 self-forward: the post-adopt push (clockAfterAdopt) is not silently reverted', () => {
  it('after adopting a higher cloud clock, the device can push its own merge forward', () => {
    const cloud = new CloudStore()
    // Cloud was written by another (clock-ahead) device at ts 5000.
    cloud.write(blobOf(baseState({ workouts: [wk('cloudW')] })), 5000)

    // Local device is behind (clock 100) with an unsynced local workout.
    const A = makeDevice('A', { workouts: [wk('localW')] }, 100)

    // Reconcile → adopt (cloud 5000 > local 100). clockAfterAdopt must be strictly > 5000, which is the
    // whole point: a push stamped at exactly cloudTs (what nextClock would give) is reverted by the
    // server's `<=` guard. The +1 lets this device sync its own (merged) data forward.
    expect(reconcile(A, cloud, 6000)).toBe('adopt')
    expect(A.clock).toBe(clockAfterAdopt(100, 5000))
    expect(A.clock).toBeGreaterThan(5000)
    // The union kept BOTH workouts on the device.
    expect(workoutIds(A)).toEqual(['cloudW', 'localW'])

    // A real follow-up local edit (the only thing that re-arms the post-adopt unchanged-skip) is stamped
    // via nextClock OFF the post-adopt clock, so it stays strictly past cloudTs. Its push MUST clear the
    // monotonic guard rather than being silently reverted.
    const before = cloud.accepted
    localEdit(A, (s) => ({ ...s, workouts: [...s.workouts, wk('newW', { completedAt: 7000 })] }), 6100)
    expect(A.clock).toBeGreaterThan(5000) // still strictly past cloudTs after the edit
    pushTo(A, cloud, 6200)
    expect(cloud.accepted).toBe(before + 1) // accepted, not reverted
    expect(cloud.rejected).toBe(0)
    // The cloud now carries the device's forward data (the union + the new edit), not the stale blob.
    expect(blobIdsOf(cloud.data as Json)).toEqual(['cloudW', 'localW', 'newW'])
  })

  it('the bug it guards: a push stamped AT cloudTs (nextClock, not clockAfterAdopt) WOULD be reverted', () => {
    const cloud = new CloudStore()
    cloud.write(blobOf(baseState({ workouts: [wk('cloudW')] })), 5000)
    // nextClock(local<cloud, cloud) === cloud → a push at exactly 5000 is rejected by the <= guard.
    const stampedWrong = nextClock(100, 5000) // === 5000
    expect(stampedWrong).toBe(5000)
    expect(cloud.write(blobOf(baseState({ workouts: [wk('x')] })), stampedWrong)).toBe(false)
    expect(cloud.rejected).toBe(1)
    // clockAfterAdopt(100, 5000) === 5001 → strictly greater → accepted.
    expect(cloud.write(blobOf(baseState({ workouts: [wk('x')] })), clockAfterAdopt(100, 5000))).toBe(true)
  })
})

// ===========================================================================
// I3 — REGRESSION GUARD for the reverted iteration-1 focus-repull bug
// ===========================================================================
describe('I3 focus repull with an unsynced local edit must UNION, not overwrite cloud workouts', () => {
  it('adopting a newer cloud (other device added Y) keeps the local unsynced edit AND Y', () => {
    // Setup: shared baseline W in the cloud. Device B then finishes Y and pushes it up (cloud = [W,Y]).
    const cloud = new CloudStore()
    cloud.write(blobOf(baseState({ workouts: [wk('W')] })), 1000)
    const cloudWithY = baseState({ workouts: [wk('W'), wk('Y', { completedAt: 4000 })] })
    cloud.write(blobOf(cloudWithY), 4000)

    // Device A has the baseline W and an UNSYNCED local edit (a finished workout X), clock behind cloud.
    const A = makeDevice('A', { workouts: [wk('W'), wk('X', { completedAt: 2000 })] }, 2000)

    // A focus-repull reconciles: cloud (4000) is newer than A (2000) → adopt.
    expect(reconcile(A, cloud, 5000)).toBe('adopt')

    // The CURRENT plain-adopt code unions: A must now hold W, X (its unsynced edit) AND Y (from cloud).
    // This is the load-bearing assertion: the OLD iteration-1 behavior pushed the UNMERGED local blob
    // ([W,X]) stamped past cloudTs, which overwrote the cloud's Y and permanently dropped it — A would
    // have ended at [W,X] with no Y. Plain-adopt-union instead keeps ALL THREE. This test FAILS against
    // that old path (Y absent) and PASSES against the current code.
    expect(workoutIds(A)).toEqual(['W', 'X', 'Y'])
    // The merged blob A would persist carries every id — no committed workout was dropped on the race.
    expect(blobIdsOf(blobOf(A.state))).toEqual(['W', 'X', 'Y'])

    // A subsequent LOCAL edit (which changes the blob, so it's not unchanged-skipped) then carries the
    // union — including the previously cloud-only Y — forward to the cloud, never clobbering it.
    localEdit(A, (s) => ({ ...s, workouts: [...s.workouts, wk('Z', { completedAt: 6000 })] }), 6000)
    reconcile(A, cloud, 6100) // local (clock past cloud) is newer → push the union up
    expect(blobIdsOf(cloud.data as Json)).toEqual(['W', 'X', 'Y', 'Z'])
  })
})

/** The sorted workout ids carried by a synced blob (partializeState shape). */
function blobIdsOf(blob: Json): string[] {
  const ws = (blob as unknown as { workouts?: Array<{ id: string }> }).workouts ?? []
  return [...ws.map((w) => w.id)].sort()
}

// ===========================================================================
// I4 — IN-PROGRESS current: more-progressed live session kept; finished one not resurrected
// ===========================================================================
describe('I4 in-progress current arbitration on adopt', () => {
  it('the more-progressed live session is kept when adopting a less-progressed cloud current', () => {
    const cloud = new CloudStore()
    // Cloud (other device) has a barely-started current with 1 logged set, written newer.
    cloud.write(blobOf(baseState({ current: activeSession('S', 1) })), 3000)
    // Local device is mid-logging the SAME session with 4 logged sets, clock behind.
    const A = makeDevice('A', { current: activeSession('S', 4) }, 1000)

    expect(reconcile(A, cloud, 4000)).toBe('adopt')
    // pickCurrent keeps whichever side logged MORE → the local 4-set session survives.
    expect(A.state.current?.id).toBe('S')
    expect(loggedSetCount(A.state.current)).toBe(4)
  })

  it('a session FINISHED on A (moved to workouts, current=null) is NOT resurrected as B’s live current', () => {
    const cloud = new CloudStore()
    // Device A finished session Z: current=null, Z moved into completed workouts[]. A pushes that up.
    cloud.write(blobOf(baseState({ current: null, workouts: [wk('Z')] })), 3000)
    // Device B still holds the in-progress Z as its live current (clock behind), plus the baseline.
    const B = makeDevice('B', { current: activeSession('Z', 2), workouts: [] }, 1000)

    expect(reconcile(B, cloud, 4000)).toBe('adopt')
    // The resurrection guard (current id already in merged workouts[]) drops the live copy.
    expect(B.state.current).toBeNull()
    // …and the completed Z is kept in history.
    expect(workoutIds(B)).toEqual(['Z'])
    expect(B.state.workouts[0].status).toBe('completed')
  })
})

// ===========================================================================
// I5 — CLOCK MONOTONICITY: strictly increasing, never backward
// ===========================================================================
describe('I5 per-device clock is strictly increasing across edits and adopts', () => {
  it('nextClock never moves backward on equal-ms or backward wall-clock inputs', () => {
    const cloud = new CloudStore()
    const A = makeDevice('A', {}, 0)
    const clocks: number[] = []

    // A series of local edits with adversarial timestamps: forward, equal, then BACKWARD wall-clock.
    localEdit(A, (s) => ({ ...s, workouts: [...s.workouts, wk('a')] }), 1000)
    clocks.push(A.clock)
    localEdit(A, (s) => ({ ...s, workouts: [...s.workouts, wk('b')] }), 1000) // same ms
    clocks.push(A.clock)
    localEdit(A, (s) => ({ ...s, workouts: [...s.workouts, wk('c')] }), 800) // wall clock went BACKWARD
    clocks.push(A.clock)

    // Now an adopt of a newer cloud must also only ever advance the clock.
    cloud.write(blobOf(baseState({ workouts: [wk('cloudW')] })), 9000)
    reconcile(A, cloud, 700) // even with a backward `now`, adopt stamps clockAfterAdopt
    clocks.push(A.clock)

    // strictly increasing throughout
    for (let i = 1; i < clocks.length; i++) {
      expect(clocks[i]).toBeGreaterThan(clocks[i - 1])
    }
    // explicit values: 1000 → 1001 (equal-ms +1) → 1002 (backward wall +1) → clockAfterAdopt(1002,9000)=9001
    expect(clocks).toEqual([1000, 1001, 1002, 9001])
  })
})

// ===========================================================================
// I6 — CONVERGENCE: both devices reconcile twice → equal workout sets, no resurrection
// ===========================================================================
describe('I6 convergence: two reconcile rounds yield equal persisted workout sets', () => {
  it('no oscillation; a deleted workout is not resurrected via deletedWorkoutIds', () => {
    const cloud = new CloudStore()
    // Shared baseline: cloud holds [P, Q].
    cloud.write(blobOf(baseState({ workouts: [wk('P'), wk('Q')] })), 1000)

    // Device A pulls the baseline, then DELETES Q (records a tombstone) and adds R.
    const A = makeDevice('A', {}, 0)
    reconcile(A, cloud, 1100) // adopt [P,Q]
    localEdit(
      A,
      (s) => ({
        ...s,
        workouts: [...s.workouts.filter((w) => w.id !== 'Q'), wk('R', { completedAt: 5000 })],
        deletedWorkoutIds: [...s.deletedWorkoutIds, 'Q'],
      }),
      2000,
    )

    // Device B pulls the baseline independently and adds S.
    const B = makeDevice('B', {}, 0)
    reconcile(B, cloud, 1200) // adopt [P,Q]
    localEdit(B, (s) => ({ ...s, workouts: [...s.workouts, wk('S', { completedAt: 4000 })] }), 1500)

    // Round 1: A pushes (its clock 2000 > cloud 1000), then B reconciles (adopts A's push and unions S).
    expect(reconcile(A, cloud, 3000)).toBe('push') // push [P,R] + tombstone Q
    expect(reconcile(B, cloud, 3100)).toBe('adopt') // adopt → unions to [P,R,S], Q stays tombstoned
    expect(workoutIds(B)).toEqual(['P', 'R', 'S'])
    // B carries the union forward on its next genuine local edit (a profile touch — changes the blob so
    // it isn't unchanged-skipped, without adding a workout). Its push lands strictly past cloud.
    localEdit(B, (s) => ({ ...s, profile: { ...s.profile, name: 'B' } }), 3200)
    expect(reconcile(B, cloud, 3300)).toBe('push')

    // Round 2: A reconciles (adopts B's union), then B reconciles again (cloud unchanged for it → push,
    // unchanged-skipped at the byte level — no oscillation).
    expect(reconcile(A, cloud, 4000)).toBe('adopt')
    reconcile(B, cloud, 4100)

    // Converged: both persist exactly [P, R, S] — Q stays deleted, nothing oscillates back.
    expect(workoutIds(A)).toEqual(['P', 'R', 'S'])
    expect(workoutIds(B)).toEqual(['P', 'R', 'S'])
    // The tombstone converged on both devices, so a future merge can't resurrect Q.
    expect(A.state.deletedWorkoutIds).toContain('Q')
    expect(B.state.deletedWorkoutIds).toContain('Q')

    // A THIRD round changes nothing (stable fixed point — no resurrection of Q via the stale cloud copy).
    reconcile(A, cloud, 5000)
    reconcile(B, cloud, 5100)
    expect(workoutIds(A)).toEqual(['P', 'R', 'S'])
    expect(workoutIds(B)).toEqual(['P', 'R', 'S'])
  })

  it('the merged state never reintroduces a tombstoned id even from a stale cloud blob', () => {
    // Direct mergePersisted check backing I6: a stale cloud still carrying Q must not bring it back.
    const merged = mergePersisted(
      blobOf(baseState({ workouts: [wk('P'), wk('Q')] })) as unknown as Partial<AppState>,
      baseState({ workouts: [wk('P')], deletedWorkoutIds: ['Q'] }),
    )
    expect(merged.workouts.map((w) => w.id).sort()).toEqual(['P'])
    expect(merged.deletedWorkoutIds).toContain('Q')
  })
})

// ===========================================================================
// I7 — SAME-CLOCK COLLISION: two devices reach an IDENTICAL clock and push concurrently
// ===========================================================================
describe('I7 same-clock collision: two devices at the same clock still converge (no committed loss)', () => {
  it('A and B both reach clock 2000; the push loser adopts on the equal-clock tie and unions', () => {
    const cloud = new CloudStore()
    // Shared baseline W in the cloud (clock 1000), both devices in sync with it (no spurious push).
    cloud.write(blobOf(baseState({ workouts: [wk('W')] })), 1000)
    const A = makeDevice('A', { workouts: [wk('W')] }, 1000)
    A.lastPushedJson = JSON.stringify(blobOf(A.state))
    const B = makeDevice('B', { workouts: [wk('W')] }, 1000)
    B.lastPushedJson = JSON.stringify(blobOf(B.state))

    // Both devices independently finish a workout and — same-millisecond completion / convergent
    // nextClock — land at the IDENTICAL clock 2000. This is the equality boundary every other interleaving
    // deliberately avoids; with a strict `>` adopt predicate it silently loses a committed workout.
    localEdit(A, (s) => ({ ...s, workouts: [...s.workouts, wk('X', { completedAt: 2000 })] }), 2000)
    localEdit(B, (s) => ({ ...s, workouts: [...s.workouts, wk('Y', { completedAt: 2000 })] }), 2000)
    expect(A.clock).toBe(2000)
    expect(B.clock).toBe(2000)

    // A reconciles first: cloud (W @1000) is older than A (2000) → A pushes [W,X], accepted at 2000.
    expect(reconcile(A, cloud, 3000)).toBe('push')
    expect(blobIdsOf(cloud.data as Json)).toEqual(['W', 'X'])
    expect(cloud.accepted).toBe(2) // seed + A

    // B reconciles at the SAME clock 2000: cloud now holds [W,X] @2000, EQUAL to B's clock and a DIFFERENT
    // blob ([W,X] vs B's [W,Y]). The equal-clock tie-break adopts (rather than pushing a write the server
    // guard would reject), unioning B's Y with the cloud's X — neither committed workout is lost.
    expect(reconcile(B, cloud, 3100)).toBe('adopt')
    expect(workoutIds(B)).toEqual(['W', 'X', 'Y'])
    expect(cloud.rejected).toBe(0) // B did NOT fire a doomed equal-clock push

    // The union reaches the cloud on B's next genuine edit (its post-adopt clock is strictly past the tie),
    // then A adopts it → full convergence. Pre-fix, B held [W,Y] forever and Y never reached the cloud.
    localEdit(B, (s) => ({ ...s, workouts: [...s.workouts, wk('Z', { completedAt: 4000 })] }), 4000)
    expect(reconcile(B, cloud, 4100)).toBe('push')
    expect(blobIdsOf(cloud.data as Json)).toEqual(['W', 'X', 'Y', 'Z'])
    expect(reconcile(A, cloud, 5000)).toBe('adopt')

    expect(workoutIds(A)).toEqual(['W', 'X', 'Y', 'Z'])
    expect(workoutIds(B)).toEqual(['W', 'X', 'Y', 'Z'])
  })

  it('an equal-clock repull of this device’s OWN echoed blob does NOT adopt (unchanged-skip path)', () => {
    // Guard against over-adopting: when cloud == local clock AND the blob is byte-identical (this device's
    // own last write echoed back on a focus repull), reconcile must take the push branch (which then
    // unchanged-skips), NOT a wasted adopt + clock bump.
    const cloud = new CloudStore()
    cloud.write(blobOf(baseState({ workouts: [wk('W')] })), 2000)
    const A = makeDevice('A', { workouts: [wk('W')] }, 2000)
    A.lastPushedJson = JSON.stringify(blobOf(A.state)) // already in sync with its own write
    const before = A.clock
    expect(reconcile(A, cloud, 3000)).toBe('push') // tie + identical blob → push (then unchanged-skip)
    expect(A.clock).toBe(before) // no clock bump, no adopt
    expect(cloud.accepted).toBe(1) // only the original write; the repull push was unchanged-skipped
  })
})

// ===========================================================================
// I8 — IMMEDIATE FLUSH decision: a freshly-logged set bypasses the 2s debounce, but never mid-pull
// ===========================================================================
describe('I8 shouldFlushImmediately: logged-set increase flushes now, except while a pull is in flight', () => {
  it('flushes immediately ONLY when the logged-set count increases and no pull is in flight', () => {
    // count increased, not pulling → flush now (the data-loss-minimizing fast path)
    expect(shouldFlushImmediately(0, 1, false)).toBe(true)
    expect(shouldFlushImmediately(3, 4, false)).toBe(true)
  })

  it('NEVER flushes immediately while a pull/adopt is in flight (the load-bearing guard)', () => {
    // Mirrors the real race: the store subscription fires inside pullAndReconcile's setState(merged) — a
    // newly-adopted blob can RAISE the live current's logged-set count, but pushing it here would upload
    // at the pre-adopt clock and be reverted by the server <= guard. Must defer to the debounce.
    expect(shouldFlushImmediately(0, 1, true)).toBe(false)
    expect(shouldFlushImmediately(2, 5, true)).toBe(false)
  })

  it('does not flush immediately on a no-change or a DECREASE in the count (debounce instead)', () => {
    expect(shouldFlushImmediately(2, 2, false)).toBe(false) // unchanged (e.g. a profile/plan edit)
    expect(shouldFlushImmediately(4, 1, false)).toBe(false) // session finished / reset → count dropped
    expect(shouldFlushImmediately(1, 0, false)).toBe(false)
  })
})
