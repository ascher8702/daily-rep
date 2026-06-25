'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { WorkoutExercise, Equipment } from '@/types'
import { useStore, resolvePlan } from '@/store/useStore'
import { getExercise } from '@/data/exercises'
import { planEquipment } from '@/data/plans'
import { muscleLabel } from '@/data/muscles'
import { fmtDuration, fmtClock, fmtWeight, perSideLabel } from '@/lib/format'
import { isBodyweightExercise } from '@/lib/weights'
import { groupExercises, supersetLabel } from '@/lib/supersets'
import { useNow } from '@/lib/useNow'
import ExercisePicker from '@/components/ExercisePicker'
import { Button } from '@/components/ui/Button'
import { useConfirm } from '@/components/ConfirmProvider'
import {
  XIcon,
  PlusIcon,
  CheckIcon,
  RefreshIcon,
  PlayIcon,
  TimerIcon,
  ChevronRight,
  DumbbellIcon,
} from '@/components/icons'

export default function SessionPage() {
  const router = useRouter()
  const current = useStore((s) => s.current)
  const generate = useStore((s) => s.generate)

  // ---- empty state: no planned/active session ----
  if (!current) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8 text-center animate-fade-in safe-top safe-bottom">
        <div className="grid place-items-center h-16 w-16 rounded-2xl bg-blaze/[0.12] text-blaze-warm mb-5">
          <DumbbellIcon size={30} />
        </div>
        <h1 className="text-2xl font-extrabold">No active session</h1>
        <p className="text-fg/50 mt-2 text-[15px] max-w-xs">
          Build a recovery-aware workout tuned to your goal and what&apos;s fresh today.
        </p>
        <Button onClick={() => generate()} fullWidth className="mt-7 max-w-xs">
          <PlusIcon size={18} /> Generate a workout
        </Button>
        <Button onClick={() => router.push('/')} variant="ghost" size="sm" className="mt-3">
          Back home
        </Button>
      </div>
    )
  }

  return <SessionView />
}

