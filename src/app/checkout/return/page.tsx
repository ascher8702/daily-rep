'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useEntitlement } from '@/store/useEntitlement'
import { PRICING } from '@/lib/billing'
import { fmtDate } from '@/lib/format'
import { ProBrand, BlazeCta } from '@/components/billing/shared'
import { ClockIcon, RefreshIcon, CardIcon } from '@/components/icons'

const SUPPORT = 'mailto:support@dailyrep.app'

function Spinner({ color = '#FF8a4e', track = 'rgba(255,122,30,0.16)' }: { color?: string; track?: string }) {
  return (
    <div className="relative h-[84px] w-[84px] rounded-full" style={{ background: `conic-gradient(${color} 0% 72%, ${track} 72% 100%)` }}>
      <div className="absolute inset-[9px] rounded-full bg-bg grid place-items-center" style={{ color }}>
        <RefreshIcon size={30} className="animate-spin" strokeWidth={1.8} />
      </div>
    </div>
  )
}

/** "Confirming subscription" — bridges the async webhook gap after a successful checkout. */
function Confirming() {
  return (
    <div className="h-[100dvh] flex flex-col bg-bg text-fg px-5 pt-14 pb-10 animate-fade-in">
      <div className="flex items-center justify-center gap-2.5">
        <ProBrand />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <Spinner />
        <div className="text-[22px] font-black uppercase tracking-tight mt-6 font-display">Confirming your subscription</div>
        <p className="text-[13.5px] font-semibold text-fg/55 mt-2 leading-relaxed max-w-[280px]">
          We&apos;re finalizing your payment with Stripe. This updates on its own — no need to refresh.
        </p>
        <div className="w-full mt-6 rounded-2xl bg-card border border-hairline/10 px-3.5">
          <Step done label="Payment received" />
          <Step active label="Activating Pro…" />
          <Step label="You're in" />
        </div>
      </div>
      <div className="text-center">
        <div className="text-[12.5px] text-fg/50">Taking a while? <button onClick={() => useEntitlement.getState().refresh()} className="text-blaze-label font-bold">Refresh status</button></div>
        <div className="text-[11.5px] text-fg/35 mt-2">Charged but still stuck? <a href={SUPPORT} className="text-fg/60 font-semibold">Contact support</a></div>
      </div>
    </div>
  )
}

