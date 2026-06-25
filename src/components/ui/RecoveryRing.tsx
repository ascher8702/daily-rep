import type { RecoveryTone } from '@/lib/recovery'

/**
 * RecoveryRing — the Charge/Blaze conic-gradient recovery donut: a ring filled to `pct`% in the
 * recovery-tier color (lime/amber/rose), an empty remainder track, a hollow center showing the big
 * numeral + tier label. Token-driven (the fill references `--color-<tone>`); recovery uses the lime
 * family per the design's "lime = recovery only" rule.
 */
export interface RecoveryRingProps {
  pct: number
  tone: RecoveryTone
  label: string
  size?: number
}

export function RecoveryRing({ pct, tone, label, size = 96 }: RecoveryRingProps) {
  const p = Math.max(0, Math.min(100, Math.round(pct)))
  const fill = `rgb(var(--color-${tone}))`
  return (
    <div
      role="img"
      aria-label={`Overall recovery ${p}% — ${label}`}
      className="relative shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(${fill} 0% ${p}%, rgb(var(--color-border) / 0.07) ${p}% 100%)`,
      }}
    >
      <div className="absolute inset-[9px] grid place-items-center rounded-full bg-card">
        <div className="text-center">
          <div className="font-display text-[26px] font-black leading-none" style={{ color: fill }}>
            {p}%
          </div>
          <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-fg/45">{label}</div>
        </div>
      </div>
    </div>
  )
}

export default RecoveryRing
