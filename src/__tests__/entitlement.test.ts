import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * B1: the entitlement gate must NEVER stay stuck on `loading: true`. fetchSubscription rejects on a
 * stalled connection (its own timeout), and refresh()'s catch must flip loading false — serving the
 * per-user cached verdict when present, else failing closed. These drive that contract via a mocked
 * fetchSubscription (the real timeout lives in billing.test.ts).
 */

// A truthy supabase so refresh() doesn't take the "no cloud → entitled" early-return.
vi.mock('../lib/supabase', () => ({ supabase: {} }))

// hoisted so the mock factory (also hoisted) can close over it without a TDZ error.
const { fetchSubscription } = vi.hoisted(() => ({ fetchSubscription: vi.fn() }))
vi.mock('../lib/billing', async () => {
  const actual = await vi.importActual<typeof import('../lib/billing')>('../lib/billing')
  return { ...actual, fetchSubscription }
})

import { useEntitlement } from '../store/useEntitlement'
import { useAuth } from '../store/useAuth'

beforeEach(() => {
  fetchSubscription.mockReset()
  useEntitlement.setState({ loading: true, entitled: false, inTrial: false })
  // refresh()'s cache is keyed by the signed-in email; give it one and a clean slate.
  useAuth.setState({ email: 'cache-user@x.com' })
  try {
    localStorage.clear()
  } catch {
    /* no localStorage in node — loadCache simply returns null (fail-closed path) */
  }
})

afterEach(() => {
  useAuth.setState({ email: null })
})

describe('useEntitlement.refresh (B1 — loading always resolves)', () => {
  it('fails closed (loading:false, not entitled) when the fetch rejects and there is no cache', async () => {
    fetchSubscription.mockRejectedValue(new Error('subscription fetch timed out'))

    await useEntitlement.getState().refresh()

    const s = useEntitlement.getState()
    expect(s.loading).toBe(false) // INVARIANT: never stuck on the skeleton
    expect(s.entitled).toBe(false) // no cache → fail closed, not fail open
  })

  it('serves the last-known-good cached verdict (loading:false) when the fetch rejects', async () => {
    // First, a successful resolve seeds the per-user cache with an entitled (active) subscription.
    fetchSubscription.mockResolvedValueOnce({
      user_id: 'u1',
      stripe_customer_id: null,
      stripe_subscription_id: 'sub_1',
      status: 'active',
      price_id: null,
      plan: 'monthly',
      trial_ends_at: null,
      current_period_end: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      cancel_at_period_end: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    await useEntitlement.getState().refresh()
    expect(useEntitlement.getState().entitled).toBe(true)

    // Now the connection stalls and the fetch rejects: stay entitled from cache, still un-gated.
    fetchSubscription.mockRejectedValue(new Error('subscription fetch timed out'))
    await useEntitlement.getState().refresh()

    const s = useEntitlement.getState()
    expect(s.loading).toBe(false)
    // cache restore only works where localStorage exists; either way loading MUST be false.
    if (typeof localStorage !== 'undefined') expect(s.entitled).toBe(true)
  })
})
