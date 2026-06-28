import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  setSyncReadOnly,
  isSyncReadOnly,
  runPush,
  clearSyncMetadata,
} from '../lib/sync'
import * as telemetry from '../lib/telemetry'
import type { Json } from '../lib/database.types'
import { STATE_TABLE } from '../lib/supabase'

/**
 * Item C (read-only sync mode) and Item D (pushNow telemetry). Uses the spec's injectable push seam
 * `runPush(client, uid, blob, clockMs, opts)` with a FAKE supabase client (repo convention: never
 * vi.mock the supabase module — inject a fake `from()`), so no network/jsdom is needed.
 *
 * The read-only flag is process-global module state; every test that flips it ON restores it in
 * afterEach (§7.34) so a later write-path assertion isn't silently suppressed.
 */

// A fake supabase client recording every upsert. `result` controls the simulated server response.
function fakeClient(result: { error: { code?: string; message?: string } | null } = { error: null }) {
  const upsertCalls: Array<{ row: unknown; opts: unknown }> = []
  const fromCalls: string[] = []
  const client = {
    from(table: string) {
      fromCalls.push(table)
      return {
        upsert(row: unknown, opts: unknown) {
          upsertCalls.push({ row, opts })
          return Promise.resolve(result)
        },
      }
    },
  }
  return { client, upsertCalls, fromCalls }
}

// A blob carrying `workouts` so telemetry's workoutCount has something to count.
function blobWith(n: number, extra: Record<string, unknown> = {}): Json {
  return { workouts: Array.from({ length: n }, (_, i) => ({ id: `w${i}` })), ...extra } as unknown as Json
}

let eventSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // reset the module-global push-dedup state (lastPushedJson) so a prior test's identical-content blob
  // can't make this test's first runPush hit the unchanged-skip path (§7.34)
  clearSyncMetadata()
  eventSpy = vi.spyOn(telemetry, 'reportEvent').mockImplementation(() => {})
})

