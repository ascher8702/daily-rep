'use client'

import { useState } from 'react'
import type { Exercise, LoggedSet } from '@/types'
import { fmtWeight } from '@/lib/format'
import { nextLoadableUp, prevLoadableDown, plateLoad } from '@/lib/weights'
import { CheckIcon, TrashIcon, HistoryIcon } from '@/components/icons'
import Sheet from '@/components/Sheet'

/** Tiny barbell-end glyph (three plates of varying height) for the plate-math affordance. */
function PlateGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden className="opacity-70 shrink-0">
      <rect x="2" y="3.5" width="2.4" height="9" rx="1" />
      <rect x="6.3" y="1.5" width="2.4" height="13" rx="1" />
      <rect x="10.6" y="5" width="2.4" height="6" rx="1" />
    </svg>
  )
}

interface SetRowProps {
  set: LoggedSet
  label: string
  unit: 'lb' | 'kg'
  isBodyweight: boolean
  /** the exercise, for weight steppers that snap to its loadable increment */
  ex?: Exercise | null
  /** dom id on the row wrapper, so a parent can scroll the next undone set into view */
  domId?: string
  lastRef: { weight: number; reps: number } | null
  onApplyLast?: () => void
  onWeight: (weight: number) => void
  onReps: (reps: number) => void
  onToggle: () => void
  onRemove: () => void
  /** set/clear the optional RPE (rate of perceived exertion) on a completed working set */
  onRpe?: (rpe: number | undefined) => void
}

/** RPE scale offered after a working set (6–10; RPE 10 = no reps left, 8 ≈ 2 in reserve). */
const RPE_OPTIONS = [6, 7, 8, 9, 10]

/** One editable set row (weight / reps / done) with +/- steppers and an optional tap-to-apply
 *  "last time" reference. Shared by the per-exercise detail page and the inline session-list editor. */
