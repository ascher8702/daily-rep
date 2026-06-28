import { supabase } from './supabase'
import { emitToast } from './toast'
import type { Tables } from './database.types'

/**
 * Billing / entitlement helpers (Stripe). The app is a paid product gated behind a 30-day, card-free
 * free trial: a fresh account is entitled for 30 days with no payment details, after which an active
 * Stripe subscription is required. The authoritative state lives in the per-user `subscriptions` row
 * (written only by the Stripe webhook / signup trigger; users have read-only RLS), which this module
 * reads and reduces into a simple `Entitlement`. Checkout / portal happen via Stripe-hosted redirects,
 * so the client never loads Stripe.js and no publishable key ships to the browser.
 */

export type SubscriptionRow = Tables<'subscriptions'>
export type PlanId = 'monthly' | 'annual'

/** Display pricing (USD). The server owns the real Stripe price IDs — the client only sends a plan id. */
export const PRICING: Record<PlanId, {
  id: PlanId
  label: string
  price: string
  cadence: string
  /** sub-label, e.g. monthly-equivalent for the annual plan */
  note?: string
  badge?: string
}> = {
  monthly: { id: 'monthly', label: 'Monthly', price: '$7.99', cadence: '/month', note: 'Billed monthly' },
  annual: {
    id: 'annual',
    label: 'Annual',
    price: '$59.99',
    cadence: '/year',
    note: 'Just $5.00/mo · billed yearly',
    badge: 'Save 37%',
  },
}

export const TRIAL_DAYS = 30

export interface Entitlement {
  /** still resolving the subscription row */
  loading: boolean
  /** has access to the app right now (active/trialing sub OR within the card-free trial window) */
  entitled: boolean
  /** access is coming from the free trial and the user has NOT subscribed yet (drives the nudge banner) */
  inTrial: boolean
  /** whole days left in the free trial (0 when not in trial) */
  trialDaysLeft: number
  /** a live (paid or trialing) Stripe subscription exists */
  hasSubscription: boolean
  /** the user has had a Stripe subscription at some point (drives "subscription ended" vs "trial ended") */
  everSubscribed: boolean
  status: string | null
  plan: PlanId | null
  cancelAtPeriodEnd: boolean
  /** ISO string of the current paid period end (renewal / access-until date) */
  currentPeriodEnd: string | null
  trialEndsAt: string | null
}

// Stripe statuses that still grant access (past_due = dunning grace before cancellation).
const ACTIVE_STATUSES = ['active', 'trialing', 'past_due']
// Statuses where a future current_period_end is NOT paid time (the user never successfully paid).
const NEVER_PAID_STATUSES = ['unpaid', 'incomplete', 'incomplete_expired']

const DAY_MS = 86_400_000

/** Reduce a subscription row into the app's entitlement view. Pure — exported for unit tests. */
export function deriveEntitlement(
  row: SubscriptionRow | null,
  now: number = Date.now(),
): Omit<Entitlement, 'loading'> {
  // No row means the server cannot prove access. The signup trigger should create a row in the same
  // transaction as the user; failing closed prevents cache-clearing/request-blocking from bypassing the
  // paid gate and makes provisioning faults observable.
  if (!row) {
    return {
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
  }

  const hasSubscription = !!row.stripe_subscription_id && ACTIVE_STATUSES.includes(row.status)
  const trialEndMs = row.trial_ends_at ? new Date(row.trial_ends_at).getTime() : 0
  const trialActive = trialEndMs > now
  const trialDaysLeft = trialActive ? Math.max(0, Math.ceil((trialEndMs - now) / DAY_MS)) : 0
  // A subscription canceled IMMEDIATELY (admin/portal "cancel now") goes status='canceled' while the
  // already-paid current_period_end is still in the future — typically with no proration refund. Honor
  // that paid time so we don't hard-paywall someone who paid through the end of the period. Exclude the
  // never-actually-paid statuses (a future period end there isn't paid access). The graceful in-app
  // path uses cancel_at_period_end + status='active', so it's already covered by hasSubscription.
  const periodEndMs = row.current_period_end ? new Date(row.current_period_end).getTime() : 0
  const paidPeriodActive =
    !!row.stripe_subscription_id && periodEndMs > now && !NEVER_PAID_STATUSES.includes(row.status)

  return {
    entitled: hasSubscription || trialActive || paidPeriodActive,
    inTrial: !hasSubscription && trialActive,
    trialDaysLeft,
    hasSubscription,
    everSubscribed: !!row.stripe_subscription_id,
    status: row.status,
    plan: (row.plan as PlanId | null) ?? null,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    currentPeriodEnd: row.current_period_end,
    trialEndsAt: row.trial_ends_at,
  }
}

/** Fetch the caller's subscription row (RLS scopes it to them; returns null when none / unconfigured). */
export async function fetchSubscription(): Promise<SubscriptionRow | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('subscriptions').select('*').maybeSingle()
  if (error) throw error
  return data
}

