import { describe, it, expect } from 'vitest'
import {
  planForPrice,
  toIso,
  mapSubscriptionToRow,
  needsReconcile,
  RECONCILE_GRACE_MS,
  type PriceMap,
  type StripeSubLike,
} from '../../supabase/functions/_shared/subscription'

const PRICES: PriceMap = { monthly: 'price_m', annual: 'price_a' }

describe('planForPrice', () => {
  it('maps configured prices and null for anything else', () => {
    expect(planForPrice('price_m', PRICES)).toBe('monthly')
    expect(planForPrice('price_a', PRICES)).toBe('annual')
    expect(planForPrice('price_x', PRICES)).toBeNull()
    expect(planForPrice(null, PRICES)).toBeNull()
    expect(planForPrice(undefined, PRICES)).toBeNull()
  })
})

describe('toIso', () => {
  it('converts unix seconds to ISO, null for falsy', () => {
    expect(toIso(1_700_000_000)).toBe(new Date(1_700_000_000_000).toISOString())
    expect(toIso(null)).toBeNull()
    expect(toIso(0)).toBeNull()
    expect(toIso(undefined)).toBeNull()
  })
})

describe('mapSubscriptionToRow', () => {
  const base: StripeSubLike = {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    cancel_at_period_end: false,
    current_period_end: 1_700_000_000,
    items: { data: [{ price: { id: 'price_a' } }] },
    metadata: { user_id: 'u1' },
  }

  it('maps a subscription into the upsert payload', () => {
    expect(mapSubscriptionToRow(base, 'u1', PRICES)).toEqual({
      user_id: 'u1',
      stripe_customer_id: 'cus_1',
      stripe_subscription_id: 'sub_1',
      status: 'active',
      price_id: 'price_a',
      plan: 'annual',
      current_period_end: new Date(1_700_000_000_000).toISOString(),
      cancel_at_period_end: false,
    })
  })

  it('falls back to the item period end when the top-level one is missing', () => {
    const sub: StripeSubLike = { ...base, current_period_end: null, items: { data: [{ price: { id: 'price_m' }, current_period_end: 1_700_000_500 }] } }
    const row = mapSubscriptionToRow(sub, 'u1', PRICES)
    expect(row.current_period_end).toBe(new Date(1_700_000_500_000).toISOString())
    expect(row.plan).toBe('monthly')
  })

  it('handles an unknown price and a missing items array safely', () => {
    const sub: StripeSubLike = { id: 'sub_2', customer: 'cus_2', status: 'past_due', cancel_at_period_end: true, current_period_end: null }
    const row = mapSubscriptionToRow(sub, 'u2', PRICES)
    expect(row).toMatchObject({ price_id: null, plan: null, current_period_end: null, cancel_at_period_end: true, status: 'past_due' })
  })

  it('is deterministic — duplicate deliveries converge to identical rows', () => {
    expect(mapSubscriptionToRow(base, 'u1', PRICES)).toEqual(mapSubscriptionToRow(base, 'u1', PRICES))
  })
})

describe('needsReconcile (revenue-leak detector)', () => {
  const NOW = 1_700_000_000_000
  const iso = (ms: number) => new Date(ms).toISOString()

  it('flags a live row whose paid period elapsed past the grace window', () => {
    expect(needsReconcile({ stripe_subscription_id: 'sub_1', status: 'active', current_period_end: iso(NOW - RECONCILE_GRACE_MS - 1000) }, NOW)).toBe(true)
    expect(needsReconcile({ stripe_subscription_id: 'sub_1', status: 'trialing', current_period_end: iso(NOW - 2 * RECONCILE_GRACE_MS) }, NOW)).toBe(true)
  })

  it('does NOT flag a row still within its period or grace window', () => {
    expect(needsReconcile({ stripe_subscription_id: 'sub_1', status: 'active', current_period_end: iso(NOW + 5 * 86_400_000) }, NOW)).toBe(false)
    expect(needsReconcile({ stripe_subscription_id: 'sub_1', status: 'active', current_period_end: iso(NOW - RECONCILE_GRACE_MS + 1000) }, NOW)).toBe(false) // inside grace
  })

  it('does NOT flag trial-only rows (no Stripe object) or already-terminal statuses', () => {
    expect(needsReconcile({ stripe_subscription_id: null, status: 'trialing', current_period_end: null }, NOW)).toBe(false)
    expect(needsReconcile({ stripe_subscription_id: 'sub_1', status: 'canceled', current_period_end: iso(NOW - 10 * 86_400_000) }, NOW)).toBe(false)
  })
})
