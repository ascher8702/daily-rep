import type { ReactNode } from 'react'

/**
 * StatTile — a Charge/Blaze KPI tile: an oversized Archivo numeral over a muted label, on a carded
 * surface with a hairline border (mockup HTML ~177-182). The lead tile uses the blaze accent numeral;
 * the rest use plain foreground. Token-driven; reused on Today (3-up) and Progress (2×2).
 */
export interface StatTileProps {
  value: ReactNode
  label: string
  /** highlight the numeral in the blaze accent (the lead stat) */
  accent?: boolean
}

export function StatTile({ value, label, accent = false }: StatTileProps) {
  return (
    <div className="rounded-[18px] border border-hairline/[0.07] bg-card p-3.5">
      <div
        className={`font-display text-[24px] font-black leading-none tabular-nums ${
          accent ? 'text-blaze-warm' : 'text-fg'
        }`}
      >
        {value}
      </div>
      <div className="mt-[5px] text-[11px] text-fg/45">{label}</div>
    </div>
  )
}

export default StatTile
