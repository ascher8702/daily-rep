'use client'

import { useState } from 'react'
import { useAuth } from '@/store/useAuth'
import { useEntitlement } from '@/store/useEntitlement'
import { useStore } from '@/store/useStore'
import { startCheckout, PRICING, type PlanId } from '@/lib/billing'
import { buildUserDataExport, downloadJson } from '@/lib/dataExport'
import { emitToast } from '@/lib/toast'
import { useConfirm } from '@/components/ConfirmProvider'
import { ProBrand, ProFeatures, PlanSelector, BlazeCta } from '@/components/billing/shared'
import { LockIcon, RefreshIcon, DownloadIcon, ChevronRight, ChevronLeft, TrashIcon } from '@/components/icons'

/** lime shield-check used by the "your data is safe" reassurance strips. */
function SafeShield() {
  return (
    <span className="grid place-items-center h-8 w-8 rounded-[9px] bg-[#C6F24E]/10 shrink-0">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#C6F24E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    </span>
  )
}

function ctaLabel(plan: PlanId, verb: string) {
  return `${verb} — ${PRICING[plan].price}/${plan === 'annual' ? 'yr' : 'mo'}`
}

/**
 * The hard paywall gate (rendered by AppShell when a signed-in user is not entitled). Two modes:
 *  - trial-ended      — the card-free trial lapsed, never subscribed
 *  - subscription-ended — a paid subscription was canceled / lapsed
 * Both share the Pro features card + plan selector + pinned footer. A "Your data" subpage keeps
 * export / legal / delete reachable while gated (GDPR — data is never held hostage).
 */
