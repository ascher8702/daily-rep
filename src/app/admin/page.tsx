'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { listCleanup, retryCleanup, dismissCleanup, type PendingCleanupRow } from '@/lib/admin'
import { fmtDate } from '@/lib/format'
import { emitToast } from '@/lib/toast'
import { useConfirm } from '@/components/ConfirmProvider'
import { BackHeader } from '@/components/settings/ui'
import { RefreshIcon, ChevronLeft } from '@/components/icons'

type View = 'loading' | 'forbidden' | 'error' | 'ready'

/**
 * Admin portal. Reachable at /admin by signed-in users; the `admin` Edge Function authorizes the
 * caller (ADMIN_EMAILS) and a non-admin gets the "not authorized" view. Currently surfaces the Stripe
 * cleanup queue — deletions whose Stripe cancel failed during account deletion — so an operator can
 * retry the cancellation (stop billing) or dismiss a handled row instead of relying on a blind cron.
 */
export default function AdminPage() {
  const router = useRouter()
  const confirm = useConfirm()
  const [view, setView] = useState<View>('loading')
  const [rows, setRows] = useState<PendingCleanupRow[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await listCleanup()
    if (res.error === 'forbidden') return setView('forbidden')
    if (res.error) return setView('error')
    setRows(res.data ?? [])
    setView('ready')
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onRetry = async (row: PendingCleanupRow) => {
    setBusyId(row.id)
    const res = await retryCleanup(row.id)
    setBusyId(null)
    if (res.error) {
      emitToast(res.error === 'stripe_retry_failed' ? 'Stripe still rejected the cleanup — try again later.' : 'Retry failed.')
      void load() // attempts count may have changed
      return
    }
    setRows((rs) => rs.filter((r) => r.id !== row.id))
    emitToast(res.data?.note ? `Cleared (${res.data.note}).` : 'Stripe cleanup completed — billing stopped.')
  }

  const onDismiss = async (row: PendingCleanupRow) => {
    if (
      !(await confirm({
        title: 'Dismiss without retrying?',
        body: 'Removes this row from the queue. Only do this if the subscription/customer was already handled in Stripe — otherwise billing may continue.',
        confirmLabel: 'Dismiss',
        tone: 'danger',
      }))
    )
      return
    setBusyId(row.id)
    const res = await dismissCleanup(row.id)
    setBusyId(null)
    if (res.error) return emitToast('Could not dismiss.')
    setRows((rs) => rs.filter((r) => r.id !== row.id))
  }

  if (view === 'loading') {
    return (
      <div className="h-[100dvh] grid place-items-center bg-bg text-fg/50">
        <RefreshIcon size={26} className="animate-spin" />
      </div>
    )
  }

  if (view === 'forbidden') {
    return (
      <div className="h-[100dvh] flex flex-col items-center justify-center gap-4 bg-bg text-fg px-8 text-center animate-fade-in">
        <h1 className="text-2xl font-black uppercase tracking-tight font-display">Not authorized</h1>
        <p className="text-sm text-fg/55 max-w-xs">This area is for administrators only.</p>
        <button onClick={() => router.replace('/')} className="inline-flex items-center gap-1 text-sm font-bold text-blaze-label">
          <ChevronLeft size={16} /> Back to app
        </button>
      </div>
    )
  }

  return (
    <div className="bg-bg min-h-[100dvh] text-fg animate-fade-in">
      <BackHeader title="Admin" />
      <div className="px-5 pt-3.5 pb-10">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-fg/40">Stripe cleanup queue</div>
            <p className="text-xs text-fg/50 mt-1 max-w-[18rem]">
              Account deletions whose Stripe cancel failed. Retry to stop billing; dismiss only if already handled.
            </p>
          </div>
          <button onClick={() => void load()} aria-label="Refresh" className="grid place-items-center h-9 w-9 rounded-full bg-raised text-fg/60 active:scale-95 shrink-0">
            <RefreshIcon size={16} />
          </button>
        </div>

        {view === 'error' && (
          <div className="rounded-2xl bg-[#fcd34d]/10 border border-[#fcd34d]/40 px-4 py-3 text-[13px] font-semibold">
            Couldn’t load the queue. <button onClick={() => void load()} className="text-blaze-label font-bold">Retry</button>
          </div>
        )}

        {view === 'ready' && rows.length === 0 && (
          <div className="rounded-2xl bg-card border border-hairline/10 px-4 py-10 text-center text-sm text-fg/45">
            Queue is empty — nothing needs remediation. ✅
          </div>
        )}

        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.id} className="rounded-2xl bg-card border border-hairline/10 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-[12.5px] font-bold truncate">{r.stripe_customer_id ?? r.stripe_subscription_id ?? '—'}</div>
                  <div className="text-[11px] text-fg/45 mt-0.5">
                    {r.stripe_customer_id ? 'customer' : 'subscription'} · {fmtDate(new Date(r.created_at).getTime())}
                    {r.attempts > 0 && <> · {r.attempts} failed attempt{r.attempts === 1 ? '' : 's'}</>}
                  </div>
                  {r.reason && <div className="text-[11px] text-fg/35 mt-0.5">{r.reason}</div>}
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => void onRetry(r)}
                  disabled={busyId === r.id}
                  className="flex-1 rounded-xl bg-gradient-blaze text-on-accent font-extrabold text-[13px] py-2.5 shadow-button active:scale-[0.99] disabled:opacity-60"
                >
                  {busyId === r.id ? 'Working…' : 'Retry cancel'}
                </button>
                <button
                  onClick={() => void onDismiss(r)}
                  disabled={busyId === r.id}
                  className="rounded-xl border border-[#fb7185]/40 bg-[#fb7185]/[0.06] text-[#fb7185] font-extrabold text-[13px] px-4 py-2.5 disabled:opacity-60"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
