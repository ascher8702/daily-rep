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
})
