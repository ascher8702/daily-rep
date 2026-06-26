import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { mapSubscriptionToRow, type PriceMap, type StripeSubLike } from '../_shared/subscription.ts'

/**
 * Stripe webhook: keeps each user's `public.subscriptions` row in sync with Stripe. This function is
 * PUBLIC (verify_jwt=false) — Stripe can't send a Supabase JWT — so it authenticates every request by
 * verifying the Stripe signature against STRIPE_WEBHOOK_SECRET. It writes with the service-role client
 * (bypassing RLS, which forbids user writes). For every relevant event we re-RETRIEVE the subscription
 * from Stripe and write its current truth, so out-of-order / duplicate deliveries converge correctly.
 * The row-mapping logic lives in ../_shared/subscription.ts (unit-tested).
 */

const PRICES: PriceMap = {
  monthly: Deno.env.get('STRIPE_PRICE_MONTHLY') ?? 'price_1TmM9lLy7BVo8A05IudiSYkf',
  annual: Deno.env.get('STRIPE_PRICE_ANNUAL') ?? 'price_1TmM9lLy7BVo8A056dF3HnGw',
}

// Signature verification needs the WebCrypto-backed provider in Deno; it carries no secret.
const cryptoProvider = Stripe.createSubtleCryptoProvider()

/** Build the Stripe + admin clients from env, or null if a required secret is missing. */
function makeClients(): { stripe: Stripe; admin: SupabaseClient } | null {
  const secret = Deno.env.get('STRIPE_SECRET_KEY')
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!secret || !url || !serviceKey) return null
  const stripe = new Stripe(secret, {
    apiVersion: '2024-06-20',
    httpClient: Stripe.createFetchHttpClient(),
  })
  return { stripe, admin: createClient(url, serviceKey) }
}

/** Re-fetch the subscription from Stripe and mirror its state into our table. */
async function syncSubscription(
  stripe: Stripe,
  admin: SupabaseClient,
  subId: string,
  fallbackUid?: string | null,
) {
  const sub = await stripe.subscriptions.retrieve(subId)

  let uid = (sub.metadata?.user_id as string | undefined) ?? fallbackUid ?? null
  if (!uid) {
    // Fall back to our stored customer→user mapping if metadata is somehow absent.
    const { data } = await admin
      .from('subscriptions')
      .select('user_id')
      .eq('stripe_customer_id', sub.customer as string)
      .maybeSingle()
    uid = data?.user_id ?? null
  }
  if (!uid) {
    console.warn('[stripe-webhook] could not resolve user for subscription', subId)
    return
  }

  const row = mapSubscriptionToRow(sub as unknown as StripeSubLike, uid, PRICES)
  const { error } = await admin.from('subscriptions').upsert(row, { onConflict: 'user_id' })
  if (error) {
    // 23505 = the incoming stripe_customer_id / stripe_subscription_id already belongs to a DIFFERENT
    // user_id row (only reachable via out-of-band re-association). Retrying can't resolve it, so log
    // loudly for manual reconciliation and acknowledge rather than letting Stripe retry forever.
    if ((error as { code?: string }).code === '23505') {
      console.error('[stripe-webhook] unique conflict (manual reconcile needed)', { subId, uid, msg: error.message })
      return
    }
    throw error
  }
}

/** Mark a deleted Stripe customer's local row canceled (revokes access via the entitlement gate). */
async function markCustomerCanceled(admin: SupabaseClient, customerId: string) {
  const { error } = await admin
    .from('subscriptions')
    .update({ status: 'canceled', cancel_at_period_end: true })
    .eq('stripe_customer_id', customerId)
  if (error) {
    console.error('[stripe-webhook] failed to cancel row for deleted customer', { customerId, msg: error.message })
    throw error
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  const clients = makeClients()
  if (!clients) {
    // Fail LOUD and clear rather than crashing at module import (which Stripe reads as a flapping 5xx).
    console.error('[stripe-webhook] missing STRIPE_SECRET_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
    return new Response('billing is not configured', { status: 500 })
  }
  const { stripe, admin } = clients

  const sig = req.headers.get('stripe-signature')
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  if (!sig || !secret) return new Response('missing signature / secret', { status: 400 })

  const body = await req.text()
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, secret, undefined, cryptoProvider)
  } catch (e) {
    console.error('[stripe-webhook] signature verification failed', e)
    return new Response('invalid signature', { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session
        if (s.subscription) {
          const uid = (s.client_reference_id as string) || (s.metadata?.user_id as string) || null
          await syncSubscription(stripe, admin, s.subscription as string, uid)
        }
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      // Paused/resumed change the subscription status (e.g. → 'paused', which is NOT in our access
      // statuses, so a paused user is correctly de-entitled); re-retrieving covers them like any update.
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed': {
        const sub = event.data.object as Stripe.Subscription
        await syncSubscription(stripe, admin, sub.id, (sub.metadata?.user_id as string) || null)
        break
      }
      case 'customer.deleted': {
        // The Stripe customer was deleted out-of-band; their subscription object is gone, so re-syncing
        // it would 404. Mark the local row canceled so the entitlement gate revokes access.
        const cust = event.data.object as Stripe.Customer
        await markCustomerCanceled(admin, cust.id)
        break
      }
      case 'charge.dispute.created': {
        // A chargeback. Stripe will typically follow with a subscription.updated/deleted when it acts,
        // which we already handle — but log loudly for ops/alerting since it needs a human eye.
        const d = event.data.object as Stripe.Dispute
        console.error('[stripe-webhook] charge dispute created', { dispute: d.id, charge: d.charge, amount: d.amount })
        break
      }
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        // Keep status / current_period_end fresh through renewals and dunning that may not also emit a
        // subscription.* event.
        const inv = event.data.object as Stripe.Invoice & { subscription?: string | null }
        if (inv.subscription) await syncSubscription(stripe, admin, inv.subscription as string, null)
        break
      }
      default:
        break
    }
  } catch (e) {
    // Return non-2xx so Stripe retries with backoff. Don't echo the raw exception.
    console.error('[stripe-webhook] handler error', e)
    return new Response('handler error', { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
