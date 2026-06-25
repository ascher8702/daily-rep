import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno'

// GDPR Art.17 erasure: deletes the authenticated caller's data (across public + analytics) then their
// auth user. verify_jwt=true gates this to signed-in callers; we re-derive the uid from the JWT so a
// user can only ever delete THEMSELVES (no IDOR). Before purging we best-effort cancel any live Stripe
// subscription so a deleted account is never billed again (the subscriptions row itself is removed by
// the ON DELETE CASCADE when the auth user is deleted).
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) return json({ error: 'missing authorization' }, 401)
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: uErr } = await userClient.auth.getUser()
    if (uErr || !user) return json({ error: 'unauthorized' }, 401)
    const uid = user.id
    const admin = createClient(url, service)

    // Best-effort: cancel any live Stripe subscription so we don't keep billing a deleted account.
    try {
      const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
      if (stripeKey) {
        const { data: subRow } = await admin
          .from('subscriptions')
          .select('stripe_subscription_id')
          .eq('user_id', uid)
          .maybeSingle()
        if (subRow?.stripe_subscription_id) {
          const stripe = new Stripe(stripeKey, {
            apiVersion: '2024-06-20',
            httpClient: Stripe.createFetchHttpClient(),
          })
          await stripe.subscriptions.cancel(subRow.stripe_subscription_id as string)
        }
      }
    } catch (e) {
      console.warn('[delete-account] stripe cancel failed (continuing):', String(e))
    }

    const { error: pErr } = await admin.rpc('purge_user_data', { p_user: uid })
    if (pErr) return json({ error: 'purge failed: ' + pErr.message }, 500)
    const { error: dErr } = await admin.auth.admin.deleteUser(uid)
    if (dErr) return json({ error: 'auth delete failed: ' + dErr.message }, 500)
    return json({ ok: true, deleted: uid })
  } catch (e) {
    console.error('[delete-account] error', e)
    return json({ error: 'internal_error' }, 500)
  }
})