export function SetRow({ set, label, unit, isBodyweight, ex, domId, lastRef, onApplyLast, onWeight, onReps, onToggle, onRemove, onRpe }: SetRowProps) {
  const isWarmup = !!set.warmup
  // plate math: non-null only for barbell lifts with a load entered → drives the optional plate sub-line
  const [platesOpen, setPlatesOpen] = useState(false)
  const plates = ex && set.weight > 0 ? plateLoad(set.weight, ex, unit) : null
  // completing a set gives a light haptic tap; the check button pops via animate-pop on the done state
  const handleToggle = () => {
    if (!set.done && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(10)
    }
    onToggle()
  }
  // weight steps snap to the exercise's smallest loadable jump (plates/dumbbells); fall back to a
  // gym increment for added-bodyweight / unknown exercises. Reps step by 1, floored at 0.
  const stepWeight = (dir: 1 | -1) => {
    if (ex) onWeight(dir > 0 ? nextLoadableUp(set.weight, ex, unit) : prevLoadableDown(set.weight, ex, unit))
    else onWeight(Math.max(0, Math.round((set.weight + dir * (unit === 'kg' ? 2.5 : 5)) * 10) / 10))
  }
  const stepReps = (dir: 1 | -1) => onReps(Math.max(0, set.reps + dir))
  const refText = lastRef
    ? isBodyweight || lastRef.weight === 0
      ? `${lastRef.reps} reps`
      : `${fmtWeight(lastRef.weight, unit)} × ${lastRef.reps}`
    : null
  return (
    <div id={domId} className={`rounded-xl transition scroll-mt-24 ${set.done ? 'bg-recovery-fresh/[0.08]' : ''}`}>
    <div className="group grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_4.25rem] items-center gap-1.5 px-2 py-1.5">
      <div className="flex justify-center">
        {isWarmup ? (
          <span className="grid place-items-center h-7 w-7 rounded-lg bg-recovery-moderate/15 text-recovery-moderate text-xs font-bold">W</span>
        ) : (
          <span className="grid place-items-center h-7 w-7 rounded-lg bg-raised text-fg/70 text-sm font-bold tabular-nums">
            {label}
          </span>
        )}
      </div>
      <NumberField
        value={set.weight}
        ariaLabel={`Weight in ${unit}`}
        onChange={onWeight}
        onStep={stepWeight}
        placeholder={lastRef && lastRef.weight > 0 ? String(lastRef.weight) : '0'}
      />
      <NumberField
        value={set.reps}
        ariaLabel="Reps"
        onChange={onReps}
        onStep={stepReps}
        integer
        placeholder={lastRef ? String(lastRef.reps) : '0'}
      />
      <div className="flex items-center justify-center gap-1.5">
        <button
          onClick={handleToggle}
          aria-label={set.done ? 'Mark set not done' : 'Mark set done'}
          className={`grid place-items-center h-9 w-9 rounded-full border transition active:scale-90 ${
            set.done ? 'bg-recovery-fresh border-recovery-fresh text-bg animate-pop' : 'border-fg/25 text-transparent hover:border-fg/40'
          }`}
        >
          <CheckIcon size={16} strokeWidth={3} />
        </button>
        {/* removing a set is now Undo-able (toast), but keep this a deliberate, separated target —
            a full-height hit area set apart (extra gap above) from the big Done check + a quiet icon
            so a one-handed mis-tap doesn't land here instead of the check. -mr hit-slop pulls the tap
            area to the row edge without widening the visual glyph. */}
        <button
          onClick={onRemove}
          aria-label="Remove set"
          className="grid place-items-center h-9 w-7 -mr-1 pr-1 rounded-md text-fg/20 hover:text-red-400 active:text-red-400 active:scale-90 transition"
        >
          <TrashIcon size={14} />
        </button>
      </div>
    </div>
      {/* plate math — barbell lifts only; tap for the per-side breakdown sheet */}
      {plates && (
        <div className="grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_4.25rem] gap-1.5 px-2 -mt-0.5 pb-1">
          <div />
          <button
            type="button"
            onClick={() => setPlatesOpen(true)}
            aria-label={`Show plate breakdown for ${fmtWeight(set.weight, unit)}`}
            className="col-span-2 flex items-center gap-1 text-left text-[11px] text-fg/35 active:text-fg/70 tabular-nums"
          >
            <PlateGlyph />
            <span>
              {plates.perSide.length === 0
                ? 'Empty bar'
                : plates.perSide.map((g) => (g.count > 1 ? `${g.count}×` : '') + g.plate).join(' · ') + ' / side'}
            </span>
          </button>
          <div />
        </div>
      )}
      {/* "last time" reference — tap to copy those numbers into this set */}
      {refText && !set.done && (
        <div className="grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_4.25rem] gap-1.5 px-2 -mt-0.5 pb-1">
          <div />
          <button
            type="button"
            onClick={onApplyLast}
            aria-label={`Use last time: ${refText}`}
            className="col-span-2 flex items-center gap-1 text-left text-[11px] text-fg/35 active:text-fg/70 tabular-nums"
          >
            <HistoryIcon size={11} className="opacity-70" />
            <span><span className="text-fg/25">Last</span> {refText}</span>
          </button>
          <div />
        </div>
      )}
      {/* RPE — optional effort log, surfaced once a WORKING set is completed (reuses the sub-row slot
          left empty when a set is done; warm-ups and not-yet-done sets don't show it) */}
      {set.done && !set.warmup && onRpe && (
        <div className="flex items-center gap-1.5 px-2 -mt-0.5 pb-1.5">
          <span className="text-[11px] font-medium text-fg/30 w-7 shrink-0">RPE</span>
          {RPE_OPTIONS.map((n) => {
            const active = set.rpe === n
            return (
              <button
                key={n}
                type="button"
                onClick={() => onRpe(active ? undefined : n)}
                aria-pressed={active}
                aria-label={`RPE ${n}${active ? ', selected — tap to clear' : ''}`}
                className={`h-7 flex-1 rounded-md text-[12px] font-semibold tabular-nums transition ${
                  active
                    ? 'bg-blaze/[0.15] text-blaze-label border border-blaze/40'
                    : 'bg-raised text-fg/40 border border-hairline/[0.08] active:text-fg/70'
                }`}
              >
                {n}
              </button>
            )
          })}
        </div>
      )}
      {/* plate-math sheet — per-side breakdown for the current load */}
      <Sheet open={platesOpen} onClose={() => setPlatesOpen(false)} title="Plate math">
        {plates && (
          <div className="space-y-4 pt-1">
            <div className="text-center">
              <div className="text-3xl font-extrabold tabular-nums">{fmtWeight(set.weight, unit)}</div>
              {ex?.name && <div className="text-sm text-fg/45 mt-0.5">{ex.name}</div>}
            </div>
            {plates.perSide.length === 0 ? (
              <p className="text-center text-sm text-fg/60">Just the empty bar — {fmtWeight(plates.bar, unit)}.</p>
            ) : (
              <>
                <p className="text-center text-[11px] uppercase tracking-wide text-fg/40">Load on each side</p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {plates.perSide.map((g, i) => (
                    <span
                      key={i}
                      className="rounded-xl bg-raised border border-hairline/10 px-3 py-2 text-sm font-bold tabular-nums"
                    >
                      {g.count > 1 ? `${g.count} × ` : ''}
                      {g.plate}
                    </span>
                  ))}
                </div>
                <p className="text-center text-sm text-fg/55">
                  {fmtWeight(plates.bar, unit)} bar + {fmtWeight((plates.loaded - plates.bar) / 2, unit)} per side ={' '}
                  <span className="font-bold text-blaze-warm">{fmtWeight(plates.loaded, unit)}</span>
                </p>
              </>
            )}
            {plates.remainderPerSide > 0 && (
              <p className="text-center text-xs text-amber-400/80">
                +{fmtWeight(plates.remainderPerSide, unit)} per side isn’t loadable with standard plates — nearest is{' '}
                {fmtWeight(plates.loaded, unit)}.
              </p>
            )}
          </div>
        )}
      </Sheet>
    </div>
  )
}

