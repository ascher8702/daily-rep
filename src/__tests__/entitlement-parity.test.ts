import { describe, it, expect } from 'vitest'
import { deriveEntitlement, type SubscriptionRow } from '../lib/billing'

/**
 * Parity guard: the server-side RLS predicate public.is_active_subscriber()
 * (supabase/migrations/20260626140000_entitlement_rls_on_daily_rep_state.sql) must agree with the
 * client's deriveEntitlement(...).entitled for every subscription shape — otherwise the server could
 * block a write the client thinks is allowed (or vice-versa). These are the SAME cases that were
 * validated against the live Postgres engine (13/13 matched) before the migration was committed; this
 * test pins the TS side so the two definitions can't silently drift.
 */

const NOW = 1_700_000_000_000
const DAY = 86_400_000

function row(p: Partial<SubscriptionRow>): SubscriptionRow {
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
    created_at: new Date(NOW - 10 * DAY).toISOString(),
    updated_at: new Date(NOW).toISOString(),
    ...p,
  }
}

const iso = (ms: number) => new Date(ms).toISOString()

const CASES: Array<{ label: string; row: SubscriptionRow; expected: boolean }> = [
  { label: 'trial_active', expected: true, row: row({ stripe_subscription_id: null, status: 'trialing', trial_ends_at: iso(NOW + 5 * DAY) }) },
  { label: 'trial_expired_neversub', expected: false, row: row({ stripe_subscription_id: null, status: 'trialing', trial_ends_at: iso(NOW - DAY) }) },
  { label: 'active', expected: true, row: row({ stripe_subscription_id: 'sub_1', status: 'active', current_period_end: iso(NOW + 20 * DAY) }) },
  { label: 'active_period_past', expected: true, row: row({ stripe_subscription_id: 'sub_1', status: 'active', current_period_end: iso(NOW - DAY) }) },
  { label: 'past_due', expected: true, row: row({ stripe_subscription_id: 'sub_1', status: 'past_due', current_period_end: iso(NOW + 3 * DAY) }) },
  { label: 'canceled_period_future', expected: true, row: row({ stripe_subscription_id: 'sub_1', status: 'canceled', current_period_end: iso(NOW + 10 * DAY) }) },
  { label: 'canceled_period_past', expected: false, row: row({ stripe_subscription_id: 'sub_1', status: 'canceled', current_period_end: iso(NOW - DAY) }) },
  { label: 'unpaid_period_future', expected: false, row: row({ stripe_subscription_id: 'sub_1', status: 'unpaid', current_period_end: iso(NOW + 10 * DAY) }) },
  { label: 'incomplete_period_future', expected: false, row: row({ stripe_subscription_id: 'sub_1', status: 'incomplete', current_period_end: iso(NOW + 10 * DAY) }) },
  { label: 'incomplete_expired', expected: false, row: row({ stripe_subscription_id: 'sub_1', status: 'incomplete_expired', current_period_end: iso(NOW + 10 * DAY) }) },
  { label: 'canceled_nosub', expected: false, row: row({ stripe_subscription_id: null, status: 'canceled', current_period_end: iso(NOW - DAY) }) },
  { label: 'active_trial_past_period_future', expected: true, row: row({ stripe_subscription_id: 'sub_1', status: 'active', trial_ends_at: iso(NOW - 40 * DAY), current_period_end: iso(NOW + 20 * DAY) }) },
  { label: 'trial_active_status_active_nosub', expected: true, row: row({ stripe_subscription_id: null, status: 'active', trial_ends_at: iso(NOW + 2 * DAY) }) },
]

describe('entitlement parity (deriveEntitlement ↔ is_active_subscriber SQL)', () => {
  it.each(CASES)('$label → entitled=$expected', ({ row, expected }) => {
    expect(deriveEntitlement(row, NOW).entitled).toBe(expected)
  })

  it('fails closed for a missing row (matches the SQL proof-required branch)', () => {
    expect(deriveEntitlement(null, NOW).entitled).toBe(false)
  })
})