afterEach(() => {
  setSyncReadOnly(false) // restore the process-global flag so it can't leak (§7.34)
  clearSyncMetadata() // and the push-dedup state, for the same reason
  eventSpy.mockRestore()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// C. setSyncReadOnly / isSyncReadOnly — default + toggle
// ---------------------------------------------------------------------------
describe('C. setSyncReadOnly / isSyncReadOnly', () => {
  it('§7.22 defaults to read-WRITE (false) and toggles idempotently', () => {
    expect(isSyncReadOnly()).toBe(false)
    setSyncReadOnly(true)
    expect(isSyncReadOnly()).toBe(true)
    setSyncReadOnly(false)
    expect(isSyncReadOnly()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// C. read-only ON suppresses the upsert; OFF is byte-identical (still writes once)
// ---------------------------------------------------------------------------
describe('C. read-only mode gates the upsert at the single pushNow chokepoint', () => {
  it('§7.23 read-only ON → runPush does NOT call client.from(...) and resolves without error', async () => {
    const { client, upsertCalls, fromCalls } = fakeClient()
    setSyncReadOnly(true)
    const res = await runPush(client, 'user-1', blobWith(2), 1000, { readOnly: true })
    expect(fromCalls).toHaveLength(0)
    expect(upsertCalls).toHaveLength(0)
    expect(res.ok).not.toBe(false) // no error surfaced for a suppressed write
  })

  it('§7.24 read-only ON via the focus/visibility else-branch hits the SAME chokepoint → no upsert', async () => {
    // pullAndReconcile's else-branch calls the same pushNow→runPush, so the chokepoint-level assertion
    // (no upsert when readOnly) covers it. (Documented in test guidance: the else-branch is not directly
    // callable under node without a fake pull, so we assert the shared chokepoint.)
    const { client, upsertCalls } = fakeClient()
    setSyncReadOnly(true)
    await runPush(client, 'user-1', blobWith(1), 2000, { readOnly: true })
    expect(upsertCalls).toHaveLength(0)
  })

  it('§7.25 read-only OFF (default) → runPush DOES upsert exactly once on changed data', async () => {
    const { client, upsertCalls, fromCalls } = fakeClient()
    const res = await runPush(client, 'user-1', blobWith(2), 1000, { readOnly: false })
    expect(fromCalls).toEqual([STATE_TABLE])
    expect(upsertCalls).toHaveLength(1)
    expect((upsertCalls[0].row as { user_id: string }).user_id).toBe('user-1')
    expect(res.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// D. telemetry — a successful, non-skipped push emits sync.push with bytes/workouts/ms
// ---------------------------------------------------------------------------
describe('D. pushNow telemetry (sync.push)', () => {
  it('§7.26 a successful push emits sync.push with byte size, workouts.length, and a latency number', async () => {
    const { client } = fakeClient({ error: null })
    const blob = blobWith(2)
    const expectedBytes = new TextEncoder().encode(JSON.stringify(blob)).length

    await runPush(client, 'user-1', blob, 1000, { readOnly: false })

    expect(eventSpy).toHaveBeenCalledTimes(1)
    const [name, props] = eventSpy.mock.calls[0] as [string, Record<string, unknown>]
    expect(name).toBe('sync.push')
    expect(props.bytes).toBe(expectedBytes)
    expect(props.workouts).toBe(2)
    expect(typeof props.ms).toBe('number')
    expect(props.ms as number).toBeGreaterThanOrEqual(0)
  })

  it('§7.27 a SKIPPED (unchanged-blob) push does NOT re-emit sync.push — exactly one across two calls', async () => {
    const { client } = fakeClient({ error: null })
    const blob = blobWith(2)
    await runPush(client, 'user-1', blob, 1000, { readOnly: false }) // fires once
    await runPush(client, 'user-1', blob, 1000, { readOnly: false }) // unchanged → skip, no 2nd event
    const pushEvents = eventSpy.mock.calls.filter((c) => c[0] === 'sync.push')
    expect(pushEvents).toHaveLength(1)
  })

  it('§7.28 read-only suppressed push emits NO sync.push event', async () => {
    const { client } = fakeClient({ error: null })
    setSyncReadOnly(true)
    await runPush(client, 'user-1', blobWith(2), 1000, { readOnly: true })
    const pushEvents = eventSpy.mock.calls.filter((c) => c[0] === 'sync.push')
    expect(pushEvents).toHaveLength(0)
  })

  it('§7.28 a 42501 denied push emits sync.push.denied, NOT sync.push', async () => {
    const { client } = fakeClient({ error: { code: '42501', message: 'denied' } })
    await runPush(client, 'user-1', blobWith(2), 1000, { readOnly: false })
    const names = eventSpy.mock.calls.map((c) => c[0])
    expect(names).toContain('sync.push.denied')
    expect(names).not.toContain('sync.push')
  })

  it('§7.29 bytes counts UTF-8 BYTES not chars: a multi-byte note → bytes > String.length', async () => {
    const { client } = fakeClient({ error: null })
    const blob = blobWith(1, { note: 'café 🏋️' }) // multi-byte: bytes must exceed JSON string .length
    const json = JSON.stringify(blob)
    await runPush(client, 'user-1', blob, 1000, { readOnly: false })
    const [, props] = eventSpy.mock.calls[0] as [string, Record<string, unknown>]
    expect(props.bytes as number).toBeGreaterThan(json.length)
    expect(props.bytes).toBe(new TextEncoder().encode(json).length)
  })

  it('§7.30 workouts count is 0 when the blob has no workouts array (no throw)', async () => {
    const { client } = fakeClient({ error: null })
    await runPush(client, 'user-1', { profile: {} } as unknown as Json, 1000, { readOnly: false })
    const [, props] = eventSpy.mock.calls[0] as [string, Record<string, unknown>]
    expect(props.workouts).toBe(0)
  })
})
