'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useEntitlement } from '@/store/useEntitlement'
import { setAutoRenew, openBillingPortal, startCheckout, PRICING } from '@/lib/billing'
import { emitToast } from '@/lib/toast'
import { BackHeader, SectionLabel } from '@/components/settings/ui'
import { BoltMark, BlazeCta } from '@/components/billing/shared'
import { CardIcon, ChevronRight, LockIcon } from '@/components/icons'

function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      disabled={disabled}
      className={`relative w-12 h-[29px] rounded-full shrink-0 transition disabled:opacity-60 ${on ? 'bg-gradient-blaze shadow-button' : 'bg-raised border border-hairline/15'}`}
    >
      <span className={`absolute top-[3px] h-[23px] w-[23px] rounded-full transition-all ${on ? 'right-[3px] bg-white' : 'left-[3px] bg-fg/55'}`} />
    </button>
  )
}

/** "Turn off auto-renew?" bottom sheet — framed as reversible, not a scary cancel. */
function ConfirmSheet({ endDate, busy, onKeep, onTurnOff }: { endDate: string; busy: boolean; onKeep: () => void; onTurnOff: () => void }) {
  return (
    <div className="fixed inset-0 z-50 mx-auto max-w-md">
      <div className="absolute inset-0 bg-black/55" onClick={onKeep} />
      <div className="absolute left-0 right-0 bottom-0 bg-card rounded-t-[28px] border-t border-hairline/10 px-6 pt-3.5 pb-9 animate-slide-up">
        <div className="w-[38px] h-[5px] rounded-full bg-fg/20 mx-auto mb-5" />
        <div className="grid place-items-center h-14 w-14 rounded-2xl bg-[#fcd34d]/[0.12] border border-[#fcd34d]/30 text-[#fcd34d] mb-[18px]">
          <CardIcon size={26} strokeWidth={1.9} />
        </div>
        <div className="text-2xl font-black uppercase tracking-[-0.02em] leading-[0.95] font-display">Turn off auto-renew?</div>
        <p className="text-sm font-semibold text-fg/65 mt-3 leading-relaxed">
          You&apos;ll keep Daily Rep Pro until <span className="text-fg font-extrabold">{endDate}</span> — then it ends. You can turn it back on anytime before then, and your history stays safe.
        </p>
        <div className="mt-5"><BlazeCta onClick={onKeep} disabled={busy}>Keep auto-renew</BlazeCta></div>
        <button onClick={onTurnOff} disabled={busy} className="w-full mt-2.5 rounded-[14px] border border-[#fb7185]/40 bg-[#fb7185]/[0.06] text-[#fb7185] font-extrabold text-[15px] py-[15px] disabled:opacity-60">
          {busy ? 'Turning off…' : 'Turn off auto-renew'}
        </button>
      </div>
    </div>
  )
}

