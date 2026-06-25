import type { ReactNode } from 'react'
import { Button } from './Button'

/**
 * BlazeHeroCard — the flagship Today hero from the Charge/Blaze design: a hot-orange gradient card
 * (eyebrow + optional "Switch" badge, oversized Archivo display title, meta line, dark-on-orange status
 * chips) sitting on a nested dark section that holds either a numbered exercise list (focus lift
 * highlighted) or a short description, plus the primary CTA and an optional low-emphasis footer action.
 *
 * Token-driven (no hard-coded hex); composes the Button primitive for the CTA. One component backs all
 * three Today states (in-progress session / plan day / nothing-built-yet) — callers just compute props.
 */

export interface HeroChip {
  label: string
  icon?: ReactNode
}

export interface HeroExercise {
  name: string
  detail: string
  /** the focus lift — rendered with the orange badge + "Focus lift" eyebrow */
  focus?: boolean
}

export interface BlazeHeroCardProps {
  eyebrow: string
  title: string
  meta?: string
  chips?: HeroChip[]
  /** when set, renders a tappable "Switch" badge top-right (swap today's workout) */
  onSwitch?: () => void
  switchLabel?: string
  /** nested dark section: numbered exercise rows (focus row highlighted) */
  exercises?: HeroExercise[]
  /** "+N more" affordance below a capped exercise list */
  extraCount?: number
  /** tap handler for an exercise row / the "+N more" row (usually → the session) */
  onExerciseClick?: () => void
  /** shown in the dark section when there are no exercises (the not-yet-built state) */
  description?: string
  cta: { label: string; onClick: () => void; icon?: ReactNode }
  /** low-emphasis action under the CTA (e.g. Discard / Skip) */
  footer?: ReactNode
}

// dark-on-orange status chip (matches the design's rgba(0,0,0,0.14) pills)
const CHIP =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-black/[0.14] px-[11px] py-[7px] ' +
  'text-[11px] font-extrabold uppercase tracking-[0.04em] text-on-accent'

export function BlazeHeroCard({
  eyebrow,
  title,
  meta,
  chips,
  onSwitch,
  switchLabel = 'Switch',
  exercises = [],
  extraCount = 0,
  onExerciseClick,
  description,
  cta,
  footer,
}: BlazeHeroCardProps) {
  const hasList = exercises.length > 0
  return (
    <section className="overflow-hidden rounded-hero bg-gradient-blaze shadow-hero">
      {/* orange header */}
      <div className="px-5 pb-4 pt-[18px]">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-on-accent/60">{eyebrow}</div>
          {onSwitch && (
            <button
              onClick={onSwitch}
              className="shrink-0 rounded-lg bg-black/[0.14] px-2.5 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.04em] text-on-accent transition active:scale-95"
            >
              {switchLabel}
            </button>
          )}
        </div>
        <h2 className="mt-1.5 font-display text-[34px] font-black uppercase leading-[0.9] tracking-[-0.02em] text-on-accent">
          {title}
        </h2>
        {meta && (
          <div className="mt-2 text-[12.5px] font-bold uppercase tracking-[0.02em] text-on-accent/60">{meta}</div>
        )}
        {chips && chips.length > 0 && (
          <div className="mt-3.5 flex flex-wrap gap-2">
            {chips.map((c, i) => (
              <span key={i} className={CHIP}>
                {c.icon}
                {c.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* nested dark section */}
      <div className="rounded-t-hero bg-bg px-[18px] pb-[18px] pt-3.5">
        {hasList ? (
          <div className="mb-1">
            {exercises.map((ex, i) => (
              <button
                key={i}
                onClick={onExerciseClick}
                className={`flex w-full items-center gap-3 py-2.5 text-left ${
                  i > 0 ? 'border-t border-hairline/[0.08]' : ''
                }`}
              >
                <span
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-[11px] text-[15px] font-extrabold tabular-nums ${
                    ex.focus ? 'bg-gradient-blaze text-on-accent' : 'bg-raised text-fg/45'
                  }`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  {ex.focus && (
                    <div className="text-[9.5px] font-extrabold uppercase tracking-[0.1em] text-blaze-label">
                      Focus lift
                    </div>
                  )}
                  <div className="truncate text-base font-extrabold uppercase leading-tight tracking-[-0.01em]">
                    {ex.name}
                  </div>
                  <div className="truncate text-xs font-semibold text-fg/50">{ex.detail}</div>
                </div>
              </button>
            ))}
            {extraCount > 0 && (
              <button
                onClick={onExerciseClick}
                className="w-full px-1 py-2 text-left text-xs font-semibold text-fg/40 transition active:text-fg/70"
              >
                +{extraCount} more exercise{extraCount === 1 ? '' : 's'}
              </button>
            )}
          </div>
        ) : description ? (
          <p className="mb-1 text-[15px] leading-snug text-fg/55">{description}</p>
        ) : null}

        <Button
          onClick={cta.onClick}
          size="lg"
          fullWidth
          className={hasList || description ? 'mt-3.5' : undefined}
        >
          {cta.icon}
          {cta.label}
        </Button>
        {footer}
      </div>
    </section>
  )
}

export default BlazeHeroCard
