/**
 * Pure, dependency-free helpers shared by the Stripe webhook and the reconcile job. Deliberately NO
 * Deno or Stripe (esm.sh) imports here — only local structural types — so this money-path logic is
 * unit-testable under BOTH `deno test` (supabase/functions/_shared/subscription_test.ts) and the repo's
 * vitest runner (src/__tests__/subscriptionShared.test.ts). Keep it pure.
 */

export interface PriceMap {
  monthly: string
  annual: string
}

/** Map a Stripe price id → our plan label, or null if it's neither configured price. */
export function planForPrice(priceId: string | null | undefined, prices: PriceMap): string | null {
  if (priceId && priceId === prices.monthly) return 'monthly'
  if (priceId && priceId === prices.annual) return 'annual'
  return null
}

/** Unix seconds → ISO string (or null). */
export function toIso(unixSeconds: number | null | undefined): string | null {
  return unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null
}

/** The subset of a Stripe Subscription this code reads (structural — avoids importing the Stripe types). */
export interface StripeSubLike {
  id: string
  customer: string
  status: string
  cancel_at_period_end?: boolean | null
  current_period_end?: number | null
  items?: { data?: Array<{ price?: { id?: string | null } | null; current_period_end?: number | null }> }
  metadata?: Record<string, string> | null
}

/** The exact payload we upsert into public.subscriptions. */
export interface SubscriptionRowUpsert {
  user_id: string
  stripe_customer_id: string
  stripe_subscription_id: string
  status: string
  price_id: string | null
  plan: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
}

/**
 * Map a Stripe subscription + resolved uid into the public.subscriptions upsert payload. Pure: identical
 * input always yields identical output, so duplicate / out-of-order webhook deliveries converge.
 */
export function mapSubscriptionToRow(sub: StripeSubLike, uid: string, prices: PriceMap): SubscriptionRowUpsert {
  const item = sub.items?.data?.[0]
  const priceId = item?.price?.id ?? null
  // apiVersion 2024-06-20 exposes current_period_end at the top level; fall back to the item for safety.
  const cpe = sub.current_period_end ?? item?.current_period_end ?? null
  return {
    user_id: uid,
    stripe_customer_id: sub.customer,
    stripe_subscription_id: sub.id,
    status: sub.status,
    price_id: priceId,
    plan: planForPrice(priceId, prices),
    current_period_end: toIso(cpe),
    cancel_at_period_end: !!sub.cancel_at_period_end,
  }
}

/** The local-row fields the reconcile job inspects to decide staleness. */
export interface LocalSubRow {
  stripe_subscription_id: string | null
  status: string
  current_period_end: string | null
}

/** Statuses that still grant access — a row stuck in one of these past its period end is the leak. */
export const LIVE_STATUSES = ['active', 'trialing', 'past_due']

/** Grace after the period end before we consider a row stale (avoids racing a just-fired renewal webhook). */
export const RECONCILE_GRACE_MS = 60 * 60 * 1000 // 1h

/**
 * True if a local subscription row should be re-synced from Stripe. Targets the revenue-leak case: a row
 * still marked live (active/trialing/past_due) whose paid period elapsed — i.e. a renewal or cancellation
 * event we may have missed. A trial-only row (no stripe_subscription_id) is NOT reconciled here (it has
 * no Stripe object to fetch; its expiry is handled by the entitlement read). `now` is epoch ms.
 */
export function needsReconcile(row: LocalSubRow, now: number): boolean {
  if (!row.stripe_subscription_id) return false
  if (!LIVE_STATUSES.includes(row.status)) return false
  const cpe = row.current_period_end ? new Date(row.current_period_end).getTime() : 0
  return cpe > 0 && cpe < now - RECONCILE_GRACE_MS
}
