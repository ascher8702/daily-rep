'use client'

import { useMemo, useState } from 'react'
import type { MuscleGroup } from '@/types'
import { useStore, resolvePlan } from '@/store/useStore'
import { dayFocusMuscles } from '@/data/plans'
import { localWeek } from '@/lib/stats'
import { recoveryToken } from '@/lib/recovery'
import { ALL_MUSCLES, MUSCLES, muscleLabel } from '@/data/muscles'
import Sheet from './Sheet'
import { Button } from './ui/Button'
import { CheckIcon, PlusIcon, HistoryIcon, TargetIcon, DumbbellIcon, ChevronRight } from './icons'

interface Props {
  open: boolean
  onClose: () => void
  /** per-muscle freshness 0–100 (drives the recovered-muscle cue in the target picker) */
  fresh: Record<MuscleGroup, number>
  /** build + go to a specific plan-schedule day */
  onPickPlanDay: (dayIndex: number) => void
  /** build a fresh recovery-aware workout */
  onNewWorkout: () => void
  /** open saved workouts (history) to repeat one */
  onPickSaved: () => void
  /** build a workout targeting the chosen muscles */
  onPickMuscles: (muscles: MuscleGroup[]) => void
}

const tileTone: Record<string, string> = {
  fresh: 'bg-recovery-fresh',
  moderate: 'bg-recovery-moderate',
  rest: 'bg-recovery-rest',
}

/**
 * The Home hero's "Switch" chooser. One sheet, four ways to set today's training:
 *   1. pick any day of the current plan week (a “Done” badge marks days already trained this week,
 *      but never blocks re-picking),
 *   2. build a fresh recovery-aware workout,
 *   3. repeat a saved workout (→ History),
 *   4. target specific muscle groups (recovered ones highlighted).
 */
