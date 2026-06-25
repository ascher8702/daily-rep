import type { RecoveryTone } from '@/lib/recovery'

/**
 * RecoveryBar — a labeled horizontal recovery meter (Charge/Blaze): a fixed-width label, a rounded
 * track on the raised surface, and a fill to `pct`% in the recovery-tier token color. Used for the
 * Today region breakdown (Push/Pull/Legs/Core) and reusable for Progress muscle-balance. Token-driven.
 */
export interface RecoveryBarProps {
  label: string
  pct: number
  tone: RecoveryTone
  /** label column width in px (default 48 — matches the Today recovery card) */
  labelWidth?: number
}

export function RecoveryBar({ label, pct, tone, labelWidth = 48 }: RecoveryBarProps) {
  const p = Math.max(0, Math.min(100, Math.round(pct)))
  return (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0 text-xs text-fg/60" style={{ width: labelWidth }}>
        {label}
      </span>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised"
        role="img"
        aria-label={`${label} recovery ${p}%`}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${p}%`, background: `rgb(var(--color-${tone}))` }}
        />
      </div>
    </div>
  )
}

export default RecoveryBar