function SessionView() {
  const router = useRouter()
  const confirm = useConfirm()
  const current = useStore((s) => s.current)
  const profile = useStore((s) => s.profile)
  const generate = useStore((s) => s.generate)
  const generateFromPlan = useStore((s) => s.generateFromPlan)
  const activePlan = useStore((s) => s.activePlan)
  const customPlans = useStore((s) => s.customPlans)
  const startWorkout = useStore((s) => s.startWorkout)
  const finishWorkout = useStore((s) => s.finishWorkout)
  const addExercise = useStore((s) => s.addExercise)

  const [shuffleN, setShuffleN] = useState(0)
  const [addOpen, setAddOpen] = useState(false)

  if (!current) return null

  const isActive = current.status === 'active'
  const existingIds = current.exercises.map((e) => e.exerciseId)

  // on a plan session, the Add picker respects the plan's narrowed equipment
  let pickerEquipment: Equipment[] | undefined
  if (current.planId && activePlan?.planId === current.planId) {
    const plan = resolvePlan(current.planId, customPlans)
    const override = plan ? planEquipment(plan) : undefined
    if (override) pickerEquipment = profile.equipment.filter((e) => override.includes(e) || e === 'bodyweight')
  }

  let doneSets = 0
  let totalSets = 0
  let allWorkingDone = true
  for (const we of current.exercises) {
    for (const st of we.sets) {
      if (st.warmup) continue
      totalSets += 1
      if (st.done) doneSets += 1
      else allWorkingDone = false
    }
  }

  const regenerate = async () => {
    const hasLogged = current.exercises.some((we) => we.sets.some((s) => s.done))
    if (
      hasLogged &&
      !(await confirm({
        title: 'Regenerate workout?',
        body: 'A fresh set of exercises will replace this one. Your logged sets will be lost.',
        confirmLabel: 'Regenerate',
        tone: 'danger',
      }))
    )
      return
    const next = shuffleN + 1
    setShuffleN(next)
    if (current.planId && activePlan?.planId === current.planId) {
      generateFromPlan(next)
    } else if (current.genFocus && current.genFocus.length) {
      generate({ shuffle: next, focusOverride: current.genFocus })
    } else {
      generate({ shuffle: next })
    }
  }

  const onFinish = async () => {
    // only a completed WORKING set counts — finishWorkout discards a warm-up-only session,
    // so the confirm copy must match (don't promise to "save" what will be discarded)
    const anyDone = current.exercises.some((we) => we.sets.some((s) => s.done && !s.warmup))
    if (!anyDone) {
      if (
        !(await confirm({
          title: 'Discard workout?',
          body: "You haven't completed any sets, so nothing will be saved to your history.",
          confirmLabel: 'Discard',
          tone: 'danger',
        }))
      )
        return
    } else if (!allWorkingDone) {
      if (
        !(await confirm({
          title: 'Finish workout?',
          body: 'You still have unfinished sets. The sets you completed will be saved.',
          confirmLabel: 'Finish & save',
        }))
      )
        return
    }
    // capture the id before finishing (finishWorkout keeps it on the saved workout, then clears current)
    const savedId = current.id
    finishWorkout()
    // anyDone → a real workout was saved: show its summary; otherwise it was discarded → home
    router.push(anyDone ? `/session/summary?w=${savedId}` : '/')
  }

  return (
    <div className="min-h-screen flex flex-col animate-fade-in">
      {/* ---- sticky header ---- */}
      <header className="sticky top-0 z-30 safe-top bg-bg/[0.86] backdrop-blur-md border-b border-hairline/10">
        <div className="px-5 pt-3 pb-3">
          <div className="flex items-start gap-3">
            <button
              onClick={() => router.push('/')}
              aria-label="Close session"
              className="shrink-0 grid place-items-center h-9 w-9 -ml-1 rounded-full bg-raised text-fg/80 active:scale-95 transition"
            >
              <XIcon size={18} />
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-[19px] font-black uppercase leading-tight tracking-[-0.01em] truncate">
                {current.title}
              </h1>
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                {current.focus.map((m) => (
                  <span
                    key={m}
                    className="rounded-full bg-raised px-2.5 py-1 text-[11px] font-bold text-fg/60"
                  >
                    {muscleLabel(m)}
                  </span>
                ))}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <HeaderTimer />
              <div className="text-[11px] text-fg/45 mt-1 tabular-nums">
                {doneSets}/{totalSets} sets
              </div>
            </div>
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-raised overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-blaze-h transition-all duration-300"
              style={{ width: `${totalSets ? (doneSets / totalSets) * 100 : 0}%` }}
            />
          </div>
        </div>
      </header>

      {/* ---- exercise list ---- */}
      <main className="flex-1 px-5 pt-4 pb-40 space-y-2.5">
        {current.exercises.length === 0 ? (
          <div className="card p-8 text-center text-fg/45 text-sm">
            No exercises yet. Add one below to get started.
          </div>
        ) : (
          groupExercises(current.exercises).map((g) => {
            const open = (we: WorkoutExercise, i: number) =>
              router.push(`/session/${we.instanceId ?? we.exerciseId}`)
            // a real superset/circuit: bracket the members under a labeled container
            if (g.letter && g.members.length >= 2) {
              return (
                <div
                  key={`grp-${g.groupId}-${g.members[0].index}`}
                  className="rounded-[18px] border border-blaze/30 bg-blaze/[0.04] p-1.5 space-y-1.5"
                >
                  <div className="flex items-center gap-1.5 px-2.5 pt-1 text-[10px] font-bold uppercase tracking-wide text-blaze-label">
                    <SupersetGlyph />
                    {supersetLabel(g.members.length)}
                    <span className="text-blaze-label/50 normal-case font-medium tracking-normal">
                      · alternate {g.members.map((_, j) => `${g.letter}${j + 1}`).join('/')}
                    </span>
                  </div>
                  {g.members.map((m, j) => (
                    <ExerciseRow
                      key={m.we.instanceId ?? `${m.we.exerciseId}-${m.index}`}
                      we={m.we}
                      index={m.index}
                      label={`${g.letter}${j + 1}`}
                      grouped
                      unit={profile.unit}
                      onOpen={() => open(m.we, m.index)}
                    />
                  ))}
                </div>
              )
            }
            const m = g.members[0]
            return (
              <ExerciseRow
                key={m.we.instanceId ?? `${m.we.exerciseId}-${m.index}`}
                we={m.we}
                index={m.index}
                unit={profile.unit}
                onOpen={() => open(m.we, m.index)}
              />
            )
          })
        )}
      </main>

      {/* ---- sticky bottom action bar ---- */}
      <div className="fixed bottom-0 inset-x-0 z-30 mx-auto max-w-md bg-bg/[0.92] backdrop-blur-md border-t border-hairline/10">
        <div className="px-5 py-3 safe-bottom flex items-center gap-2.5">
          {!isActive ? (
            <>
              <button
                onClick={regenerate}
                aria-label="Regenerate workout"
                className="shrink-0 grid place-items-center h-[52px] w-[52px] rounded-xl bg-raised text-fg active:scale-95 transition"
              >
                <RefreshIcon size={20} />
              </button>
              <Button onClick={() => setAddOpen(true)} variant="secondary" className="flex-1 px-3">
                <PlusIcon size={18} /> Add
              </Button>
              <Button onClick={startWorkout} className="flex-[1.4]">
                <PlayIcon size={17} /> Start
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => setAddOpen(true)} variant="secondary" className="flex-1">
                <PlusIcon size={18} /> Add Exercise
              </Button>
              <Button onClick={onFinish} className="flex-[1.3]">
                <CheckIcon size={18} /> Finish
              </Button>
            </>
          )}
        </div>
      </div>

      <ExercisePicker
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onPick={(id) => addExercise(id)}
        exclude={existingIds}
        title="Add Exercise"
        equipment={pickerEquipment}
      />
    </div>
  )
}

