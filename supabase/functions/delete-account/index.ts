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

    // Stop billing + erase PII at Stripe BEFORE the cascade destroys the only stripe id mapping.
    // Deleting the Customer cancels all of its subscriptions AND removes the stored email/PII (Stripe
    // retains invoices for tax/legal — permitted under GDPR Art.17(3)(b)). This covers a sub created at
    // Checkout completion before the webhook wrote stripe_subscription_id (we resolve via the customer).
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
    if (stripeKey) {
      const { data: subRow } = await admin
        .from('subscriptions')
        .select('stripe_customer_id, stripe_subscription_id')
        .eq('user_id', uid)
        .maybeSingle()
      const customerId = (subRow?.stripe_customer_id as string | null) ?? null
      const subId = (subRow?.stripe_subscription_id as string | null) ?? null
      if (customerId || subId) {
        const stripe = new Stripe(stripeKey, {
          apiVersion: '2024-06-20',
          httpClient: Stripe.createFetchHttpClient(),
        })
        try {
          if (customerId) await stripe.customers.del(customerId) // cancels its subs + erases PII
          else if (subId) await stripe.subscriptions.cancel(subId) // no customer on file → stop billing
        } catch (e) {
          // CRITICAL: never silently continue past a failed cancel — the row (and its stripe ids) is
          // about to be cascade-deleted, so the webhook could never reconcile and the card would keep
          // being charged. Persist the ids to a NON-cascade recovery table for retry/audit first.
          console.error('[delete-account] stripe cleanup FAILED — queuing for retry', { customerId, subId, err: String(e) })
          await admin
            .from('pending_stripe_cleanup')
            .insert({ stripe_customer_id: customerId, stripe_subscription_id: subId, reason: 'delete_account_cleanup_failed' })
            .then(({ error }) => {
              if (error) console.error('[delete-account] could not queue stripe cleanup', { customerId, subId, err: error.message })
            })
        }
      }
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
