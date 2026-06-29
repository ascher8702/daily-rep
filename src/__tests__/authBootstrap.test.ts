import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runAuthBootstrap, type AuthClientLike, type AuthBootstrapPatch } from '../store/authBootstrap'

type Session = { user?: { id: string; email?: string | null } | null } | null

function mockClient() {
  let authCb: (event: string, session: Session) => void = () => {}
  let resolveSession!: (v: { data: { session: Session } }) => void
  let rejectSession!: (e: unknown) => void
  const getSession = vi.fn(
    () => new Promise<{ data: { session: Session } }>((res, rej) => { resolveSession = res; rejectSession = rej }),
  )
  const onAuthStateChange = vi.fn((cb: (event: string, session: Session) => void) => {
    authCb = cb
    return { data: { subscription: { unsubscribe() {} } } }
  })
  const client = { auth: { getSession, onAuthStateChange } } as unknown as AuthClientLike
  return {
    client,
    fireAuth: (event: string, session: Session) => authCb(event, session),
    resolveSession: (session: Session) => resolveSession({ data: { session } }),
    rejectSession: (e: unknown) => rejectSession(e),
  }
}

function collector() {
  const state: AuthBootstrapPatch = {}
  const set = vi.fn((patch: AuthBootstrapPatch) => Object.assign(state, patch))
  return { state, set }
}

