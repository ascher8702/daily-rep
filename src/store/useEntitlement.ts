import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { reportError } from '../lib/telemetry'
import { useAuth } from './useAuth'
import { deriveEntitlement, fetchSubscription, type Entitlement, type SubscriptionRow } from '../lib/billing'

/**
 * Entitlement store — the signed-in user's subscription/trial state, read from the per-user
 * `subscriptions` row. AppShell starts it on sign-in (and stops it on sign-out); it refetches when the
 * tab regains focus so a status change made elsewhere (the Stripe portal, another device, the webhook
 * landing after Checkout) is reflected without a reload.
 *
 * This client gate drives UX. Real enforcement is server-side: RLS gates WRITES to daily_rep_state
 * behind public.is_active_subscriber() (migration 20260626140000), which mirrors deriveEntitlement —
 * so a lapsed account can read/export its data but can't sync new data up regardless of client tricks.
 * We still deliberately AVOID a blanket fail-open on read errors here: that would let anyone lapsed block a
 * single request and get in. Instead we cache the last-known-good entitlement per user and fall back to
 * THAT on error — a returning lapsed user stays gated, while a paying user keeps offline access. Only a
 * user we have never successfully resolved (e.g. a brand-new account on a flaky first load) gets a
 * provisional pass, so we never lock out a legitimate new user.
 */

interface EntitlementStore extends Entitlement {
  /** fetch the row once and recompute */
  refresh: () => Promise<void>
  /** begin: initial fetch + focus/visibility refetch */
  start: () => void
  /** stop and reset to the loading state (sign-out) */
  stop: () => void
}

const INITIAL: Entitlement = {
  loading: true,
  entitled: false,
  inTrial: false,
  trialDaysLeft: 0,
  hasSubscription: false,
  everSubscribed: false,
  status: null,
  plan: null,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  trialEndsAt: null,
}

let listenersAttached = false
let detach: (() => void) | null = null

/** Per-user cache key so one user can never inherit another's cached entitlement. */
function cacheKey(): string | null {
  const email = useAuth.getState().email
  return email ? `daily-rep-ent:${email.toLowerCase()}` : null
}

// Cache the RAW subscription row (not the derived verdict): time-relative fields like trial expiry are
// re-evaluated against the CURRENT clock on restore, so a cache written mid-trial isn't re-served as
// still-active after the trial has elapsed.
function saveCache(row: SubscriptionRow | null) {
  const key = cacheKey()
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify({ row }))
  } catch {
    /* storage unavailable — in-memory state still applies this session */
  }
}

function loadCache(): Entitlement | null {
  const key = cacheKey()
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const c = JSON.parse(raw)
    if (!c || !('row' in c)) return null // absent / legacy verdict-shaped cache → treat as no cache
    return { loading: false, ...deriveEntitlement((c.row ?? null) as SubscriptionRow | null, Date.now()) }
  } catch {
    return null
  }
}

export const useEntitlement = create<EntitlementStore>((set) => ({
  ...INITIAL,

  refresh: async () => {
    // No cloud (local dev / unconfigured) → nothing to gate; treat as entitled.
    if (!supabase) {
      set({ ...INITIAL, loading: false, entitled: true })
      return
    }
    try {
      const row = await fetchSubscription()
      if (!row) {
        // The signup trigger seeds a row in the same transaction, so a signed-in user should always
        // have one. A missing row is unexpected — surface it (deriveEntitlement still fails open so a
        // brand-new user mid-provisioning isn't locked out, but now it's observable, not silent).
        reportError(new Error('entitlement: no subscription row for signed-in user'), {
          scope: 'entitlement.nullRow',
        })
      }
      const derived: Entitlement = { loading: false, ...deriveEntitlement(row) }
      set(derived)
      saveCache(row)
    } catch (e) {
      reportError(e, { scope: 'entitlement.refresh' })
      // Do NOT blanket fail-open — that makes the paywall bypassable by blocking one request. Prefer
      // this user's last-known-good snapshot; only grant a provisional pass if we have never resolved
      // them (so a genuine first-load blip on a new account doesn't lock them out).
      const cached = loadCache()
      set(cached ?? { ...INITIAL, loading: false, entitled: true })
    }
  },

  start: () => {
    // Always refetch on start (even if listeners are already wired) so a same-tab account switch can't
    // leave the previous user's entitlement cached. Only the listener wiring is guarded.
    void useEntitlement.getState().refresh()
    if (listenersAttached) return
    listenersAttached = true
    if (typeof document !== 'undefined') {
      const onVisible = () => {
        if (document.visibilityState === 'visible') void useEntitlement.getState().refresh()
      }
      document.addEventListener('visibilitychange', onVisible)
      window.addEventListener('focus', onVisible)
      detach = () => {
        document.removeEventListener('visibilitychange', onVisible)
        window.removeEventListener('focus', onVisible)
      }
    }
  },

  stop: () => {
    listenersAttached = false
    detach?.()
    detach = null
    set({ ...INITIAL })
  },
}))
