import { supabase } from './supabase'

/**
 * Admin portal client. Thin wrapper over the `admin` Edge Function, which enforces real authorization
 * server-side (caller's verified email ∈ ADMIN_EMAILS) — nothing here is trusted as an admin signal.
 */

export interface PendingCleanupRow {
  id: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  reason: string | null
  attempts: number
  last_attempt_at: string | null
  created_at: string
}

type AdminResult<T> = { data?: T; error?: string }

/** Invoke the admin function and normalize its `{ ... } | { error }` body, reading error bodies on non-2xx. */
async function adminInvoke<T>(action: string, body?: Record<string, unknown>): Promise<AdminResult<T>> {
  if (!supabase) return { error: 'not_configured' }
  const { data, error } = await supabase.functions.invoke('admin', { body: { action, ...body } })
  if (error) {
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        const j = (await ctx.json()) as { error?: string }
        if (j?.error) return { error: j.error }
      }
    } catch {
      /* fall through */
    }
    return { error: error.message }
  }
  return { data: (data ?? {}) as T }
}

/** True only if the signed-in caller is an admin (server-verified). Never throws. */
export async function checkAdmin(): Promise<boolean> {
  const res = await adminInvoke<{ admin?: boolean }>('whoami')
  return !!res.data?.admin
}

/** The pending Stripe-cleanup queue (deletions whose Stripe cancel failed and need remediation). */
export async function listCleanup(): Promise<AdminResult<PendingCleanupRow[]>> {
  const res = await adminInvoke<{ rows: PendingCleanupRow[] }>('list')
  return res.error ? { error: res.error } : { data: res.data?.rows ?? [] }
}

/** Re-attempt the Stripe cleanup for one queued row. On success it's removed from the queue. */
export async function retryCleanup(id: string): Promise<AdminResult<{ cleared?: boolean; note?: string }>> {
  return adminInvoke('retry', { id })
}

/** Drop a queued row without retrying (handled out-of-band / no longer relevant). */
export async function dismissCleanup(id: string): Promise<AdminResult<{ ok?: boolean }>> {
  return adminInvoke('dismiss', { id })
}
