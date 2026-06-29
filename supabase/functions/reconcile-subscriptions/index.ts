import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { mapSubscriptionToRow, needsReconcile, LIVE_STATUSES, type PriceMap, type StripeSubLike } from '../_shared/subscription.ts'
import {
  consumeRateLimitWithFallback,
  InMemoryRateLimitStore,
  LIMITS,
  rateLimitResponseHeaders,
} from '../_shared/rateLimit.ts'
import { secretEquals } from '../_shared/secrets.ts'

/**
 * Scheduled reconciliation: the safety net for MISSED webhooks. If Stripe's
 * `customer.subscription.deleted`/`.updated` (or a renewal) never reaches us, a row can stay marked
 * active/trialing/past_due forever past its paid period — a revenue/access leak. This job re-fetches
 * those stale rows from Stripe and re-mirrors their true state (using the same pure mapper as the
 * webhook). Idempotent; safe to run repeatedly.
 *
 * PUBLIC (verify_jwt=false) because pg_cron/pg_net invokes it server-to-server — so it authenticates via
 * a shared secret header `x-reconcile-secret` == env RECONCILE_SECRET. Never expose this without it.
 */

function priceMap(): PriceMap | null {
  const monthly = Deno.env.get('STRIPE_PRICE_MONTHLY')
  const annual = Deno.env.get('STRIPE_PRICE_ANNUAL')
  return monthly && annual ? { monthly, annual } : null
}

const BATCH_LIMIT = 200

// Per-instance fixed-window limiter — fallback only. The primary limiter is the shared Postgres bucket
// via consumeRateLimitWithFallback(), so the budget is not diluted across warm instances.
const rateStore = new InMemoryRateLimitStore()

/**
 * Client IP for per-IP rate limiting. Prefer the LAST x-forwarded-for hop (the one the platform proxy
 * appends, which a client cannot forge) over the first (client-claimed) hop — otherwise a spoofed
 * `X-Forwarded-For: <random>` header lets an attacker reset their per-IP budget on every request. Falls
 * back to x-real-ip, then 'unknown'.
 */
function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const hops = fwd.split(',').map((h) => h.trim()).filter(Boolean)
    if (hops.length > 0) return hops[hops.length - 1]
  }
  return req.headers.get('x-real-ip') ?? 'unknown'
}

function makeClients(): { stripe: Stripe; admin: SupabaseClient; prices: PriceMap } | null {
  const secret = Deno.env.get('STRIPE_SECRET_KEY')
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const prices = priceMap()
  if (!secret || !url || !serviceKey || !prices) return null
  const stripe = new Stripe(secret, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() })
  return { stripe, admin: createClient(url, serviceKey), prices }
}

/** Service-role client for the global pre-auth rate limiter. Kept separate from makeClients() so a
 * malformed flood is rejected before any Stripe client is built. */
function makeRateLimitClient(): SupabaseClient | null {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  return url && serviceKey ? createClient(url, serviceKey) : null
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  // Coarse IP pre-filter BEFORE the shared-secret check. Fail-open on a limiter error (a dropped
  // reconcile run is benign — the next cron run is the backstop — but we never gratuitously block a
  // legitimate invocation).
  const rl = await consumeRateLimitWithFallback(
    makeRateLimitClient(),
    rateStore,
    'reconcile:' + clientIp(req),
    LIMITS.PUBLIC_IP,
    Date.now(),
    {
      onPrimaryError: (e) =>
        console.warn('[reconcile] rate-limit RPC failed, falling back to in-memory store', String(e)),
    },
  )
  if (rl && !rl.allowed) {
    return new Response('rate limited', { status: 429, headers: rateLimitResponseHeaders(rl) })
  }

  // Shared-secret auth. Constant-time comparison (see _shared/secrets.ts) so the secret can't be
  // recovered byte-by-byte via response-timing; an empty/missing RECONCILE_SECRET always rejects.
  const expected = Deno.env.get('RECONCILE_SECRET')
  if (!(await secretEquals(req.headers.get('x-reconcile-secret'), expected))) {
    return new Response('unauthorized', { status: 401 })
  }

  const clients = makeClients()
  if (!clients) {
    console.error('[reconcile] missing Stripe/Supabase billing configuration')
    return new Response('not configured', { status: 500 })
  }
  const { stripe, admin, prices } = clients
  const now = Date.now()

  // Candidate rows: still in an access-granting status with a sub id and a period end already in the
  // past (the DB pre-filter); needsReconcile() then applies the grace window precisely.
  const { data: rows, error } = await admin
    .from('subscriptions')
    .select('user_id, stripe_subscription_id, status, current_period_end')
    .in('status', LIVE_STATUSES)
    .not('stripe_subscription_id', 'is', null)
    .lt('current_period_end', new Date(now).toISOString())
    .limit(BATCH_LIMIT)
  if (error) {
    console.error('[reconcile] query failed', error.message)
    return new Response('query failed', { status: 500 })
  }

  // Saturation signal: if we hit the batch ceiling there may be more stale rows than one run drains
  // (next run, ≤6h later, picks up the rest). Surface it so ops can raise the cadence/limit if needed.
  if ((rows?.length ?? 0) >= BATCH_LIMIT) {
    console.warn('[reconcile] candidate batch hit BATCH_LIMIT — possible backlog', { limit: BATCH_LIMIT })
  }

  const stale = (rows ?? []).filter((r) => needsReconcile(r, now))
  let synced = 0
  let failed = 0
  for (const r of stale) {
    try {
      const sub = await stripe.subscriptions.retrieve(r.stripe_subscription_id as string)
      const mapped = mapSubscriptionToRow(sub as unknown as StripeSubLike, r.user_id, prices)
      const { error: upErr } = await admin.from('subscriptions').upsert(mapped, { onConflict: 'user_id' })
      if (upErr) throw upErr
      synced++
    } catch (e) {
      failed++
      // A deleted subscription (404) means Stripe no longer has it → mark canceled so access is revoked.
      const msg = e instanceof Error ? e.message : String(e)
      if (/No such subscription|resource_missing/i.test(msg)) {
        await admin.from('subscriptions').update({ status: 'canceled' }).eq('user_id', r.user_id)
        synced++
        failed--
      } else {
        console.error('[reconcile] sync failed', { user: r.user_id, msg })
      }
    }
  }

  const summary = { candidates: rows?.length ?? 0, stale: stale.length, synced, failed }
  console.log('[reconcile] done', summary)
  return new Response(JSON.stringify(summary), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