const GENERIC_ERROR = 'Something went wrong. Please try again.'
const FRIENDLY: Record<string, string> = {
  billing_not_configured: 'Billing isn’t set up yet. Please try again later.',
  'billing is not configured': 'Billing isn’t set up yet. Please try again later.',
  no_billing_account: 'You don’t have a billing account yet — subscribe first.',
  no_subscription: 'You don’t have an active subscription.',
  subscription_not_active: 'Your subscription isn’t active.',
  invalid_plan: 'That plan is unavailable. Please try again.',
  'invalid plan': 'That plan is unavailable. Please try again.',
  unauthorized: 'Please sign in again to continue.',
  missing_authorization: 'Please sign in again to continue.',
  method_not_allowed: GENERIC_ERROR,
  internal_error: 'Something went wrong on our end. Please try again.',
  already_subscribed: 'You already have an active subscription.',
}
// NEVER echo a raw server code to the user — fall back to a generic message for any unmapped code, so a
// new/internal error string can't leak into the UI.
function friendly(code: string): string {
  return FRIENDLY[code] ?? GENERIC_ERROR
}

/** Invoke an Edge Function and normalize its `{ url } | { error }` body, reading error bodies on non-2xx. */
async function invokeBilling(
  name: string,
  body?: Record<string, unknown>,
): Promise<{ url?: string; error?: string }> {
  if (!supabase) return { error: 'billing_not_configured' }
  const { data, error } = await supabase.functions.invoke(name, body ? { body } : {})
  if (error) {
    // supabase-js FunctionsHttpError carries the raw Response in `.context`; read our JSON error code.
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        const j = (await ctx.json()) as { error?: string }
        if (j?.error) return { error: j.error }
      }
    } catch {
      /* fall through to the generic message */
    }
    return { error: error.message }
  }
  return (data ?? {}) as { url?: string; error?: string }
}

/**
 * Start a Stripe Checkout for `plan` and redirect the browser to it. Returns null on a successful
 * redirect, or a human-readable error string. If the user already has a live subscription, transparently
 * opens the billing portal instead (so an early-subscribe tap during/after a sub does the sane thing).
 */
export async function startCheckout(plan: PlanId): Promise<string | null> {
  const res = await invokeBilling('create-checkout-session', { plan })
  if (res.error === 'already_subscribed') {
    // They already have a live subscription — send them to manage it instead of double-subscribing,
    // but say so first so the jump to the billing portal isn't a surprise.
    emitToast('You already have a subscription — opening your billing settings.')
    return openBillingPortal()
  }
  if (res.error) return friendly(res.error)
  if (res.url) {
    window.location.assign(res.url)
    return null
  }
  return 'Could not start checkout. Please try again.'
}

/** Turn auto-renew on/off (sets cancel_at_period_end). Returns null on success or an error string. */
export async function setAutoRenew(autoRenew: boolean): Promise<string | null> {
  const res = await invokeBilling('set-auto-renew', { autoRenew })
  if (res.error) return friendly(res.error)
  return null
}

/** Open the Stripe Billing Portal (manage / cancel / switch plan / update card) and redirect to it. */
export async function openBillingPortal(): Promise<string | null> {
  const res = await invokeBilling('create-portal-session')
  if (res.error) return friendly(res.error)
  if (res.url) {
    window.location.assign(res.url)
    return null
  }
  return 'Could not open the billing portal. Please try again.'
}
