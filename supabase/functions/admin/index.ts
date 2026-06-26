import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno'

/**
 * Admin portal backend. verify_jwt=true gates this to signed-in callers; authorization is then enforced
 * HERE by checking the caller's verified email against the ADMIN_EMAILS allowlist (comma-separated env).
 * A non-admin always gets 403 — there is no client-trusted admin flag. All work uses the service-role
 * client (bypassing RLS), since the data it touches (pending_stripe_cleanup) is service-role only.
 *
 * Actions (POST { action, id? }):
 *  - whoami : returns { admin: true } (200) for an admin, else 403 — lets the UI decide what to render.
 *  - list   : the pending Stripe-cleanup queue (deletions whose cancel failed and need remediation).
 *  - retry  : re-attempt the Stripe cleanup for one queued row; on success delete it, else bump attempts.
 *  - dismiss: delete one queued row (it was handled out-of-band / is no longer relevant).
 */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function adminEmails(): Set<string> {
  return new Set(
    (Deno.env.get('ADMIN_EMAILS') ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  )
}

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) return json({ error: 'missing_authorization' }, 401)

    // Re-derive the caller from the JWT (never trust a client-supplied identity).
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: uErr } = await userClient.auth.getUser()
    if (uErr || !user) return json({ error: 'unauthorized' }, 401)

    const email = (user.email ?? '').toLowerCase()
    if (!email || !adminEmails().has(email)) return json({ error: 'forbidden' }, 403)

    const { action, id } = await req.json().catch(() => ({} as { action?: string; id?: string }))
    const admin = createClient(url, service)

    if (action === 'whoami') return json({ admin: true, email })

    if (action === 'list') {
      const { data, error } = await admin
        .from('pending_stripe_cleanup')
        .select('id, stripe_customer_id, stripe_subscription_id, reason, attempts, last_attempt_at, created_at')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) return json({ error: 'list_failed' }, 500)
      return json({ rows: data ?? [] })
    }

    if (action === 'dismiss') {
      if (!id) return json({ error: 'missing_id' }, 400)
      const { error } = await admin.from('pending_stripe_cleanup').delete().eq('id', id)
      if (error) return json({ error: 'dismiss_failed' }, 500)
      return json({ ok: true })
    }

    if (action === 'retry') {
      if (!id) return json({ error: 'missing_id' }, 400)
      const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
      if (!stripeKey) return json({ error: 'billing_not_configured' }, 500)
      const { data: rowData, error: selErr } = await admin
        .from('pending_stripe_cleanup')
        .select('id, stripe_customer_id, stripe_subscription_id, attempts')
        .eq('id', id)
        .maybeSingle()
      if (selErr) return json({ error: 'retry_failed' }, 500)
      if (!rowData) return json({ error: 'not_found' }, 404)

      const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() })
      const customerId = (rowData.stripe_customer_id as string | null) ?? null
      const subId = (rowData.stripe_subscription_id as string | null) ?? null
      try {
        if (customerId) await stripe.customers.del(customerId) // cancels its subs + erases PII
        else if (subId) await stripe.subscriptions.cancel(subId)
        // success → the row is remediated; drop it from the queue
        await admin.from('pending_stripe_cleanup').delete().eq('id', id)
        return json({ ok: true, cleared: true })
      } catch (e) {
        // still failing (or already gone at Stripe) — record the attempt so it's visible, don't delete
        const msg = String(e)
        const alreadyGone = /No such customer|No such subscription|resource_missing/i.test(msg)
        if (alreadyGone) {
          await admin.from('pending_stripe_cleanup').delete().eq('id', id)
          return json({ ok: true, cleared: true, note: 'already removed at Stripe' })
        }
        await admin
          .from('pending_stripe_cleanup')
          .update({ attempts: ((rowData.attempts as number) ?? 0) + 1, last_attempt_at: new Date().toISOString() })
          .eq('id', id)
        return json({ error: 'stripe_retry_failed' }, 502)
      }
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (e) {
    console.error('[admin] error', e)
    return json({ error: 'internal_error' }, 500)
  }
})
