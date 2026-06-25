import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'

/**
 * Button — the canonical action control for the Charge/Blaze design system.
 *
 * Token-driven (no hard-coded colors): the `primary` variant is the hot-orange Blaze action identity
 * (`bg-gradient-blaze` + near-black `on-accent` text + `shadow-button`, uppercase 900). `secondary` is a
 * neutral raised surface; `ghost` is low-emphasis/transparent. Replaces the legacy `.btn-*` classes as
 * call sites migrate, screen by screen (the `.btn-*` classes remain for not-yet-migrated screens).
 *
 * The class math lives in the pure, exported `buttonClasses()` so variant/size mapping is unit-testable
 * without a DOM (vitest runs in node here).
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** stretch to the container width (replaces the ad-hoc `w-full` on legacy `.btn-*` call sites) */
  fullWidth?: boolean
}

/** Join truthy class fragments (tiny local clsx, no dep). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

// no font-weight in BASE — each variant sets its own so it can't be overridden by cascade order
const BASE =
  'inline-flex items-center justify-center gap-2 rounded-blaze transition ' +
  'active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 select-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blaze ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-bg'

const VARIANT: Record<ButtonVariant, string> = {
  // hot-orange gradient action — the flagship Blaze identity; near-black text for AA on the fill.
  // font-display (Archivo) matches the mockup's CTA type (the device frame renders buttons in Archivo).
  primary: 'bg-gradient-blaze text-on-accent shadow-button font-display font-black uppercase tracking-[0.03em]',
  // neutral raised surface with a hairline edge
  secondary: 'bg-raised text-fg border border-hairline/10 font-semibold',
  // low-emphasis, transparent
  ghost: 'bg-transparent text-fg/80 active:text-fg font-semibold',
}

const SIZE: Record<ButtonSize, string> = {
  lg: 'px-6 py-4 text-[17px]',
  md: 'px-5 py-3.5 text-[15px]',
  sm: 'px-3 py-2 text-sm',
}

/** Pure class composition for a Button — exported for unit testing the variant/size/width mapping. */
export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  fullWidth = false,
  className?: string,
): string {
  return cx(BASE, VARIANT[variant], SIZE[size], fullWidth && 'w-full', className)
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', fullWidth = false, type = 'button', className, ...props },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClasses(variant, size, fullWidth, className)} {...props} />
  )
})

export default Button
