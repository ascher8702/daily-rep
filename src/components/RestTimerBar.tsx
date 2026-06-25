'use client'

import { usePathname } from 'next/navigation'
import { useStore } from '../store/useStore'
import { useNow } from '../lib/useNow'
import { fmtClock } from '../lib/format'
import { getExercise } from '../data/exercises'
import { PlusIcon, XIcon } from './icons'

export default function RestTimerBar() {
  const restEndsAt = useStore((s) => s.restEndsAt)
  const restDuration = useStore((s) => s.restDuration)
  const current = useStore((s) => s.current)
  const adjustRest = useStore((s) => s.adjustRest)
  const stopRest = useStore((s) => s.stopRest)
  const pathname = usePathname()
  // the rest timer is a session concept — only show it on session routes, and stop the
  // 250ms re-render interval off-session so a completed timer can't pin a bar onto
  // Home/History/Settings (or churn renders) until manually skipped
  const onSession = pathname === '/session' || pathname.startsWith('/session/')
  const now = useNow(250, !!restEndsAt && onSession)

  if (!restEndsAt || !onSession) return null
  const remainingMs = restEndsAt - now
  const remaining = Math.max(0, Math.ceil(remainingMs / 1000))
  const done = remaining <= 0
  const pct = restDuration > 0 ? Math.max(0, Math.min(1, remaining / restDuration)) : 0

  // the next working set still to be logged — so the resting user sees what's coming
  let upNext: string | null = null
  if (current) {
    for (const we of current.exercises) {
      const working = we.sets.filter((s) => !s.warmup)
      const idx = working.findIndex((s) => !s.done)
      if (idx !== -1) {
        upNext = `${getExercise(we.exerciseId)?.name ?? 'Exercise'} · Set ${idx + 1}`
        break
      }
    }
  }

  // We only render on session routes (guarded above), which always have a fixed bottom action bar
  // (px-5 py-3 + safe-bottom, ~76px tall content). Sit clearly above it: 84px clearance for the bar
  // PLUS the device safe-area inset, so the timer never overlaps the bar on home-indicator phones
  // (the old hardcoded bottom-[96px] ignored the inset and could collide). pb-2 adds a small gap.
  return (
    <div
      className="fixed inset-x-0 z-30 px-3 pb-2 pointer-events-none"
      style={{ bottom: 'calc(84px + env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="mx-auto max-w-md pointer-events-auto">
        <div className={`bg-card overflow-hidden rounded-2xl border ${done ? 'border-recovery-fresh/60' : 'border-recovery-fresh/40'}`}>
          <div className="h-1 bg-raised">
            <div
              className="h-full bg-recovery-fresh transition-[width] duration-200 ease-linear"
              style={{ width: `${pct * 100}%` }}
            />
          </div>
          <div className="flex items-center gap-3 px-3.5 py-2.5">
            <div className="flex flex-col min-w-0">
              <span className="text-[10px] uppercase tracking-[0.06em] text-fg/45 font-extrabold">
                {done ? 'Rest complete' : 'Resting'}
              </span>
              <span className={`text-[21px] font-black tabular-nums leading-none mt-0.5 ${done ? 'text-recovery-fresh' : 'text-fg'}`}>
                {fmtClock(remaining)}
              </span>
              {upNext && (
                <span className="text-[11px] text-fg/50 truncate mt-1">Up next · {upNext}</span>
              )}
            </div>
            <div className="ml-auto flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => adjustRest(-15)}
                className="rounded-lg bg-raised px-2.5 py-2 text-[13px] font-extrabold text-fg active:scale-95 transition"
                aria-label="minus 15 seconds"
              >
                −15
              </button>
              <button
                onClick={() => adjustRest(15)}
                className="inline-flex items-center gap-0.5 rounded-lg bg-raised px-2.5 py-2 text-[13px] font-extrabold text-fg active:scale-95 transition"
                aria-label="plus 15 seconds"
              >
                <PlusIcon size={14} />15
              </button>
              <button
                onClick={stopRest}
                className="grid place-items-center h-[34px] w-[34px] rounded-lg bg-recovery-fresh text-bg active:scale-95 transition"
                aria-label="skip rest"
              >
                <XIcon size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
