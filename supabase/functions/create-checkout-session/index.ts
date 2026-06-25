import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

/**
 * Creates a Stripe Checkout Session (subscription mode) for the signed-in caller and returns its URL.
 * verify_jwt=true gates this to authenticated users; the uid is re-derived from the JWT so a caller can
 * only ever subscribe THEMSELVES. We reuse (or lazily create) one Stripe Customer per user and, when the
 * user still has time left on their app-granted free trial, carry that trial over to Stripe via
 * `subscription_data.trial_end` so subscribing early never shortens the trial.
 */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Test-mode price IDs are NOT secret — baked in as defaults, overridable via env for live mode.
const PRICES: Record<string, string> = {
  monthly: Deno.env.get('STRIPE_PRICE_MONTHLY') ?? 'price_1Tm0XVLukft9AoLzOS6G8osy',
  annual: Deno.env.get('STRIPE_PRICE_ANNUAL') ?? 'price_1Tm0XVLukft9AoLzo1nBQcto',
}

const DAY_MS = 86_400_000
const TRIAL_DAYS = 30
// Stripe Checkout requires a carried-over trial_end to be at least 48h in the future.
const TRIAL_MIN_LEAD_MS = 48 * 60 * 60 * 1000
// Statuses that mean "already has a live subscription" — don't let them open a second checkout.
const LIVE_STATUSES = ['active', 'trialing', 'past_due']

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const secretKey = Deno.env.get('STRIPE_SECRET_KEY')
    if (!secretKey) return json({ error: 'billing is not configured' }, 500)

    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) return json({ error: 'missing authorization' }, 401)

    const { plan } = await req.json().catch(() => ({} as { plan?: string }))
    const priceId = PRICES[String(plan)]
    if (!priceId) return json({ error: 'invalid plan' }, 400)

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: uErr } = await userClient.auth.getUser()
    if (uErr || !user) return json({ error: 'unauthorized' }, 401)
    const uid = user.id

    const admin = createClient(url, service)
    const stripe = new Stripe(secretKey, {
      apiVersion: '2024-06-20',
      httpClient: Stripe.createFetchHttpClient(),
    })

    const { data: row } = await admin
      .from('subscriptions')
      .select('stripe_customer_id, stripe_subscription_id, status, trial_ends_at, created_at')
      .eq('user_id', uid)
      .maybeSingle()

    // Fast path: the local row already shows a live subscription → send them to the portal instead.
    if (row?.stripe_subscription_id && LIVE_STATUSES.includes(row.status)) {
      return json({ error: 'already_subscribed' }, 409)
    }

    // Reuse the user's Stripe customer, or create one (idempotency key dedupes concurrent first taps).
    let customerId = row?.stripe_customer_id as string | undefined
    const reusedCustomer = !!customerId
    if (!customerId) {
      const customer = await stripe.customers.create(
        { email: user.email ?? undefined, metadata: { user_id: uid } },
        { idempotencyKey: `customer_${uid}` },
      )
      customerId = customer.id
      await admin
        .from('subscriptions')
        .upsert({ user_id: uid, stripe_customer_id: customerId }, { onConflict: 'user_id' })
    }

    // Authoritative duplicate-subscription guard: the local row is written asynchronously by the
    // webhook, so a user who just completed one checkout could slip a second one through the fast-path
    // check above. Ask Stripe directly before creating another subscription on the same customer.
    if (reusedCustomer) {
      const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 })
      if (subs.data.some((s) => LIVE_STATUSES.includes(s.status))) {
        return json({ error: 'already_subscribed' }, 409)
      }
    }

    // Carry over the remaining app trial, clamped to the trusted signup window so a tampered
    // trial_ends_at can never buy an unbounded free Stripe trial. Only if Stripe will accept it (>=48h).
    let trialEnd: number | undefined
    const tEnd = row?.trial_ends_at ? new Date(row.trial_ends_at).getTime() : 0
    const created = row?.created_at ? new Date(row.created_at).getTime() : 0
    const cap = created ? created + TRIAL_DAYS * DAY_MS : tEnd
    const effectiveTrialEnd = Math.min(tEnd, cap)
    if (effectiveTrialEnd > Date.now() + TRIAL_MIN_LEAD_MS) trialEnd = Math.floor(effectiveTrialEnd / 1000)

    const origin = req.headers.get('origin')
    const appUrl = Deno.env.get('APP_URL') || origin || 'http://localhost:3000'

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: uid,
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      subscription_data: {
        metadata: { user_id: uid },
        ...(trialEnd ? { trial_end: trialEnd } : {}),
      },
      success_url: `${appUrl}/checkout/return?status=success`,
      cancel_url: `${appUrl}/checkout/return?status=cancel`,
    })

    return json({ url: session.url })
  } catch (e) {
    // Don't echo raw upstream exception text to the client; log it server-side.
    console.error('[create-checkout-session] error', e)
    return json({ error: 'internal_error' }, 500)
  }
})