/** Auto-advance: after completing a set, smooth-scroll the next not-yet-done WORKING set into view.
 *  Callers must render each SetRow with domId={`set-${set.id}`}. */
export function scrollNextUndoneIntoView(sets: LoggedSet[], toggled: LoggedSet): void {
  const i = sets.indexOf(toggled)
  if (i < 0) return
  const next = sets.slice(i + 1).find((s) => !s.warmup && !s.done)
  if (!next) return
  requestAnimationFrame(() => {
    document.getElementById(`set-${next.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })
}

export function NumberField({
  value,
  ariaLabel,
  onChange,
  integer,
  placeholder = '0',
  onStep,
}: {
  value: number
  ariaLabel: string
  onChange: (n: number) => void
  integer?: boolean
  placeholder?: string
  /** when provided, flank the input with −/+ steppers for one-thumb adjustments */
  onStep?: (dir: 1 | -1) => void
}) {
  const [text, setText] = useState<string | null>(null)
  const display = text ?? (value === 0 ? '' : String(value))
  // reps are whole numbers (decimals pollute volume / 1RM math); weight allows decimals
  const pattern = integer ? /^\d*$/ : /^\d*\.?\d*$/
  const input = (
    <input
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      aria-label={ariaLabel}
      value={display}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value
        if (raw !== '' && !pattern.test(raw)) return
        setText(raw)
        const n = raw === '' || raw === '.' ? 0 : Number(raw)
        if (Number.isNaN(n)) return
        onChange(Math.min(integer ? Math.floor(n) : n, 9999))
      }}
      onBlur={() => setText(null)}
      className={`min-w-0 flex-1 rounded-lg bg-raised border border-hairline/[0.08] py-2.5 text-center text-[15px] font-semibold tabular-nums outline-none focus:border-blaze placeholder:text-fg/25 ${
        onStep ? 'px-0.5' : 'w-full px-3 rounded-xl'
      }`}
    />
  )
  if (!onStep) return input
  const step = (dir: 1 | -1) => {
    onStep(dir)
    setText(null) // commit any in-progress text so the stepped value shows
  }
  return (
    <div className="flex items-stretch gap-1">
      {/* Steppers are the most-used mid-set control: widen from w-6 (24px) to w-8 (32px) and pin
          min-h 44px so the tap area meets the touch guideline (items-stretch already matches them to
          the input's height; tap-min-h-44 guarantees the floor on short rows). w-8 keeps enough room
          for the numeric input to stay central and show 3-digit loads. */}
      <button
        type="button"
        aria-label={`Decrease ${ariaLabel}`}
        onClick={() => step(-1)}
        className="shrink-0 w-8 tap-min-h-44 rounded-lg bg-raised border border-hairline/[0.08] text-fg/55 text-lg leading-none grid place-items-center active:bg-card active:scale-90 transition"
      >
        −
      </button>
      {input}
      <button
        type="button"
        aria-label={`Increase ${ariaLabel}`}
        onClick={() => step(1)}
        className="shrink-0 w-8 tap-min-h-44 rounded-lg bg-raised border border-hairline/[0.08] text-fg/55 text-lg leading-none grid place-items-center active:bg-card active:scale-90 transition"
      >
        +
      </button>
    </div>
  )
}
