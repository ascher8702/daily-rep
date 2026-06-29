import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  deriveEntitlement,
  fetchSubscription,
  SUBSCRIPTION_FETCH_TIMEOUT_MS,
  type SubscriptionRow,
} from '../lib/billing'

// A controllable mock client so fetchSubscription's real timeout (B1) can be exercised: the query
// promise is held open by the test, simulating a stalled (not failed) connection.
const maybeSingle = vi.fn<() => Promise<{ data: SubscriptionRow | null; error: unknown }>>()
vi.mock('../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ maybeSingle }) }) },
}))

const NOW = Date.parse('2026-06-24T12:00:00Z')
const inDays = (n: number) => new Date(NOW + n * 86_400_000).toISOString()

/** Build a subscription row with sane defaults, overriding only what a case cares about. */
function row(over: Partial<SubscriptionRow>): SubscriptionRow {
  return {
    user_id: 'u1',
    stripe_customer_id: null,
    stripe_subscription_id: null,
    status: 'trialing',
    price_id: null,
    plan: null,
    trial_ends_at: null,
    current_period_end: null,
    cancel_at_period_end: false,
    created_at: inDays(-1),
    updated_at: inDays(-1),
    ...over,
  }
}

describe('deriveEntitlement', () => {
  it('fails closed when there is no row yet (access cannot be proven)', () => {
    const e = deriveEntitlement(null, NOW)
    expect(e.entitled).toBe(false)
    expect(e.inTrial).toBe(false)
    expect(e.hasSubscription).toBe(false)
  })

  it('grants access during the card-free trial and reports whole days left', () => {
    const e = deriveEntitlement(row({ status: 'trialing', trial_ends_at: inDays(10) }), NOW)
    expect(e.entitled).toBe(true)
    expect(e.inTrial).toBe(true)
    expect(e.hasSubscription).toBe(false)
    expect(e.trialDaysLeft).toBe(10)
  })

  it('rounds partial trial days up (a few hours left still counts as a day)', () => {
    const e = deriveEntitlement(row({ trial_ends_at: new Date(NOW + 3 * 3_600_000).toISOString() }), NOW)
    expect(e.trialDaysLeft).toBe(1)
    expect(e.inTrial).toBe(true)
  })

  it('locks out an expired trial with no subscription', () => {
    const e = deriveEntitlement(row({ status: 'trialing', trial_ends_at: inDays(-1) }), NOW)
    expect(e.entitled).toBe(false)
    expect(e.inTrial).toBe(false)
    expect(e.trialDaysLeft).toBe(0)
  })

  it('grants access for an active paid subscription', () => {
    const e = deriveEntitlement(
      row({
        status: 'active',
        stripe_subscription_id: 'sub_1',
        plan: 'annual',
        trial_ends_at: inDays(-5),
        current_period_end: inDays(360),
      }),
      NOW,
    )
    expect(e.entitled).toBe(true)
    expect(e.hasSubscription).toBe(true)
    expect(e.inTrial).toBe(false)
    expect(e.plan).toBe('annual')
  })

  it('keeps access while past_due (dunning grace)', () => {
    const e = deriveEntitlement(row({ status: 'past_due', stripe_subscription_id: 'sub_1' }), NOW)
    expect(e.entitled).toBe(true)
    expect(e.hasSubscription).toBe(true)
  })

  it('keeps access for a sub set to cancel at period end, until the period actually ends', () => {
    const e = deriveEntitlement(
      row({
        status: 'active',
        stripe_subscription_id: 'sub_1',
        cancel_at_period_end: true,
        current_period_end: inDays(12),
      }),
      NOW,
    )
    expect(e.entitled).toBe(true)
    expect(e.cancelAtPeriodEnd).toBe(true)
  })

  it('revokes access once the subscription is canceled', () => {
    const e = deriveEntitlement(
      row({ status: 'canceled', stripe_subscription_id: 'sub_1', trial_ends_at: inDays(-30) }),
      NOW,
    )
    expect(e.entitled).toBe(false)
    expect(e.hasSubscription).toBe(false)
  })

  it('treats a subscribed-during-trial sub as a subscription, not the nudge-banner trial', () => {
    // Subscribed early: Stripe status trialing AND we carried trial_ends_at forward.
    const e = deriveEntitlement(
      row({ status: 'trialing', stripe_subscription_id: 'sub_1', plan: 'monthly', trial_ends_at: inDays(20) }),
      NOW,
    )
    expect(e.entitled).toBe(true)
    expect(e.hasSubscription).toBe(true)
    expect(e.inTrial).toBe(false) // banner suppressed — they've already given a card
  })

  // immediate-cancel: paid through the period but canceled "now" → keep access until current_period_end
  it('keeps access after an IMMEDIATE cancel until the already-paid period end', () => {
    const e = deriveEntitlement(
      row({ status: 'canceled', stripe_subscription_id: 'sub_1', trial_ends_at: inDays(-30), current_period_end: inDays(12) }),
      NOW,
    )
    expect(e.entitled).toBe(true) // they paid through inDays(12)
    expect(e.hasSubscription).toBe(false) // but it's not a live/renewing subscription
  })

  it('revokes access once the paid period end has passed on a canceled sub', () => {
    const e = deriveEntitlement(
      row({ status: 'canceled', stripe_subscription_id: 'sub_1', trial_ends_at: inDays(-30), current_period_end: inDays(-2) }),
      NOW,
    )
    expect(e.entitled).toBe(false)
  })

  it('does NOT grant paid-period access for a never-paid status with a future period end', () => {
    const e = deriveEntitlement(
      row({ status: 'incomplete', stripe_subscription_id: 'sub_1', trial_ends_at: inDays(-30), current_period_end: inDays(12) }),
      NOW,
    )
    expect(e.entitled).toBe(false) // incomplete never actually paid
  })

  // everSubscribed drives "subscription ended" vs "trial ended" copy — it must imply a real payment
  // happened, not merely that a Stripe subscription id was created during an abandoned checkout.
  describe('everSubscribed', () => {
    it('is true when a payment actually occurred (active sub)', () => {
      const e = deriveEntitlement(
        row({ status: 'active', stripe_subscription_id: 'sub_1', current_period_end: inDays(20) }),
        NOW,
      )
      expect(e.everSubscribed).toBe(true)
    })

    it('is true for a canceled sub that was previously paid', () => {
      const e = deriveEntitlement(
        row({ status: 'canceled', stripe_subscription_id: 'sub_1', current_period_end: inDays(-2) }),
        NOW,
      )
      expect(e.everSubscribed).toBe(true)
    })

    it('is FALSE for a never-completed checkout (incomplete / incomplete_expired / unpaid)', () => {
      for (const status of ['incomplete', 'incomplete_expired', 'unpaid'] as const) {
        const e = deriveEntitlement(row({ status, stripe_subscription_id: 'sub_1' }), NOW)
        expect(e.everSubscribed, status).toBe(false)
      }
    })

    it('does not change access (entitled) for a never-paid status', () => {
      // guard: B3 must NOT alter the access verdict, only the everSubscribed copy flag
      const e = deriveEntitlement(
        row({ status: 'incomplete', stripe_subscription_id: 'sub_1', current_period_end: inDays(12) }),
        NOW,
      )
      expect(e.everSubscribed).toBe(false)
      expect(e.entitled).toBe(false)
    })
  })
})

describe('fetchSubscription (B1 — never hangs forever)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    maybeSingle.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it('REJECTS when the query never settles, within the timeout', async () => {
    // A stalled connection: maybeSingle() returns a promise that never resolves or rejects.
    maybeSingle.mockReturnValue(new Promise(() => {}))

    const p = fetchSubscription()
    const settled = p.then(
      () => 'resolved',
      () => 'rejected',
    )

    // Before the timeout: still pending.
    await vi.advanceTimersByTimeAsync(SUBSCRIPTION_FETCH_TIMEOUT_MS - 1)
    let raced = await Promise.race([settled, Promise.resolve('pending')])
    expect(raced).toBe('pending')

    // At/after the timeout: the fetch rejects (so refresh()'s catch can fail closed and un-gate).
    await vi.advanceTimersByTimeAsync(1)
    raced = await Promise.race([settled, Promise.resolve('pending')])
    expect(raced).toBe('rejected')
  })

  it('resolves normally (and clears the timer) when the query settles in time', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    await expect(fetchSubscription()).resolves.toBeNull()
    // No pending timers left dangling after a fast success.
    expect(vi.getTimerCount()).toBe(0)
  })
})
