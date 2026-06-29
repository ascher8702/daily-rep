import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { checkRateLimit, InMemoryRateLimitStore, LIMITS, rateLimitResponseHeaders } from '../_shared/rateLimit.ts'
import { corsHeaders } from '../_shared/cors.ts'

/**
 * Toggle auto-renew for the signed-in caller's subscription. body: { autoRenew: boolean }.
 * Sets `cancel_at_period_end = !autoRenew` on the Stripe subscription (turning it off schedules the sub
 * to end at the current period end — reversible until then; turning it back on resumes it). verify_jwt=true
 * + a uid re-derived from the JWT means a caller can only ever change THEIR OWN subscription. We also
 * mirror the flag onto the local row so the UI reflects it instantly (the webhook later confirms).
 */

// Per-instance fixed-window limiter (one Map per cold start; see spec §11 on warm-instance scope).
const rateStore = new InMemoryRateLimitStore()

Deno.serve(async (req) => {
  const cors = corsHeaders(req)
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

    const { autoRenew } = await req.json().catch(() => ({} as { autoRenew?: boolean }))
    if (typeof autoRenew !== 'boolean') return json({ error: 'invalid request' }, 400)

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: uErr } = await userClient.auth.getUser()
    if (uErr || !user) return json({ error: 'unauthorized' }, 401)
    const uid = user.id

    // Rate-limit authenticated abuse before any Stripe/DB work (anonymous floods are stopped by 401 above).
    const rl = await checkRateLimit(rateStore, 'auto-renew:' + uid, LIMITS.GATED_WRITE, Date.now())
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: { ...cors, 'Content-Type': 'application/json', ...rateLimitResponseHeaders(rl) },
      })
    }

    const admin = createClient(url, service)
    const { data: row } = await admin
      .from('subscriptions')
      .select('stripe_subscription_id')
      .eq('user_id', uid)
      .maybeSingle()

    const subId = row?.stripe_subscription_id as string | undefined
    if (!subId) return json({ error: 'no_subscription' }, 400)

    const stripe = new Stripe(secretKey, {
      apiVersion: '2024-06-20',
      httpClient: Stripe.createFetchHttpClient(),
    })

    const sub = await stripe.subscriptions.update(subId, { cancel_at_period_end: !autoRenew })

    // Mirror immediately so the UI flips without waiting for the webhook.
    await admin.from('subscriptions').update({ cancel_at_period_end: !autoRenew }).eq('user_id', uid)

    return json({ ok: true, cancel_at_period_end: sub.cancel_at_period_end })
  } catch (e) {
    console.error('[set-auto-renew] error', e)
    return json({ error: 'internal_error' }, 500)
  }
})
