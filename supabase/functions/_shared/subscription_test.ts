// Deno test for the shared money-path mapper. Run with `deno test supabase/functions/`.
// Named *_test.ts (Deno convention) so the repo's vitest runner — which globs **/*.test.* — ignores it;
// the identical logic is also covered by src/__tests__/subscriptionShared.test.ts under vitest.
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  planForPrice,
  toIso,
  mapSubscriptionToRow,
  needsReconcile,
  RECONCILE_GRACE_MS,
  type PriceMap,
  type StripeSubLike,
} from './subscription.ts'

const PRICES: PriceMap = { monthly: 'price_m', annual: 'price_a' }

Deno.test('planForPrice maps configured prices, null otherwise', () => {
  assertEquals(planForPrice('price_m', PRICES), 'monthly')
  assertEquals(planForPrice('price_a', PRICES), 'annual')
  assertEquals(planForPrice('nope', PRICES), null)
  assertEquals(planForPrice(null, PRICES), null)
})

Deno.test('toIso converts unix seconds, null for falsy', () => {
  assertEquals(toIso(1_700_000_000), new Date(1_700_000_000_000).toISOString())
  assertEquals(toIso(null), null)
  assertEquals(toIso(0), null)
})

Deno.test('mapSubscriptionToRow maps + falls back to item period end', () => {
  const sub: StripeSubLike = {
    id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: true,
    current_period_end: null, items: { data: [{ price: { id: 'price_a' }, current_period_end: 1_700_000_500 }] },
  }
  assertEquals(mapSubscriptionToRow(sub, 'u1', PRICES), {
    user_id: 'u1', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', status: 'active',
    price_id: 'price_a', plan: 'annual', current_period_end: new Date(1_700_000_500_000).toISOString(),
    cancel_at_period_end: true,
  })
})

Deno.test('needsReconcile flags only stale live rows with a sub id', () => {
  const NOW = 1_700_000_000_000
  const iso = (ms: number) => new Date(ms).toISOString()
  assertEquals(needsReconcile({ stripe_subscription_id: 'sub_1', status: 'active', current_period_end: iso(NOW - RECONCILE_GRACE_MS - 1) }, NOW), true)
  assertEquals(needsReconcile({ stripe_subscription_id: 'sub_1', status: 'active', current_period_end: iso(NOW + 1_000_000) }, NOW), false)
  assertEquals(needsReconcile({ stripe_subscription_id: null, status: 'trialing', current_period_end: null }, NOW), false)
  assertEquals(needsReconcile({ stripe_subscription_id: 'sub_1', status: 'canceled', current_period_end: iso(NOW - 1_000_000_000) }, NOW), false)
})
