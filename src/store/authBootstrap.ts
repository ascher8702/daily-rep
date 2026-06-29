import { reportError } from '../lib/telemetry'
import { settleWithin } from '../lib/async'

/**
 * One-time auth/session bootstrap, extracted from useAuth so the race semantics are unit-testable.
 *
 * The guarantees:
 * - An `onAuthStateChange` event is the AUTHORITATIVE source of the current session. We register it
 *   first and, once any event has fired, a slow/late `getSession()` result must NOT overwrite it.
 *   Without that guard, signing in (or out) while the initial `getSession()` is hung past the timeout
 *   would later be clobbered back to the stale session — and `startSync(staleUid)` would pull the WRONG
 *   user's cloud row into the freshly-signed-in account (cross-account data mix).
 * - The app never stays stuck on the loading gate: `settleWithin` flips `initialized` after `timeoutMs`
 *   even if `getSession()` (and the INITIAL_SESSION event) hang. A late success still wires email + sync
 *   — but only if no auth event has since taken over.
 */

type SessionUser = { id: string; email?: string | null } | null | undefined

interface SessionLike {
  user?: SessionUser
}

export interface AuthClientLike {
  auth: {
    getSession: () => Promise<{ data: { session: SessionLike | null } }>
    onAuthStateChange: (cb: (event: string, session: SessionLike | null) => void) => unknown
  }
}

/** The subset of AuthState this bootstrap writes. */
export interface AuthBootstrapPatch {
  email?: string | null
  initialized?: boolean
  pending?: string | null
  recovering?: boolean
}

export interface AuthBootstrapDeps {
  startSync: (uid: string) => unknown
  stopSync: () => unknown
  /** Scrub all device-local app state before adopting a DIFFERENT account (account switch without an
   *  explicit in-app sign-out, e.g. a magic-link/OAuth landing as user B over user A's data). Optional
   *  so existing tests that don't exercise the switch path stay valid. */
  clearLocalAppData?: () => unknown
  /** ms before we stop waiting on getSession and proceed as signed-out (default 8000). */
  timeoutMs?: number
}

export function runAuthBootstrap(
  client: AuthClientLike,
  set: (patch: AuthBootstrapPatch) => void,
  deps: AuthBootstrapDeps,
): void {
  const { startSync, stopSync, clearLocalAppData, timeoutMs = 8000 } = deps

  // Flips true on the first auth-state-change event; from then on, getSession results are stale.
  let authoritative = false
  // The uid we last started sync for. When an incoming session adopts a DIFFERENT uid without an
  // explicit in-app sign-out (which scrubs + nulls this), the prior account's local blob is still on
  // device — scrub it BEFORE startSync so the new account can't pull the cloud row in over stale data.
  let lastSyncedUid: string | null = null

  async function adopt(uid: string): Promise<void> {
    // AWAIT the scrub before startSync: clearLocalAppData resets the sync clock (clientUpdatedAt=0,
    // lastPushedJson='') only AFTER its awaited IDB/localStorage clears. If startSync(B) raced ahead and
    // stamped the clock first, that late reset would land after it and B's first post-switch edit would
    // push at client_updated_at=0 — silently reverted (dropped) by the server's monotonic guard.
    if (lastSyncedUid && lastSyncedUid !== uid) await clearLocalAppData?.()
    lastSyncedUid = uid
    void startSync(uid)
  }

  client.auth.onAuthStateChange((event, session) => {
    authoritative = true
    const u = session?.user
    set({ email: u?.email ?? null, initialized: true })
    // A reset-password link signs the user into a temporary recovery session and fires this event;
    // flag it so the gate shows the "set a new password" screen until the password is updated.
    if (event === 'PASSWORD_RECOVERY') set({ recovering: true })
    if (u) {
      set({ pending: null })
      void adopt(u.id)
    } else {
      set({ recovering: false })
      lastSyncedUid = null
      void stopSync()
    }
  })

  settleWithin(client.auth.getSession(), timeoutMs, {
    onValue: ({ data }) => {
      // An auth event already established the real session — don't let a late result clobber it.
      if (authoritative) {
        set({ initialized: true })
        return
      }
      const u = data.session?.user
      set({ email: u?.email ?? null, initialized: true })
      if (u) void adopt(u.id)
    },
    onError: (e) => {
      reportError(e, { scope: 'auth.getSession' })
      if (!authoritative) set({ initialized: true })
    },
    onTimeout: () => {
      reportError(new Error('auth getSession timed out'), { scope: 'auth.getSession.timeout' })
      set({ initialized: true })
    },
  })
}