/** A tappable exercise row — tapping opens the per-exercise logging page. */
function ExerciseRow({
  we,
  index,
  unit,
  onOpen,
  label,
  grouped,
}: {
  we: WorkoutExercise
  index: number
  unit: 'lb' | 'kg'
  onOpen: () => void
  /** badge text (e.g. "A1") for a superset member; falls back to the 1-based position */
  label?: string
  /** rendered inside a superset bracket → lighter chrome so the group reads as one unit */
  grouped?: boolean
}) {
  const ex = getExercise(we.exerciseId)
  const name = ex?.name ?? 'Exercise'
  const workingSets = we.sets.filter((s) => !s.warmup)
  const totalWorking = workingSets.length
  const doneWorking = workingSets.filter((s) => s.done).length
  const allDone = totalWorking > 0 && doneWorking === totalWorking
  const topWeight = workingSets.reduce((m, s) => Math.max(m, s.weight), 0)
  const isBodyweight = !!ex && isBodyweightExercise(ex)
  const summaryWeight = topWeight > 0 ? fmtWeight(topWeight, unit) : isBodyweight ? 'BW' : null

  return (
    <button
      onClick={onOpen}
      aria-label={`Open ${name}`}
      className={`w-full text-left flex items-center gap-3 px-4 py-3.5 active:scale-[0.99] transition ${
        grouped
          ? `rounded-xl bg-raised ${allDone ? 'ring-1 ring-recovery-fresh/30' : ''}`
          : `card ${allDone ? 'border-recovery-fresh/30' : ''}`
      }`}
    >
      <div
        className={`shrink-0 grid place-items-center h-10 w-10 rounded-[11px] text-sm font-bold tabular-nums ${
          allDone ? 'bg-recovery-fresh text-bg' : 'bg-raised text-fg/55'
        }`}
      >
        {allDone ? <CheckIcon size={17} strokeWidth={3} /> : (label ?? index + 1)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-extrabold uppercase truncate leading-tight">{name}</div>
        {we.note && (
          <div className="text-[11px] text-amber-300/80 leading-snug truncate mt-0.5">{we.note}</div>
        )}
        <div className="flex items-center gap-1.5 text-xs text-fg/45 mt-0.5">
          <span className={allDone ? 'text-recovery-fresh font-medium' : ''}>
            {doneWorking}/{totalWorking} sets
          </span>
          {summaryWeight && (
            <>
              <span className="text-fg/25">·</span>
              <span>{summaryWeight}</span>
            </>
          )}
          <span className="text-fg/25">·</span>
          <span>
            {we.targetReps[0]}–{we.targetReps[1]} reps{perSideLabel(ex) ? ` · ${perSideLabel(ex)}` : ''}
          </span>
        </div>
      </div>
      <ChevronRight size={20} className="shrink-0 text-fg/35" />
    </button>
  )
}

/** Two interlocking arrows — a compact "alternate between these" superset glyph. */
function SupersetGlyph() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h13l-3-3M20 17H7l3 3" />
    </svg>
  )
}

/** Live elapsed timer (active) or planned duration (planned). */
function HeaderTimer() {
  const current = useStore((s) => s.current)
  const isActive = current?.status === 'active'
  const now = useNow(1000, isActive)
  if (!current) return null

  if (isActive && current.startedAt) {
    const elapsed = Math.min(240 * 60, Math.max(0, Math.floor((now - current.startedAt) / 1000)))
    return (
      <div className="inline-flex items-center gap-1.5 text-blaze-warm font-black tabular-nums text-[16px]">
        <TimerIcon size={15} />
        {fmtClock(elapsed)}
      </div>
    )
  }
  const plannedMin = Math.max(11, current.exercises.length * 11)
  return (
    <div className="inline-flex items-center gap-1.5 text-fg/70 font-semibold text-[15px]">
      <TimerIcon size={15} />~{fmtDuration(plannedMin)}
    </div>
  )
}
