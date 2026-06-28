import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

/**
 * Creates a Stripe Billing Portal session for the signed-in caller (manage / cancel / switch plan /
 * update card) and returns its URL. verify_jwt=true gates this; the uid is re-derived from the JWT and
 * we only ever open the portal for THAT user's stored Stripe customer (no IDOR).
 */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PORTAL_CONFIG = Deno.env.get('STRIPE_PORTAL_CONFIG') ?? 'bpc_1Tn00rLy7BVo8A05wyjktR9Z'

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

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: uErr } = await userClient.auth.getUser()
    if (uErr || !user) return json({ error: 'unauthorized' }, 401)
    const uid = user.id

    const admin = createClient(url, service)
    const { data: row } = await admin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', uid)
      .maybeSingle()

    const customerId = row?.stripe_customer_id as string | undefined
    if (!customerId) return json({ error: 'no_billing_account' }, 400)

    const stripe = new Stripe(secretKey, {
      apiVersion: '2024-06-20',
      httpClient: Stripe.createFetchHttpClient(),
    })

    const origin = req.headers.get('origin')
    const appUrl = Deno.env.get('APP_URL') || origin || 'http://localhost:3000'

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/settings`,
      ...(PORTAL_CONFIG ? { configuration: PORTAL_CONFIG } : {}),
    })

    return json({ url: portal.url })
  } catch (e) {
    console.error('[create-portal-session] error', e)
    return json({ error: 'internal_error' }, 500)
  }
})