export default function Paywall() {
  const signOut = useAuth((s) => s.signOut)
  const deleteAccount = useAuth((s) => s.deleteAccount)
  const refresh = useEntitlement((s) => s.refresh)
  const everSubscribed = useEntitlement((s) => s.everSubscribed)
  const confirm = useConfirm()
  const [plan, setPlan] = useState<PlanId>('annual')
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [view, setView] = useState<'plans' | 'data'>('plans')

  const mode = everSubscribed ? 'subscription-ended' : 'trial-ended'

  const onSubscribe = async () => {
    setBusy(true)
    const err = await startCheckout(plan)
    if (err) {
      emitToast(err)
      setBusy(false)
    }
  }

  const onRestore = async () => {
    setRestoring(true)
    let entitled = false
    for (let i = 0; i < 5; i++) {
      await refresh()
      entitled = useEntitlement.getState().entitled
      if (entitled) break
      if (i < 4) await new Promise((r) => setTimeout(r, 2000))
    }
    setRestoring(false)
    if (!entitled) emitToast('No active subscription found yet. If you just paid, give it a moment.')
  }

  const onExport = () => {
    const s = useStore.getState()
    const when = new Date().toISOString()
    downloadJson(
      `daily-rep-export-${when.slice(0, 10)}.json`,
      buildUserDataExport({
        profile: s.profile,
        workouts: s.workouts,
        customPlans: s.customPlans,
        activePlan: s.activePlan,
        planProgress: s.planProgress,
        email: useAuth.getState().email ?? null,
        when,
      }),
    )
  }

  const onDelete = async () => {
    if (
      !(await confirm({
        title: 'Delete account?',
        body: 'This permanently deletes your account and ALL your data — profile, workouts and stats — from this device and the cloud. This cannot be undone.',
        confirmLabel: 'Delete account',
        tone: 'danger',
      }))
    )
      return
    const err = await deleteAccount()
    if (err) emitToast(`Couldn't delete account: ${err}`)
  }

  if (view === 'data') {
    return (
      <div className="h-[100dvh] flex flex-col bg-bg text-fg animate-fade-in">
        <header className="safe-top px-5 pt-12 pb-2 flex items-center gap-3">
          <button onClick={() => setView('plans')} aria-label="Back" className="grid place-items-center h-[34px] w-[34px] rounded-full bg-raised">
            <ChevronLeft size={16} className="text-fg/70" strokeWidth={2.2} />
          </button>
          <h1 className="text-[26px] font-black uppercase tracking-[-0.02em] font-display">Your data</h1>
        </header>
        <div className="flex-1 overflow-y-auto px-5 pb-8">
          <p className="text-[13.5px] font-semibold text-fg/60 leading-relaxed mb-[18px]">
            You can manage your account even while your membership is paused. Your data is never held hostage.
          </p>

          <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-fg/40 mb-2.5">Export</div>
          <button onClick={onExport} className="w-full rounded-2xl bg-card border border-hairline/10 p-4 flex items-center gap-3 text-left active:scale-[0.99] transition">
            <span className="grid place-items-center h-[38px] w-[38px] rounded-[11px] bg-blaze/[0.12] text-blaze-label shrink-0">
              <DownloadIcon size={19} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[14.5px] font-extrabold">Export my data</div>
              <div className="text-xs font-semibold text-fg/50 mt-px">Workouts, plans &amp; PRs as JSON.</div>
            </div>
            <ChevronRight size={16} className="text-fg/35 shrink-0" />
          </button>

          <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-fg/40 mt-[22px] mb-2.5">Legal</div>
          <div className="rounded-2xl bg-card border border-hairline/10 overflow-hidden">
            <a href="/privacy" className="flex items-center justify-between px-4 py-3.5"><span className="text-sm font-semibold">Privacy Policy</span><ChevronRight size={15} className="text-fg/35" /></a>
            <div className="h-px bg-hairline/10 ml-4" />
            <a href="/terms" className="flex items-center justify-between px-4 py-3.5"><span className="text-sm font-semibold">Terms of Service</span><ChevronRight size={15} className="text-fg/35" /></a>
          </div>

          <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-[#fb7185] mt-[22px] mb-2.5">Danger zone</div>
          <button onClick={onDelete} className="w-full rounded-2xl bg-[#fb7185]/[0.06] border border-[#fb7185]/30 p-4 flex items-center gap-3 text-left active:scale-[0.99] transition">
            <span className="grid place-items-center h-[38px] w-[38px] rounded-[11px] bg-[#fb7185]/[0.14] text-[#fb7185] shrink-0">
              <TrashIcon size={19} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[14.5px] font-extrabold text-[#fb7185]">Delete account</div>
              <div className="text-xs font-semibold text-fg/50 mt-px">Permanently erase your account &amp; all data.</div>
            </div>
          </button>

          <div className="text-center mt-[22px]">
            <button onClick={() => setView('plans')} className="text-[13px] font-bold text-blaze-label">‹ Back to plans</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-bg text-fg animate-fade-in">
      <div className="flex-1 overflow-y-auto safe-top px-5 pt-12 pb-3.5">
        <ProBrand icon={mode === 'trial-ended' ? <LockIcon size={17} strokeWidth={2.2} /> : undefined} />

        {mode === 'trial-ended' ? (
          <>
            <h1 className="text-[40px] font-black uppercase tracking-[-0.025em] leading-[0.9] mt-4 font-display">
              Your trial<br />has ended
            </h1>
            <p className="text-[14.5px] font-semibold text-fg/60 mt-3 leading-snug">
              Subscribe to keep training. Your history, PRs and plans are all <span className="text-fg font-bold">saved.</span>
            </p>
            <div className="flex items-center gap-3 mt-3.5 rounded-[14px] bg-card border border-hairline/10 px-3.5 py-3">
              <SafeShield />
              <div className="min-w-0">
                <div className="text-[13px] font-extrabold">Everything is saved</div>
                <div className="text-[11.5px] font-semibold text-fg/50 mt-px">Pick up exactly where you left off.</div>
              </div>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-[34px] font-black uppercase tracking-[-0.02em] leading-[0.92] mt-4 font-display">
              Subscription<br />ended
            </h1>
            <p className="text-[14.5px] font-semibold text-fg/60 mt-3 leading-snug">
              Resubscribe to pick up right where you left off. <span className="text-fg font-bold">Nothing&apos;s been deleted.</span>
            </p>
            <div className="flex items-center gap-3 mt-3.5 rounded-[14px] bg-card border border-hairline/10 px-3.5 py-3">
              <SafeShield />
              <div className="min-w-0">
                <div className="text-[13px] font-extrabold">Your history is safe</div>
                <div className="text-[11.5px] font-semibold text-fg/50 mt-px">Sessions, PRs and plans are all kept.</div>
              </div>
            </div>
          </>
        )}

        <div className="mt-3.5">
          <ProFeatures />
        </div>
        <div className="mt-4">
          <PlanSelector value={plan} onChange={setPlan} />
        </div>
      </div>

      {/* pinned footer */}
      <div className="shrink-0 px-5 pt-3.5 pb-8 bg-bg border-t border-hairline/[0.07]">
        <BlazeCta onClick={onSubscribe} disabled={busy}>
          {busy ? 'Opening checkout…' : ctaLabel(plan, mode === 'trial-ended' ? 'Subscribe' : 'Resubscribe')}
        </BlazeCta>
        <div className="text-center text-[11px] font-semibold text-fg/40 mt-2.5">
          {mode === 'trial-ended' ? 'Payment required to continue · cancel anytime · Stripe' : 'Billed in USD · cancel anytime · Stripe'}
        </div>
        <div className="flex items-center justify-center gap-3.5 mt-2.5">
          <button onClick={onRestore} disabled={restoring} className="inline-flex items-center gap-1 text-xs font-bold text-blaze-label py-1.5 disabled:opacity-50">
            <RefreshIcon size={13} className={restoring ? 'animate-spin' : ''} />
            {restoring ? 'Checking…' : 'I already subscribed'}
          </button>
          <span className="w-px h-3 bg-hairline/15" />
          <button onClick={() => setView('data')} className="text-xs font-semibold text-fg/60 py-1.5">Your data</button>
          <span className="w-px h-3 bg-hairline/15" />
          <button onClick={signOut} className="text-xs font-semibold text-fg/45 py-1.5">Sign out</button>
        </div>
      </div>
    </div>
  )
}
