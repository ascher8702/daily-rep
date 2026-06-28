import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno'
import { checkRateLimit, InMemoryRateLimitStore, LIMITS, rateLimitResponseHeaders } from '../_shared/rateLimit.ts'

// GDPR Art.17 erasure: deletes the authenticated caller's data (across public + analytics) then their
// auth user. verify_jwt=true gates this to signed-in callers; we re-derive the uid from the JWT so a
// user can only ever delete THEMSELVES (no IDOR). Before purging, any live Stripe subscription must be
// canceled successfully; otherwise the delete is rejected so a removed account is never left billing.
// The subscriptions row itself is removed by the ON DELETE CASCADE when the auth user is deleted.
//
// RETENTION CARVE-OUT: public.trial_ledger (a normalized-email anti-trial-abuse marker) is INTENTIONALLY
// NOT erased — it has no FK to auth.users and purge_user_data does not touch it, so a deleted user can't
// farm a fresh free trial by re-registering. Retained on the legitimate-interest (fraud-prevention)
// basis disclosed in the Privacy Policy. It is not used for contact or any other purpose.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const CANCEL_BEFORE_DELETE_STATUSES = ['active', 'trialing', 'past_due', 'paused', 'unpaid', 'incomplete']

// Per-instance fixed-window limiter (one Map per cold start; see spec §11 on warm-instance scope).
const rateStore = new InMemoryRateLimitStore()

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

    // Stricter budget: an irreversible purge must not be spammable. Guard before any Stripe/DB work
    // (anonymous floods are stopped by the 401 above).
    const rl = await checkRateLimit(rateStore, 'delete-account:' + uid, LIMITS.DELETE_ACCOUNT, Date.now())
    if (!rl.allowed) {
      return new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: { ...cors, 'Content-Type': 'application/json', ...rateLimitResponseHeaders(rl) },
      })
    }

    const admin = createClient(url, service)

    const { data: subRow, error: subErr } = await admin
      .from('subscriptions')
      .select('stripe_subscription_id, status')
      .eq('user_id', uid)
      .maybeSingle()
    if (subErr) return json({ error: 'Could not verify billing status. Please try again.' }, 500)

    // If there is a live Stripe subscription, cancellation must succeed before erasing the account. A
    // deleted auth user with a still-billing Stripe subscription is much worse than a retryable delete.
    if (
      subRow?.stripe_subscription_id &&
      CANCEL_BEFORE_DELETE_STATUSES.includes(String(subRow.status))
    ) {
      const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
      if (!stripeKey) {
        console.error('[delete-account] missing STRIPE_SECRET_KEY with active subscription', { uid })
        return json({ error: 'Could not cancel your subscription. Please contact support.' }, 500)
      }
      try {
        const stripe = new Stripe(stripeKey, {
          apiVersion: '2024-06-20',
          httpClient: Stripe.createFetchHttpClient(),
        })
        await stripe.subscriptions.cancel(subRow.stripe_subscription_id as string)
      } catch (e) {
        console.warn('[delete-account] stripe cancel failed:', String(e))
        return json({ error: 'Could not cancel your subscription. Please try again before deleting your account.' }, 502)
      }
    }

    const { error: pErr } = await admin.rpc('purge_user_data', { p_user: uid })
    if (pErr) {
      console.error('[delete-account] purge failed', { uid, msg: pErr.message })
      return json({ error: 'Could not delete your account. Please try again.' }, 500)
    }
    const { error: dErr } = await admin.auth.admin.deleteUser(uid)
    if (dErr) {
      console.error('[delete-account] auth delete failed', { uid, msg: dErr.message })
      return json({ error: 'Could not delete your account. Please try again.' }, 500)
    }
    return json({ ok: true, deleted: uid })
  } catch (e) {
    console.error('[delete-account] error', e)
    return json({ error: 'internal_error' }, 500)
  }
})
