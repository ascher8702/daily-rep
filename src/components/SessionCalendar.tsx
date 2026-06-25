'use client'

import { useMemo, useState } from 'react'
import type { Unit, Workout } from '@/types'
import { localDay, computeWeeklyStreak, workoutVolume } from '@/lib/stats'
import { ChevronLeft, ChevronRight, FlameIcon } from '@/components/icons'

/**
 * Monthly session calendar with a weekly framing header (the roundtable verdict: month grid + weekly
 * frame, living inside History). A second lens on the same `workouts` array — tapping a trained day
 * opens the existing workout-detail sheet. Trained vs rest is encoded by FILL (never color-only / red),
 * so a rest-heavy month never reads as failure; the weekly frame answers "am I on pace this week".
 */

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const workoutTime = (w: Workout) => w.completedAt ?? w.date
const startOfLocalDay = (t: number) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d
}

export default function SessionCalendar({
  workouts,
  weeklyTarget,
  unit,
  bodyweight,
  now,
  onOpenWorkout,
}: {
  workouts: Workout[]
  weeklyTarget: number
  unit: Unit
  bodyweight: number
  now: number
  onOpenWorkout: (id: string) => void
}) {
  const today = startOfLocalDay(now)
  const todayIdx = localDay(now)
  const [view, setView] = useState(() => ({ year: today.getFullYear(), month: today.getMonth() }))

  // sessions grouped by local-day index (newest-first within a day)
  const byDay = useMemo(() => {
    const m = new Map<number, Workout[]>()
    for (const w of workouts) {
      const k = localDay(workoutTime(w))
      const arr = m.get(k) ?? []
      arr.push(w)
      m.set(k, arr)
    }
    for (const arr of m.values()) arr.sort((a, b) => workoutTime(b) - workoutTime(a))
    return m
  }, [workouts])

  // ---- weekly frame: the current Monday–Sunday week ----
  const weekDots = useMemo(() => {
    const monday = startOfLocalDay(now)
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      const idx = localDay(d.getTime())
      return { date: d, trained: byDay.has(idx), isToday: idx === todayIdx, isFuture: idx > todayIdx }
    })
  }, [byDay, now, todayIdx])
  const weekDone = weekDots.filter((d) => d.trained).length
  const weekMet = weekDone >= weeklyTarget
  const streak = useMemo(() => computeWeeklyStreak(workouts.map(workoutTime), now), [workouts, now])

  // ---- month grid (Monday-first, padded to whole weeks) ----
  const grid = useMemo(() => {
    const first = new Date(view.year, view.month, 1)
    const startPad = (first.getDay() + 6) % 7
    const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
    const cells: (Date | null)[] = []
    for (let i = 0; i < startPad; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(view.year, view.month, d))
    while (cells.length % 7 !== 0) cells.push(null)
    return cells
  }, [view])

  const monthTotals = useMemo(() => {
    let count = 0
    let volume = 0
    for (const w of workouts) {
      const d = new Date(workoutTime(w))
      if (d.getFullYear() === view.year && d.getMonth() === view.month) {
        count += 1
        volume += workoutVolume(w, w.bodyweight ?? bodyweight)
      }
    }
    return { count, volume }
  }, [workouts, view, bodyweight])

  const atCurrentMonth = view.year === today.getFullYear() && view.month === today.getMonth()
  const stepMonth = (delta: number) =>
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  const openDay = (sessions: Workout[]) => {
    if (sessions.length) onOpenWorkout(sessions[0].id)
  }

  return (
    <div className="space-y-4">
      {/* weekly pace frame (slim) */}
      <section className="card !rounded-2xl p-4 flex items-center gap-3.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[13px] font-bold">This week</span>
            <span className="text-[13px] font-black tabular-nums text-blaze-label">
              {weekDone}
              <span className="text-fg/40 font-bold">/{weeklyTarget}</span>
            </span>
            {!weekMet && <span className="text-[11.5px] text-fg/45">· {weeklyTarget - weekDone} left</span>}
          </div>
          <div className="mt-2.5 flex gap-1.5" role="img" aria-label={`${weekDone} of ${weeklyTarget} workouts this week`}>
            {Array.from({ length: weeklyTarget }).map((_, i) => (
              <span
                key={i}
                className={`flex-1 h-[5px] rounded-[3px] ${i < Math.min(weekDone, weeklyTarget) ? 'bg-gradient-blaze' : 'bg-raised'}`}
              />
            ))}
          </div>
        </div>
        {streak > 0 && (
          <span className="shrink-0 inline-flex items-center gap-1.5 text-[13px] font-extrabold text-blaze-label bg-blaze/10 border border-blaze/25 rounded-full px-2.5 py-1.5 tabular-nums">
            <FlameIcon size={14} /> {streak} wk
          </span>
        )}
      </section>

      {/* month grid */}
      <section className="card p-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => stepMonth(-1)}
            aria-label="Previous month"
            className="h-11 w-11 grid place-items-center rounded-full text-fg/50 active:text-fg/80 -ml-2"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="text-sm font-semibold tabular-nums">
            {MONTHS[view.month]} {view.year}
          </div>
          <button
            onClick={() => !atCurrentMonth && stepMonth(1)}
            disabled={atCurrentMonth}
            aria-label="Next month"
            className="h-11 w-11 grid place-items-center rounded-full text-fg/50 active:text-fg/80 disabled:opacity-25 -mr-2"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="mt-2 grid grid-cols-7" role="grid" aria-label={`${MONTHS[view.month]} ${view.year} workouts`}>
          {WEEKDAYS.map((w, i) => (
            <div key={`h${i}`} role="columnheader" className="text-center text-[10px] text-fg/35 pb-1">
              {w}
            </div>
          ))}
          {grid.map((date, i) => {
            if (!date) return <div key={`b${i}`} role="gridcell" aria-hidden className="aspect-square" />
            const idx = localDay(date.getTime())
            const sessions = byDay.get(idx) ?? []
            const trained = sessions.length > 0
            const isToday = idx === todayIdx
            const isFuture = idx > todayIdx
            return (
              <div key={`d${i}`} role="gridcell" className="aspect-square grid place-items-center">
                <button
                  onClick={() => openDay(sessions)}
                  disabled={!trained}
                  aria-label={`${date.toDateString()}: ${
                    trained ? `${sessions.length} workout${sessions.length > 1 ? 's' : ''} logged` : isFuture ? 'upcoming' : 'no workout'
                  }`}
                  className="relative h-full w-full grid place-items-center disabled:cursor-default"
                >
                  <span
                    className={`h-[30px] w-[30px] rounded-full grid place-items-center text-xs tabular-nums ${
                      trained
                        ? 'bg-gradient-blaze text-on-accent font-extrabold'
                        : isFuture
                          ? 'text-fg/20'
                          : 'text-fg/45'
                    } ${isToday && !trained ? 'ring-1 ring-fg/40' : ''} ${
                      isToday && trained ? 'ring-2 ring-fg/55 ring-offset-1 ring-offset-card' : ''
                    }`}
                  >
                    {date.getDate()}
                  </span>
                  {sessions.length > 1 && (
                    <span className="absolute top-1 right-1.5 h-1.5 w-1.5 rounded-full bg-blaze-warm ring-[1.5px] ring-card" />
                  )}
                </button>
              </div>
            )
          })}
        </div>

        <div className="mt-1.5 pt-2.5 border-t border-hairline/[0.07] text-xs text-fg/45 text-center tabular-nums">
          {monthTotals.count > 0
            ? `${monthTotals.count} workout${monthTotals.count > 1 ? 's' : ''}${
                monthTotals.volume > 0 ? ` · ${Math.round(monthTotals.volume).toLocaleString()} ${unit}` : ''
              }`
            : 'No workouts this month'}
        </div>
      </section>

      {/* legend */}
      <div className="flex justify-center gap-[18px] text-[11px] text-fg/50">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-gradient-blaze" /> Trained
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-card border border-hairline/[0.12]" /> Rest
        </span>
      </div>
    </div>
  )
}
