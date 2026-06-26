import { describe, it, expect } from 'vitest'
import { deriveEntitlement, type SubscriptionRow } from '../lib/billing'

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
  it('fails OPEN when there is no row yet (provisioning gap, never lock out a new user)', () => {
    const e = deriveEntitlement(null, NOW)
    expect(e.entitled).toBe(true)
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
})