describe('runAuthBootstrap', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('wires email + startSync from getSession when no auth event fires', async () => {
    const m = mockClient()
    const { state, set } = collector()
    const startSync = vi.fn()
    const stopSync = vi.fn()
    runAuthBootstrap(m.client, set, { startSync, stopSync })

    m.resolveSession({ user: { id: 'u1', email: 'a@x.com' } })
    await vi.advanceTimersByTimeAsync(0)

    expect(state).toMatchObject({ email: 'a@x.com', initialized: true })
    expect(startSync).toHaveBeenCalledWith('u1')
  })

  it('does NOT let a late getSession clobber a session established by an auth event (no cross-account sync)', async () => {
    const m = mockClient()
    const { state, set } = collector()
    const startSync = vi.fn()
    const stopSync = vi.fn()
    runAuthBootstrap(m.client, set, { startSync, stopSync })

    // getSession hangs past the timeout → app proceeds as signed-out.
    vi.advanceTimersByTime(8000)
    expect(state.initialized).toBe(true)

    // User signs in as account B via an auth event (authoritative).
    m.fireAuth('SIGNED_IN', { user: { id: 'B', email: 'b@x.com' } })
    expect(startSync).toHaveBeenCalledWith('B')
    expect(state.email).toBe('b@x.com')

    // The original hung getSession finally resolves with the STALE account A.
    m.resolveSession({ user: { id: 'A', email: 'a@x.com' } })
    await vi.advanceTimersByTimeAsync(0)

    // It must not repoint email or sync back to A.
    expect(state.email).toBe('b@x.com')
    expect(startSync).not.toHaveBeenCalledWith('A')
    expect(startSync).toHaveBeenCalledTimes(1)
  })

  it('flips initialized on timeout when getSession hangs and never resolves', () => {
    const m = mockClient()
    const { state, set } = collector()
    runAuthBootstrap(m.client, set, { startSync: vi.fn(), stopSync: vi.fn() })

    expect(state.initialized).toBeUndefined()
    vi.advanceTimersByTime(8000)
    expect(state.initialized).toBe(true)
  })

  it('on SIGNED_OUT stops sync and clears recovery', () => {
    const m = mockClient()
    const { state, set } = collector()
    const stopSync = vi.fn()
    runAuthBootstrap(m.client, set, { startSync: vi.fn(), stopSync })

    m.fireAuth('SIGNED_OUT', null)
    expect(stopSync).toHaveBeenCalled()
    expect(state).toMatchObject({ email: null, recovering: false, initialized: true })
  })

  it('PASSWORD_RECOVERY sets the recovering flag', () => {
    const m = mockClient()
    const { state, set } = collector()
    runAuthBootstrap(m.client, set, { startSync: vi.fn(), stopSync: vi.fn() })

    m.fireAuth('PASSWORD_RECOVERY', { user: { id: 'u1', email: 'a@x.com' } })
    expect(state.recovering).toBe(true)
  })

  it('a getSession rejection still un-gates the app (initialized) when not authoritative', async () => {
    const m = mockClient()
    const { state, set } = collector()
    runAuthBootstrap(m.client, set, { startSync: vi.fn(), stopSync: vi.fn() })

    m.rejectSession(new Error('network'))
    await vi.advanceTimersByTimeAsync(0)
    expect(state.initialized).toBe(true)
  })

  describe('account-switch scrub (B2)', () => {
    it('AWAITS the scrub of prior local state BEFORE starting sync for a different account', async () => {
      const m = mockClient()
      const { set } = collector()
      const startSync = vi.fn()
      // The scrub is async (it clears IDB/localStorage then resets the sync clock); adopt must AWAIT it
      // before startSync, or the late clock reset lands after startSync(B) and drops B's first edit.
      const clearLocalAppData = vi.fn(() => Promise.resolve())
      runAuthBootstrap(m.client, set, { startSync, stopSync: vi.fn(), clearLocalAppData })

      // First account in: no prior account, nothing to scrub.
      m.fireAuth('SIGNED_IN', { user: { id: 'A', email: 'a@x.com' } })
      expect(clearLocalAppData).not.toHaveBeenCalled()
      expect(startSync).toHaveBeenCalledWith('A')

      // A DIFFERENT account lands without an explicit in-app sign-out (e.g. magic-link/OAuth as B over
      // A's local blob): scrub must run, and startSync(B) must NOT fire until it has resolved.
      m.fireAuth('SIGNED_IN', { user: { id: 'B', email: 'b@x.com' } })
      expect(clearLocalAppData).toHaveBeenCalledTimes(1)
      expect(startSync).not.toHaveBeenCalledWith('B') // still awaiting the scrub — not yet

      // Let the awaited scrub promise settle; only then does startSync(B) run.
      await vi.advanceTimersByTimeAsync(0)
      expect(startSync).toHaveBeenCalledWith('B')
      const clearOrder = clearLocalAppData.mock.invocationCallOrder[0]
      const startBOrder = startSync.mock.calls.findIndex((c) => c[0] === 'B')
      expect(clearOrder).toBeLessThan(startSync.mock.invocationCallOrder[startBOrder])
    })

    it('does NOT scrub when the same account re-fires (e.g. token refresh)', () => {
      const m = mockClient()
      const { set } = collector()
      const startSync = vi.fn()
      const clearLocalAppData = vi.fn(() => Promise.resolve())
      runAuthBootstrap(m.client, set, { startSync, stopSync: vi.fn(), clearLocalAppData })

      m.fireAuth('SIGNED_IN', { user: { id: 'A', email: 'a@x.com' } })
      m.fireAuth('TOKEN_REFRESHED', { user: { id: 'A', email: 'a@x.com' } })
      expect(clearLocalAppData).not.toHaveBeenCalled()
    })

    it('an explicit sign-out resets the tracked uid so re-signing the SAME account does not scrub', () => {
      const m = mockClient()
      const { set } = collector()
      const startSync = vi.fn()
      const clearLocalAppData = vi.fn(() => Promise.resolve())
      runAuthBootstrap(m.client, set, { startSync, stopSync: vi.fn(), clearLocalAppData })

      m.fireAuth('SIGNED_IN', { user: { id: 'A', email: 'a@x.com' } })
      m.fireAuth('SIGNED_OUT', null)
      m.fireAuth('SIGNED_IN', { user: { id: 'A', email: 'a@x.com' } })
      expect(clearLocalAppData).not.toHaveBeenCalled()
    })

    it('a late getSession with a STALE uid neither scrubs nor adopts (race preserved)', async () => {
      const m = mockClient()
      const { state, set } = collector()
      const startSync = vi.fn()
      const clearLocalAppData = vi.fn(() => Promise.resolve())
      runAuthBootstrap(m.client, set, { startSync, stopSync: vi.fn(), clearLocalAppData })

      // getSession hangs past timeout, then the user signs in as B (authoritative).
      vi.advanceTimersByTime(8000)
      m.fireAuth('SIGNED_IN', { user: { id: 'B', email: 'b@x.com' } })
      expect(startSync).toHaveBeenCalledWith('B')

      // The original hung getSession resolves with the stale account A.
      m.resolveSession({ user: { id: 'A', email: 'a@x.com' } })
      await vi.advanceTimersByTimeAsync(0)

      // No scrub of B's data, no startSync(A): the authoritative guard short-circuits before adopt().
      expect(clearLocalAppData).not.toHaveBeenCalled()
      expect(startSync).not.toHaveBeenCalledWith('A')
      expect(state.email).toBe('b@x.com')
    })
  })
})