export default function MembershipPage() {
  const router = useRouter()
  const ent = useEntitlement()
  const refresh = useEntitlement((s) => s.refresh)
  const [busy, setBusy] = useState<string | null>(null)
  const [sheet, setSheet] = useState(false)

  // Billing dates include the year (a renewal can be a year out).
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
  const planLabel = ent.plan === 'monthly' ? 'Monthly' : 'Annual'
  const price = ent.plan ? PRICING[ent.plan] : PRICING.annual
  const autoRenew = ent.hasSubscription && !ent.cancelAtPeriodEnd
  const periodEnd = fmt(ent.currentPeriodEnd)

  const portal = async () => {
    setBusy('portal')
    const err = await openBillingPortal()
    if (err) { emitToast(err); setBusy(null) }
  }

  const applyAutoRenew = async (next: boolean) => {
    setBusy('toggle')
    const err = await setAutoRenew(next)
    setSheet(false)
    if (err) emitToast(err)
    else {
      await refresh()
      emitToast(next ? 'Auto-renew is back on.' : 'Auto-renew turned off — access stays until your period ends.')
    }
    setBusy(null)
  }

  const onToggle = () => {
    if (autoRenew) setSheet(true) // turning OFF → confirm
    else void applyAutoRenew(true) // turning ON → immediate
  }

  // ---- Upsell state (trialing / no live subscription) ----
  if (!ent.hasSubscription) {
    return (
      <div className="bg-bg min-h-[100dvh] text-fg animate-fade-in">
        <BackHeader title="Membership" />
        <div className="px-5 pt-3.5 pb-10">
          <div className="rounded-[18px] bg-card border border-blaze/30 p-4">
            <div className="flex items-center gap-3">
              <span className="grid place-items-center h-[38px] w-[38px] rounded-[11px] bg-gradient-blaze text-on-accent shrink-0"><BoltMark size={19} /></span>
              <div className="flex-1 min-w-0">
                <div className="text-base font-black">Daily Rep Pro</div>
                <div className="text-xs font-semibold text-fg/50">
                  {ent.inTrial ? `Free trial · ${ent.trialDaysLeft} day${ent.trialDaysLeft === 1 ? '' : 's'} left` : 'Subscribe to unlock everything'}
                </div>
              </div>
            </div>
            <div className="mt-4"><BlazeCta onClick={() => router.push('/subscribe')}>Subscribe</BlazeCta></div>
            <div className="text-center text-[11px] font-semibold text-fg/40 mt-2.5">{PRICING.annual.price}/yr · {PRICING.monthly.price}/mo · cancel anytime</div>
          </div>
        </div>
      </div>
    )
  }

  // ---- Active subscriber billing screen ----
  return (
    <div className="bg-bg min-h-[100dvh] text-fg animate-fade-in">
      <BackHeader title="Membership" />
      <div className="px-5 pt-3.5 pb-10">
        {ent.cancelAtPeriodEnd && (
          <div className="flex items-center gap-2.5 rounded-[14px] bg-[#fcd34d]/10 border border-[#fcd34d]/40 px-3.5 py-3 mb-3.5">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fcd34d" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>
            <span className="text-[13px] font-bold">Auto-renew is off — Pro ends <span className="text-[#fcd34d]">{periodEnd}</span>.</span>
          </div>
        )}

        {/* plan card */}
        <div className="rounded-[18px] bg-card border border-blaze/30 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="grid place-items-center h-[38px] w-[38px] rounded-[11px] bg-gradient-blaze text-on-accent"><BoltMark size={19} /></span>
              <div><div className="text-base font-black">Daily Rep Pro</div><div className="text-xs font-semibold text-fg/50">{planLabel} plan</div></div>
            </div>
            {ent.cancelAtPeriodEnd ? (
              <span className="text-[10.5px] font-extrabold uppercase tracking-[0.03em] text-[#fb7185] bg-[#fb7185]/[0.12] rounded-md px-2.5 py-1">Canceling</span>
            ) : (
              <span className="text-[10.5px] font-extrabold uppercase tracking-[0.03em] text-[#C6F24E] bg-[#C6F24E]/[0.12] rounded-md px-2.5 py-1">Active</span>
            )}
          </div>
          <div className="flex gap-2.5 mt-3.5">
            <div className="flex-1 bg-raised rounded-xl px-3.5 py-2.5">
              <div className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-fg/40">{ent.cancelAtPeriodEnd ? 'Access until' : 'Price'}</div>
              <div className="text-base font-black tabular-nums mt-0.5">{ent.cancelAtPeriodEnd ? periodEnd : <>{price.price}<span className="text-[11px] font-semibold text-fg/45">/{ent.plan === 'monthly' ? 'mo' : 'yr'}</span></>}</div>
            </div>
            <div className="flex-1 bg-raised rounded-xl px-3.5 py-2.5">
              <div className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-fg/40">{ent.cancelAtPeriodEnd ? 'Then' : 'Renews'}</div>
              <div className="text-base font-black mt-0.5">{ent.cancelAtPeriodEnd ? 'Ends' : periodEnd}</div>
            </div>
          </div>
        </div>

        {/* renewal toggle */}
        <SectionLabel className="mt-[22px] mb-2.5">Renewal</SectionLabel>
        <div className="rounded-2xl bg-card border border-hairline/10 px-4 py-3.5 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[14.5px] font-extrabold">Auto-renew</div>
            <div className="text-xs font-semibold text-fg/50 mt-0.5">
              {autoRenew ? `On — renews automatically on ${periodEnd}. Turn off anytime.` : `Off — Pro ends ${periodEnd}. Turn back on to keep it.`}
            </div>
          </div>
          <Toggle on={autoRenew} onClick={onToggle} disabled={busy === 'toggle'} />
        </div>
        {ent.cancelAtPeriodEnd && (
          <button onClick={() => applyAutoRenew(true)} disabled={busy === 'toggle'} className="w-full mt-3.5 rounded-[14px] bg-gradient-blaze text-on-accent font-black text-[15px] uppercase tracking-[0.03em] py-[15px] shadow-button-lg active:scale-[0.99] disabled:opacity-60 transition">
            {busy === 'toggle' ? 'Turning on…' : 'Turn auto-renew back on'}
          </button>
        )}

        {/* payment & plan → Stripe */}
        <SectionLabel className="mt-[22px] mb-2.5">Payment &amp; plan</SectionLabel>
        <div className="rounded-2xl bg-card border border-hairline/10 overflow-hidden">
          <button onClick={portal} disabled={!!busy} className="w-full flex items-center gap-3 px-[15px] py-3.5 text-left active:bg-raised/40">
            <span className="grid place-items-center h-[34px] w-[34px] rounded-[9px] bg-raised text-fg/60 shrink-0"><CardIcon size={17} strokeWidth={1.8} /></span>
            <div className="flex-1 min-w-0"><div className="text-sm font-bold">Payment method</div><div className="text-[11.5px] text-fg/40">Update your card</div></div>
            <span className="text-[12.5px] font-extrabold text-blaze-label">{busy === 'portal' ? '…' : 'Update'}</span>
          </button>
          <div className="h-px bg-hairline/[0.06] ml-[15px]" />
          <button onClick={portal} disabled={!!busy} className="w-full flex items-center justify-between px-[15px] py-3.5 text-left active:bg-raised/40">
            <div><div className="text-sm font-semibold">Change plan</div><div className="text-[11.5px] text-fg/40">Currently {planLabel}</div></div>
            <ChevronRight size={15} className="text-fg/35" />
          </button>
          <div className="h-px bg-hairline/[0.06] ml-[15px]" />
          <button onClick={portal} disabled={!!busy} className="w-full flex items-center justify-between px-[15px] py-3.5 text-left active:bg-raised/40">
            <div><div className="text-sm font-semibold">Billing history</div><div className="text-[11.5px] text-fg/40">Invoices &amp; receipts</div></div>
            <ChevronRight size={15} className="text-fg/35" />
          </button>
        </div>
        <div className="flex items-center justify-center gap-1.5 mt-3.5">
          <LockIcon size={13} className="text-fg/35" strokeWidth={2} />
          <span className="text-[11px] text-fg/40">Cards, invoices &amp; refunds handled securely by Stripe</span>
        </div>
      </div>

      {sheet && <ConfirmSheet endDate={periodEnd} busy={busy === 'toggle'} onKeep={() => setSheet(false)} onTurnOff={() => applyAutoRenew(false)} />}
    </div>
  )
}