function Step({ label, done, active }: { label: string; done?: boolean; active?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 py-2.5 ${done || active ? 'border-b border-hairline/[0.06]' : ''}`}>
      {done ? (
        <span className="grid place-items-center h-6 w-6 rounded-full bg-[#C6F24E]/[0.14] text-[#C6F24E]">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        </span>
      ) : active ? (
        <span className="grid place-items-center h-6 w-6 rounded-full bg-blaze/[0.16] text-blaze-label"><RefreshIcon size={13} className="animate-spin" strokeWidth={2.2} /></span>
      ) : (
        <span className="h-6 w-6 rounded-full border-[1.5px] border-hairline/16 shrink-0" />
      )}
      <span className={`text-[13px] font-bold ${done ? 'text-fg/85' : active ? 'text-fg' : 'text-fg/40 font-semibold'}`}>{label}</span>
    </div>
  )
}

/** "Welcome to Pro" — entitlement confirmed. */
function Welcome() {
  const router = useRouter()
  const plan = useEntitlement((s) => s.plan)
  const status = useEntitlement((s) => s.status)
  const currentPeriodEnd = useEntitlement((s) => s.currentPeriodEnd)
  const p = plan ? PRICING[plan] : PRICING.annual
  const end = currentPeriodEnd ? fmtDate(new Date(currentPeriodEnd).getTime()) : null

  return (
    <div className="h-[100dvh] flex flex-col bg-bg text-fg animate-fade-in">
      <div className="bg-gradient-blaze px-6 pt-20 pb-8 text-center">
        <div className="inline-grid place-items-center h-[84px] w-[84px] rounded-3xl bg-[#180a04] shadow-button-lg">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#FF7A1E" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        </div>
        <div className="text-[38px] font-black uppercase tracking-[-0.02em] text-on-accent mt-4 leading-[0.9] font-display">You&apos;re Pro</div>
        <div className="text-[12.5px] font-extrabold tracking-[0.06em] uppercase text-on-accent/60 mt-2.5">Everything is unlocked</div>
      </div>
      <div className="flex-1 bg-bg rounded-t-[26px] -mt-5 px-5 pt-6 pb-8 flex flex-col">
        <div className="rounded-2xl bg-card border border-hairline/10 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-fg/45">Your plan</span>
            <span className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-[#C6F24E] bg-[#C6F24E]/[0.12] rounded-md px-2.5 py-1">Active</span>
          </div>
          <div className="flex items-baseline justify-between mt-3">
            <span className="text-[22px] font-black">{p.label}</span>
            <span className="text-[15px] font-extrabold tabular-nums text-fg/80">{p.price}<span className="text-xs font-semibold text-fg/45">/{plan === 'monthly' ? 'mo' : 'yr'}</span></span>
          </div>
          <div className="h-px bg-hairline/[0.07] my-3.5" />
          {end && (
            <div className="flex items-center gap-2.5">
              <ClockIcon size={16} className="text-blaze-label shrink-0" strokeWidth={1.9} />
              <span className="text-[13px] font-semibold text-fg/75">
                {status === 'trialing' ? <>Free until <span className="font-extrabold text-fg">{end}</span> — then billed {plan === 'monthly' ? 'monthly' : 'yearly'}.</> : <>Renews <span className="font-extrabold text-fg">{end}</span>.</>}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2.5 mt-2.5">
            <RefreshIcon size={16} className="text-fg/55 shrink-0" strokeWidth={1.9} />
            <span className="text-[13px] font-semibold text-fg/60">Renews automatically · cancel anytime in Settings.</span>
          </div>
        </div>
        <div className="mt-auto pt-6">
          <BlazeCta onClick={() => router.replace('/')}>Start training</BlazeCta>
          <div className="text-center text-xs text-fg/50 mt-3">Manage membership in <button onClick={() => router.replace('/settings/membership')} className="text-blaze-label font-bold">Settings</button></div>
        </div>
      </div>
    </div>
  )
}

/** "Payment didn't go through" — declined / canceled checkout (NOT a lapsed subscription). */
function PaymentFailed() {
  const router = useRouter()
  return (
    <div className="h-[100dvh] flex flex-col bg-bg text-fg px-5 pt-14 pb-10 animate-fade-in">
      <div className="flex items-center justify-center"><ProBrand /></div>
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className="grid place-items-center h-20 w-20 rounded-[22px] bg-[#fcd34d]/[0.12] border border-[#fcd34d]/35 text-[#fcd34d]">
          <CardIcon size={40} strokeWidth={1.9} />
        </div>
        <div className="text-[27px] font-black uppercase tracking-[-0.02em] mt-5 leading-[0.95] font-display">Payment didn&apos;t<br />go through</div>
        <p className="text-[13.5px] font-semibold text-fg/60 mt-2.5 leading-relaxed max-w-[290px]">
          Your card was declined or the checkout was canceled. <span className="text-fg font-bold">You haven&apos;t been charged.</span>
        </p>
        <div className="w-full mt-5 rounded-[14px] bg-card border border-hairline/10 px-4 py-3.5 text-left">
          <div className="text-[11px] font-extrabold tracking-[0.1em] uppercase text-fg/40 mb-2">Common fixes</div>
          <div className="text-[12.5px] font-semibold text-fg/65 leading-relaxed">Check the card number &amp; expiry · confirm available funds · or try a different card.</div>
        </div>
      </div>
      <div>
        <BlazeCta onClick={() => router.replace('/subscribe')}>Try again</BlazeCta>
        <div className="text-center text-[12.5px] text-fg/50 mt-3">Still stuck? <a href={SUPPORT} className="text-blaze-label font-bold">Contact support</a></div>
      </div>
    </div>
  )
}

/** Checkout return handler — Stripe success/cancel land here. */
export default function CheckoutReturnPage() {
  const router = useRouter()
  const refresh = useEntitlement((s) => s.refresh)
  const [phase, setPhase] = useState<'confirming' | 'welcome' | 'failed'>('confirming')
  const hasSubscription = useEntitlement((s) => s.hasSubscription)
  const started = useRef(false)

  // Single source of truth for "we're in": the moment entitlement resolves to a live sub, show the
  // welcome — no matter HOW it resolved (poll tick, the manual "Refresh status" button, or the store's
  // own focus/visibility refetch). This is what un-strands a user after the ~30s poll has given up.
  useEffect(() => {
    if (hasSubscription) setPhase('welcome')
  }, [hasSubscription])

  useEffect(() => {
    if (started.current) return
    started.current = true
    const status = new URLSearchParams(window.location.search).get('status')
    let cancelled = false
    let tries = 0
    const tick = async () => {
      await refresh()
      if (cancelled) return
      if (useEntitlement.getState().hasSubscription) return // → welcome via the watcher effect above
      // A canceled checkout can still belong to an already-entitled user (e.g. they backed out of an
      // early-subscribe but their trial/sub is live). Only show "payment failed" when truly not entitled.
      if (status === 'cancel') {
        setPhase('failed')
        return
      }
      if (++tries < 15) setTimeout(tick, 2000) // ~30s, then stay on confirming with the manual refresh
    }
    void tick()
    return () => {
      cancelled = true
    }
  }, [refresh])

  if (phase === 'welcome') return <Welcome />
  if (phase === 'failed') return <PaymentFailed />
  return <Confirming />
}