export default function SwitchWorkoutSheet({
  open,
  onClose,
  fresh,
  onPickPlanDay,
  onNewWorkout,
  onPickSaved,
  onPickMuscles,
}: Props) {
  const activePlan = useStore((s) => s.activePlan)
  const customPlans = useStore((s) => s.customPlans)
  const workouts = useStore((s) => s.workouts)

  // a self-contained sub-mode: tap "Target muscle groups" to reveal the multi-select picker
  const [muscleMode, setMuscleMode] = useState(false)
  const [picked, setPicked] = useState<Set<MuscleGroup>>(new Set())

  const plan = activePlan ? resolvePlan(activePlan.planId, customPlans) : undefined
  const todayIndex = plan && activePlan ? activePlan.dayIndex % plan.schedule.length : -1

  // which plan days have a completed session logged in the current calendar week (by day label)
  const doneThisWeek = useMemo(() => {
    if (!plan || !activePlan) return new Set<string>()
    const wk = localWeek(Date.now())
    return new Set(
      workouts
        .filter(
          (w) =>
            w.status === 'completed' &&
            w.planId === activePlan.planId &&
            w.planDayLabel != null &&
            localWeek(w.completedAt ?? w.date) === wk,
        )
        .map((w) => w.planDayLabel as string),
    )
  }, [plan, activePlan, workouts])

  // reset transient sub-state whenever the sheet is (re)opened/closed
  const close = () => {
    setMuscleMode(false)
    setPicked(new Set())
    onClose()
  }

  const toggleMuscle = (m: MuscleGroup) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(m)) next.delete(m)
      else next.add(m)
      return next
    })

  const buildMuscles = () => {
    if (picked.size === 0) return
    const list = [...picked]
    close()
    onPickMuscles(list)
  }

  return (
    <Sheet open={open} onClose={close} title={muscleMode ? 'Target muscle groups' : 'Choose your workout'}>
      {muscleMode ? (
        <div className="pt-1">
          <p className="text-[13px] text-fg/50 mb-3">
            Pick the muscles to train — the dot shows how recovered each one is right now.
          </p>
          <div className="flex flex-wrap gap-2">
            {ALL_MUSCLES.map((m) => {
              const on = picked.has(m)
              return (
                <button
                  key={m}
                  onClick={() => toggleMuscle(m)}
                  aria-pressed={on}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-[13px] font-semibold transition active:scale-95 ${
                    on
                      ? 'border-blaze bg-blaze/[0.14] text-blaze-label'
                      : 'border-hairline/[0.1] bg-raised text-fg/70'
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${tileTone[recoveryToken(fresh[m])] ?? 'bg-fg/30'}`} />
                  {muscleLabel(m)}
                </button>
              )
            })}
          </div>
          <div className="mt-5 flex flex-col gap-2.5">
            <Button onClick={buildMuscles} disabled={picked.size === 0} fullWidth>
              <DumbbellIcon size={18} /> Build{picked.size > 0 ? ` (${picked.size})` : ''}
            </Button>
            <Button onClick={() => setMuscleMode(false)} variant="secondary" fullWidth>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="pt-1 space-y-5">
          {/* 1 — this week's plan days */}
          {plan && (
            <section>
              <div className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-fg/40 mb-2">
                This week · {plan.name}
              </div>
              <div className="space-y-2">
                {plan.schedule.map((day, i) => {
                  const done = doneThisWeek.has(day.label)
                  const isToday = i === todayIndex
                  return (
                    <button
                      key={day.label}
                      onClick={() => {
                        close()
                        onPickPlanDay(i)
                      }}
                      className={`w-full text-left card px-4 py-3 flex items-center gap-3 active:scale-[0.99] transition ${
                        isToday ? 'border-blaze/40' : ''
                      }`}
                    >
                      <span
                        className={`shrink-0 grid place-items-center h-9 w-9 rounded-[10px] text-sm font-bold tabular-nums ${
                          done ? 'bg-recovery-fresh text-bg' : 'bg-raised text-fg/55'
                        }`}
                      >
                        {done ? <CheckIcon size={16} strokeWidth={3} /> : i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold truncate flex items-center gap-2">
                          {day.title}
                          {isToday && (
                            <span className="shrink-0 rounded-full bg-blaze/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blaze-label">
                              Today
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-fg/45 truncate mt-0.5">
                          {dayFocusMuscles(day.focus).slice(0, 3).map(muscleLabel).join(' · ') || day.label}
                        </div>
                      </div>
                      {done ? (
                        <span className="shrink-0 rounded-full bg-recovery-fresh/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-recovery-fresh">
                          Done
                        </span>
                      ) : (
                        <ChevronRight size={18} className="shrink-0 text-fg/30" />
                      )}
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {/* 2–4 — other ways to start */}
          <section>
            <div className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-fg/40 mb-2">
              Or start another way
            </div>
            <div className="space-y-2">
              <OptionRow
                icon={<PlusIcon size={20} />}
                title="New recovery-aware workout"
                subtitle="Auto-built around what's fresh today"
                onClick={() => {
                  close()
                  onNewWorkout()
                }}
              />
              <OptionRow
                icon={<TargetIcon size={20} />}
                title="Target muscle groups"
                subtitle="Choose the muscles you want to train"
                onClick={() => setMuscleMode(true)}
              />
              <OptionRow
                icon={<HistoryIcon size={20} />}
                title="Repeat a saved workout"
                subtitle="Pick from your workout history"
                onClick={() => {
                  close()
                  onPickSaved()
                }}
              />
            </div>
          </section>
        </div>
      )}
    </Sheet>
  )
}

function OptionRow({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left card px-4 py-3 flex items-center gap-3 active:scale-[0.99] transition"
    >
      <span className="shrink-0 grid place-items-center h-10 w-10 rounded-xl bg-blaze/15 text-blaze-label">
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-bold truncate">{title}</div>
        <div className="text-xs text-fg/45 truncate mt-0.5">{subtitle}</div>
      </div>
      <ChevronRight size={18} className="shrink-0 text-fg/30" />
    </button>
  )
}
