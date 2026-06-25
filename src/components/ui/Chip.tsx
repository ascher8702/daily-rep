import type { ReactNode, ButtonHTMLAttributes } from 'react'
import { cx } from './Button'

/**
 * Chip — the Charge/Blaze pill primitive. Two shapes share one token-driven variant palette:
 *  - `Chip` (interactive filter button): selected → orange gradient fill, else neutral raised. Folds the
 *    a11y aria (`aria-pressed` + a label that announces the selected state).
 *  - `ChipTag` (non-interactive label, e.g. an exercise's "Compound"/"Barbell" tag): pick a variant.
 *
 * Variants (token-driven, no hard-coded hex): `solid` orange fill · `accent` orange tint · `recovery`
 * lime tint (recovery/health only) · `neutral` raised surface.
 */

export type ChipVariant = 'solid' | 'accent' | 'recovery' | 'neutral'

export const CHIP_VARIANT: Record<ChipVariant, string> = {
  solid: 'bg-gradient-blaze text-on-accent',
  accent: 'bg-blaze/[0.12] border border-blaze/30 text-blaze-label',
  recovery: 'bg-recovery-fresh/10 border border-recovery-fresh/[0.28] text-recovery-fresh',
  neutral: 'bg-raised border border-hairline/[0.08] text-fg/70',
}

/** Pure variant → classes (exported for unit testing the token mapping). */
export function chipClass(variant: ChipVariant): string {
  return CHIP_VARIANT[variant]
}

const FILTER_BASE =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3.5 py-[7px] text-[12px] font-extrabold transition active:scale-95 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blaze focus-visible:ring-offset-2 focus-visible:ring-offset-bg'

const TAG_BASE = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold'

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children: ReactNode
  /** filter selected → orange gradient fill */
  selected?: boolean
  /** plain-text label for the accessible name; the selected state is appended automatically */
  label?: string
}

/** Interactive filter chip (button). */
export function Chip({ children, selected = false, label, className, type = 'button', ...rest }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      aria-label={label ? `${label} filter${selected ? ', selected' : ''}` : undefined}
      className={cx(FILTER_BASE, selected ? CHIP_VARIANT.solid : CHIP_VARIANT.neutral, className)}
      {...rest}
    >
      {children}
    </button>
  )
}

/** Non-interactive tag/label chip (span). */
export function ChipTag({
  children,
  variant = 'neutral',
  className,
}: {
  children: ReactNode
  variant?: ChipVariant
  className?: string
}) {
  return <span className={cx(TAG_BASE, CHIP_VARIANT[variant], className)}>{children}</span>
}

export default Chip
