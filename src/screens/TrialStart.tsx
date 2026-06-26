'use client'

import { useState } from 'react'
import { useEntitlement } from '@/store/useEntitlement'
import { startCheckout, PRICING, type PlanId } from '@/lib/billing'
import { emitToast } from '@/lib/toast'
import { ProBrand, ProFeatures, PlanSelector, BlazeCta } from '@/components/billing/shared'
import { BellIcon, CardIcon, XIcon } from '@/components/icons'

/** CTA label for the early-subscribe (in-trial) context — mirrors the paywall's "Subscribe — $/yr". */
function subscribeCtaLabel(plan: PlanId) {
  return `Subscribe — ${PRICING[plan].price}/${plan === 'annual' ? 'yr' : 'mo'}`
}

function Check({ size = 16, color = '#1a0a04', width = 2.6 }: { size?: number; color?: string; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

/** The 3-step "how your free trial works" timeline (Today → Day 28 → Day 30). */
function TrialTimeline({ plan }: { plan: PlanId }) {
  const dot = 'relative z-[1] flex flex-col items-center text-center'
  return (
    <div>
      <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-blaze-label mb-2.5">How your free trial works</div>
      <div className="rounded-2xl bg-card border border-hairline/10 px-2.5 py-4">
        <div className="relative grid grid-cols-3 gap-1">
          <div className="absolute left-[18%] right-[18%] top-[17px] h-0.5 bg-gradient-to-r from-blaze to-hairline/20 z-0" />
          <div className={dot}>
            <span className="grid place-items-center h-[34px] w-[34px] rounded-full bg-gradient-blaze text-on-accent shadow-button"><Check /></span>
            <div className="text-[10px] font-extrabold tracking-[0.08em] uppercase text-blaze-label mt-2.5">Today</div>
            <div className="text-[10.5px] font-semibold text-fg/50 mt-1 leading-tight">Full access.<br />$0 charged.</div>
          </div>
          <div className={dot}>
            <span className="grid place-items-center h-[34px] w-[34px] rounded-full bg-raised border border-hairline/10 text-fg/60"><BellIcon size={16} strokeWidth={1.9} /></span>
            <div className="text-[10px] font-extrabold tracking-[0.08em] uppercase text-fg/50 mt-2.5">Day 28</div>
            <div className="text-[10.5px] font-semibold text-fg/50 mt-1 leading-tight">We send a<br />reminder.</div>
          </div>
          <div className={dot}>
            <span className="grid place-items-center h-[34px] w-[34px] rounded-full bg-raised border border-hairline/10 text-fg/60"><CardIcon size={16} strokeWidth={1.9} /></span>
            <div className="text-[10px] font-extrabold tracking-[0.08em] uppercase text-fg/50 mt-2.5">Day 30</div>
            <div className="text-[10.5px] font-semibold text-fg/50 mt-1 leading-tight">Plan begins,<br />billed {plan === 'annual' ? 'yearly' : 'monthly'}.</div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Mode 1 — the card-free, value-forward trial start. Two contexts:
 *  - welcome   — one-time after onboarding; the CTA enters the app (trial is already active, no card).
 *  - subscribe — reached from the trial banner / settings to lock in a plan early; the CTA opens Stripe
 *    Checkout, which carries the remaining trial forward (still $0 today, billed at day 30).
 */
export default function TrialStart({
  context = 'welcome',
  onDone,
  onClose,
}: {
  context?: 'welcome' | 'subscribe'
  onDone?: () => void
  onClose?: () => void
}) {
  const refresh = useEntitlement((s) => s.refresh)
  const [plan, setPlan] = useState<PlanId>('annual')
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const onPrimary = async () => {
    if (context === 'welcome') {
      onDone?.()
      return
    }
    setBusy(true)
    const err = await startCheckout(plan)
    if (err) {
      emitToast(err)
      setBusy(false)
    }
  }

  const onRestore = async () => {
    setRestoring(true)
    // poll with backoff (like the paywall) — a just-completed payment's webhook can lag a few seconds,
    // so a single refresh would falsely report "no subscription found".
    let found = false
    for (let i = 0; i < 5; i++) {
      await refresh()
      found = useEntitlement.getState().hasSubscription
      if (found) break
      if (i < 4) await new Promise((r) => setTimeout(r, 2000))
    }
    setRestoring(false)
    if (!found) emitToast('No active subscription found yet. If you just paid, give it a moment.')
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-bg text-fg animate-fade-in">
      <div className="flex-1 overflow-y-auto safe-top px-5 pt-12 pb-3.5">
        <div className="flex items-start justify-between">
          <ProBrand />
          {onClose && (
            <button onClick={onClose} aria-label="Close" className="grid place-items-center h-8 w-8 rounded-full bg-raised text-fg/60 -mt-1">
              <XIcon size={16} strokeWidth={2.2} />
            </button>
          )}
        </div>

        {context === 'welcome' ? (
          <>
            <h1 className="text-[48px] font-black uppercase tracking-[-0.03em] leading-[0.88] mt-4 font-display">
              30 Days<br />Free
            </h1>
            <p className="text-[14.5px] font-semibold text-fg/60 mt-2.5 leading-snug">
              Full access to every workout, plan and stat. <span className="text-fg font-bold">No payment due today.</span>
            </p>
          </>
        ) : (
          <>
            <h1 className="text-[44px] font-black uppercase tracking-[-0.03em] leading-[0.9] mt-4 font-display">
              Subscribe<br />to Pro
            </h1>
            <p className="text-[14.5px] font-semibold text-fg/60 mt-2.5 leading-snug">
              Lock in your plan now — your free trial keeps running, with <span className="text-fg font-bold">no payment due today.</span>
            </p>
          </>
        )}

        <div className="inline-flex items-center gap-1.5 mt-3.5 rounded-full bg-card border border-hairline/10 px-3 py-[7px]">
          <Check size={14} color="#FF8a4e" width={2.6} />
          <span className="text-xs font-bold text-fg/80">
            {context === 'welcome' ? 'No card required to start' : '$0 due now · cancel anytime'}
          </span>
        </div>

        <div className="mt-[18px]"><ProFeatures /></div>
        <div className="mt-[15px]"><TrialTimeline plan={plan} /></div>
        <div className="mt-4"><PlanSelector value={plan} onChange={setPlan} /></div>
      </div>

      <div className="shrink-0 px-5 pt-3.5 pb-8 bg-bg border-t border-hairline/[0.07]">
        <BlazeCta onClick={onPrimary} disabled={busy}>
          {busy ? 'Opening checkout…' : context === 'welcome' ? 'Start my free trial' : subscribeCtaLabel(plan)}
        </BlazeCta>
        <div className="text-center text-[11px] font-semibold text-fg/40 mt-2.5">
          $0 today · then {PRICING[plan].price}/{plan === 'annual' ? 'yr' : 'mo'} · cancel anytime
        </div>
        <div className="text-center text-xs text-fg/50 mt-2.5">
          Already a member?{' '}
          <button onClick={onRestore} disabled={restoring} className="text-blaze-label font-bold disabled:opacity-50">
            {restoring ? 'Checking…' : 'Restore'}
          </button>
        </div>
      </div>
    </div>
  )
}
