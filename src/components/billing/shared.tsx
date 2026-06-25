'use client'

import { PRICING, type PlanId } from '@/lib/billing'

/**
 * Shared Blaze billing primitives used across the paywall, trial-start, checkout and billing screens.
 * These deliberately use the FIXED Blaze orange identity (gradient-blaze / on-accent / blaze-label) and
 * the dark surface tokens (bg / card / raised / hairline) — not the user's themable accent — so every
 * billing surface matches the mockups regardless of the chosen accent.
 */

export const PRO_FEATURES = [
  'Recovery-aware workouts, rebuilt for you daily',
  'Progress analytics, PRs and volume trends',
  'Custom plan builder and the full plan library',
  'Cloud sync across all your devices',
]

/** The Daily Rep "charge bolt" brand mark. */
export function BoltMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <path d="M58 8 L28 54 H46 L42 92 L74 42 H54 Z" fill="currentColor" />
    </svg>
  )
}

function Check({ size = 12, width = 3.2 }: { size?: number; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

/** Brand row: gradient bolt tile + "DAILY REP PRO" eyebrow. `icon` swaps the bolt for e.g. a lock. */
export function ProBrand({ icon }: { icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid place-items-center h-[34px] w-[34px] rounded-[10px] bg-gradient-blaze text-on-accent shadow-button">
        {icon ?? <BoltMark size={18} />}
      </span>
      <span className="text-[11px] font-extrabold tracking-[0.14em] uppercase text-blaze-label">Daily Rep Pro</span>
    </div>
  )
}

/** "Everything in Pro" feature card. */
export function ProFeatures() {
  return (
    <div className="rounded-2xl bg-card border border-hairline/10 p-4">
      <div className="text-[11px] font-extrabold tracking-[0.12em] uppercase text-fg/40 mb-3">Everything in Pro</div>
      <div className="flex flex-col gap-3">
        {PRO_FEATURES.map((f) => (
          <div key={f} className="flex items-start gap-3">
            <span className="grid place-items-center h-[21px] w-[21px] rounded-[7px] bg-gradient-blaze text-on-accent shrink-0 mt-px">
              <Check />
            </span>
            <span className="text-[13.5px] font-semibold text-fg/85 leading-snug">{f}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Annual / monthly plan selector. Controlled via `value` / `onChange`. */
export function PlanSelector({ value, onChange }: { value: PlanId; onChange: (p: PlanId) => void }) {
  return (
    <div className="flex flex-col gap-2.5" role="radiogroup" aria-label="Choose a plan">
      {(['annual', 'monthly'] as PlanId[]).map((id) => {
        const p = PRICING[id]
        const active = value === id
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(id)}
            className={`relative w-full text-left rounded-2xl px-4 py-3.5 flex items-center gap-3 border transition ${
              active ? 'border-blaze/55 bg-blaze/[0.08]' : 'border-hairline/10 bg-card'
            }`}
          >
            <span
              className={`grid place-items-center h-[22px] w-[22px] rounded-full shrink-0 ${
                active ? 'bg-gradient-blaze text-on-accent' : 'border-2 border-hairline/25 text-transparent'
              }`}
            >
              {active && <Check size={12} width={3.4} />}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-extrabold">{p.label}</div>
              <div className="text-xs font-semibold text-fg/50 mt-px">{p.note}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-lg font-black tabular-nums tracking-tight">{p.price}</div>
              <div className="text-[11.5px] font-semibold text-fg/45">{p.cadence.replace('/', '/ ')}</div>
            </div>
            {p.badge && (
              <span className="absolute -top-[9px] right-3.5 text-[10px] font-black tracking-[0.05em] uppercase text-on-accent bg-gradient-blaze rounded-full px-2.5 py-[3px] shadow-button">
                {p.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Full-screen blaze gradient CTA used in every billing footer. */
export function BlazeCta({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-[14px] bg-gradient-blaze text-on-accent font-black text-base uppercase tracking-[0.03em] py-4 shadow-button-lg active:scale-[0.99] disabled:opacity-60 transition"
    >
      {children}
    </button>
  )
}
