'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import type { Dir, Equipment } from '@/types'
import { useStore, resolvePlan } from '@/store/useStore'
import { getExercise } from '@/data/exercises'
import { planEquipment } from '@/data/plans'
import { muscleLabel } from '@/data/muscles'
import { lastPerformance } from '@/lib/generator'
import { fmtWeight, perSideLabel } from '@/lib/format'
import { platesPerSide, isBodyweightExercise } from '@/lib/weights'
import Sheet from '@/components/Sheet'
import { Button } from '@/components/ui/Button'
import { useConfirm } from '@/components/ConfirmProvider'
import { SetRow, scrollNextUndoneIntoView } from '@/components/SetRow'
import { supersetMembers, nextSupersetIndex, exerciseGroupLabel, supersetLabel } from '@/lib/supersets'
import ExercisePicker from '@/components/ExercisePicker'
import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  PlusIcon,
  CheckIcon,
  TrashIcon,
  SwapIcon,
  InfoIcon,
  FlameIcon,
} from '@/components/icons'

export default function ExerciseDetailPage() {
  const router = useRouter()
  const confirm = useConfirm()
  const params = useParams()
  const idParam = Array.isArray(params.id) ? params.id[0] : (params.id ?? '')

  const current = useStore((s) => s.current)
  const workouts = useStore((s) => s.workouts)
  const profile = useStore((s) => s.profile)
  const activePlan = useStore((s) => s.activePlan)
  const customPlans = useStore((s) => s.customPlans)
  const updateSet = useStore((s) => s.updateSet)
  const updateSetCascade = useStore((s) => s.updateSetCascade)
  const addSet = useStore((s) => s.addSet)
  const addWarmupSets = useStore((s) => s.addWarmupSets)
  const removeSet = useStore((s) => s.removeSet)
  const toggleSetDone = useStore((s) => s.toggleSetDone)
  const setExerciseEffort = useStore((s) => s.setExerciseEffort)
  const swapExercise = useStore((s) => s.swapExercise)
  const replaceInActivePlan = useStore((s) => s.replaceInActivePlan)
  const removeExercise = useStore((s) => s.removeExercise)
  const reorderExercise = useStore((s) => s.reorderExercise)

  const [infoOpen, setInfoOpen] = useState(false)
  const [swapOpen, setSwapOpen] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)
  // auto-pop the effort prompt once per exercise the first time it's fully logged
  const effortPromptedFor = useRef<string | null>(null)
  const [pendingSwap, setPendingSwap] = useState<string | null>(null) // newId awaiting one-time vs plan-replace choice
  const [showWarmups, setShowWarmups] = useState(true) // warm-ups visible by default

  const exercises = current?.exercises ?? []
  const idx = exercises.findIndex((e) => (e.instanceId ?? e.exerciseId) === idParam)
  const we = idx >= 0 ? exercises[idx] : undefined

  // the session/exercise is gone (removed, finished, or direct nav) → back to the list
  useEffect(() => {
    if (!current || !we) router.replace('/session')
  }, [current, we, router])

  // once every working set is logged, pop the effort prompt — once per exercise, and only if the
  // user hasn't already recorded an effort (so re-visiting a logged lift doesn't nag).
  useEffect(() => {
    if (!we) return
    const key = we.instanceId ?? we.exerciseId
    const working = we.sets.filter((s) => !s.warmup)
    const allLogged = working.length > 0 && working.every((s) => s.done)
    const hasEffort = working.some((s) => s.done && typeof s.rpe === 'number')
    if (allLogged && !hasEffort && effortPromptedFor.current !== key) {
      effortPromptedFor.current = key
      setEffortOpen(true)
    }
  }, [we])

  if (!current || !we) return null

  const ex = getExercise(we.exerciseId)
  const exKey = we.instanceId ?? we.exerciseId
  const name = ex?.name ?? 'Exercise'
  const unit = profile.unit
  const existingIds = exercises.map((e) => e.exerciseId)

  const workingSets = we.sets.filter((s) => !s.warmup)
  const totalWorking = workingSets.length
  const doneWorking = workingSets.filter((s) => s.done).length
  const allDone = totalWorking > 0 && doneWorking === totalWorking
  // the effort already recorded for this lift, as reps-in-reserve (RPE 10 → 0 more reps)
  const loggedSet = workingSets.find((s) => s.done && typeof s.rpe === 'number')
  const loggedRir = loggedSet?.rpe != null ? Math.max(0, 10 - loggedSet.rpe) : null
  const topWeight = workingSets.reduce((m, s) => Math.max(m, s.weight), 0)
  const isBodyweight = !!ex && isBodyweightExercise(ex)
  const plates = ex && topWeight > 0 ? platesPerSide(topWeight, ex, unit) : null
  const warmupCount = we.sets.filter((s) => s.warmup).length

  // on a plan session, the swap picker respects the plan's narrowed equipment
  let pickerEquipment: Equipment[] | undefined
  if (current.planId && activePlan?.planId === current.planId) {
    const plan = resolvePlan(current.planId, customPlans)
    const override = plan ? planEquipment(plan) : undefined
    if (override) pickerEquipment = profile.equipment.filter((e) => override.includes(e) || e === 'bodyweight')
  }

  // superset interleave (increment 2): alternate A1→A2→A1… within a round. The "Next" CTA points to the
  // partner that still has an undone set; once partners are done it leaves the group.
  const ssMembers = supersetMembers(exercises, idx)
  const ssPartnerIdx = ssMembers ? nextSupersetIndex(exercises, idx) : null
  const afterGroupIdx = ssMembers ? ssMembers[ssMembers.length - 1] + 1 : idx + 1
  const nextIdx = ssPartnerIdx != null ? ssPartnerIdx : afterGroupIdx
  const nextIsPartner = ssPartnerIdx != null
  const next = exercises[nextIdx]
  const goNext = () =>
    next ? router.push(`/session/${next.instanceId ?? next.exerciseId}`) : router.push('/session')

  // what you actually did last time (most recent completed session with this lift) —
  // surfaced under each working set as a tap-to-apply reference + input placeholder
  const lastSets = lastPerformance(we.exerciseId, workouts)

  // a plan lift this session was built from → offer "just this time" vs "replace in my plan"
  const isPlanLift = !!(current.planId && activePlan?.planId === current.planId && we.planLiftId)

  // swapping carries logged sets over (no silent loss); confirm first when real work exists
  const onSwapPick = async (newId: string) => {
    // for a plan lift the scope sheet doubles as the confirmation (it notes carried-over sets)
    if (isPlanLift) {
      setPendingSwap(newId)
      return
    }
    if (doneWorking > 0) {
      const ok = await confirm({
        title: `Swap to ${getExercise(newId)?.name ?? 'this exercise'}?`,
        body: `Your ${doneWorking} logged set${doneWorking === 1 ? '' : 's'} will carry over — double-check the weight, since the right load may differ for the new movement.`,
        confirmLabel: 'Swap',
      })
      if (!ok) return
    }
    swapExercise(exKey, newId)
  }

  // resolve the swap once the user picks a scope; "for the plan" records an active-plan override
  // (your saved plan is never modified) so future sessions of this day use the new exercise too.
  const applySwap = (newId: string, forPlan: boolean) => {
    setPendingSwap(null)
    swapExercise(exKey, newId)
    if (forPlan && we.planLiftId) replaceInActivePlan(we.planLiftId, newId)
  }

  let workingCounter = 0

  return (
    <div className="min-h-screen flex flex-col animate-fade-in">
      {/* header */}
      <header className="sticky top-0 z-30 safe-top bg-bg/[0.86] backdrop-blur-md border-b border-hairline/10">
        {/* 1fr / auto / 1fr keeps the title at the true center — the side columns stay equal width
            even though the "Workout" back button is wider than the right-hand done indicator. */}
        <div className="px-4 pt-3 pb-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <button
            onClick={() => router.push('/session')}
            aria-label="Back to workout"
            className="justify-self-start inline-flex items-center gap-1 text-sm text-fg/60 active:text-fg pr-1"
          >
            <ChevronLeft size={20} /> Workout
          </button>
          <div className="min-w-0 text-center px-2">
            <div className="font-black uppercase tracking-[-0.01em] truncate leading-tight">{name}</div>
            <div className="text-[11px] text-fg/45 tabular-nums">
              {doneWorking}/{totalWorking} sets · {we.targetReps[0]}–{we.targetReps[1]} reps
              {perSideLabel(ex) ? ` · ${perSideLabel(ex)}` : ''}
            </div>
          </div>
          <div className="justify-self-end w-9 flex justify-end">
            {allDone && (
              <span className="grid place-items-center h-7 w-7 rounded-full bg-recovery-fresh text-bg">
                <CheckIcon size={16} strokeWidth={3} />
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 pt-4 pb-32">
        {/* swap note (equipment substitution) */}
        {we.note && (
          <div className="mb-3 rounded-xl bg-amber-400/10 border border-amber-400/25 px-3 py-2 text-[12px] text-amber-200/90">
            {we.note}
          </div>
        )}

        {/* superset interleave banner — alternate partners each set, share one rest per round */}
        {ssMembers && ssMembers.length >= 2 && (
          <div className="mb-3 rounded-xl bg-blaze/[0.04] border border-blaze/30 px-3 py-2.5">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="font-semibold text-blaze-label">{supersetLabel(ssMembers.length)}</span>
              <span className="text-fg/55">· do one set each, then rest once</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ssMembers.map((mi) => {
                const m = exercises[mi]
                const mLabel = exerciseGroupLabel(exercises, mi)
                const mDone = m.sets.filter((s) => !s.warmup && s.done).length
                const mTotal = m.sets.filter((s) => !s.warmup).length
                const isCur = mi === idx
                return (
                  <button
                    key={mi}
                    onClick={() => !isCur && router.push(`/session/${m.instanceId ?? m.exerciseId}`)}
                    aria-current={isCur ? 'true' : undefined}
                    className={`pill border text-[11px] ${
                      isCur ? 'bg-blaze/[0.12] border-blaze/40 text-blaze-label' : 'bg-raised border-hairline/10 text-fg/75'
                    }`}
                  >
                    <span className="font-bold tabular-nums">{mLabel}</span>{' '}
                    <span className="truncate max-w-[8rem] inline-block align-bottom">{getExercise(m.exerciseId)?.name ?? 'Exercise'}</span>{' '}
                    <span className="tabular-nums opacity-70">{mDone}/{mTotal}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* progression coaching cue */}
        {we.coaching && (we.coaching.note || we.coaching.weightDir !== 'same' || we.coaching.repsDir !== 'same') && (
          <div className="mb-3 rounded-xl bg-blaze/[0.08] border border-blaze/[0.22] px-3.5 py-2.5">
            {(we.coaching.note || we.coaching.incWeight) && (
              <div className="text-[13px] font-semibold text-blaze-label leading-snug">
                {/* format the "+X {unit}" from a stored number with the CURRENT unit (not baked) */}
                {we.coaching.incWeight ? `+${fmtWeight(we.coaching.incWeight, unit)}` : ''}
                {we.coaching.incWeight && we.coaching.note ? ' · ' : ''}
                {we.coaching.note}
              </div>
            )}
            <div className="flex items-center gap-3 mt-1">
              <CueBadge label="Reps" dir={we.coaching.repsDir} />
              <CueBadge label="Weight" dir={we.coaching.weightDir} />
            </div>
          </div>
        )}

        {/* plate breakdown for barbell lifts */}
        {plates && (
          <div className="mb-2 text-[11px] text-fg/45">
            {plates.length > 0 ? (
              <>
                <span className="text-fg/30">Load:</span> bar +{' '}
                <span className="text-fg/70">{plates.join(', ')}</span> / side
              </>
            ) : (
              <span className="text-fg/40">Empty bar</span>
            )}
          </div>
        )}

        {/* quick actions — btn-sm keeps them visually compact; tap-min-h-44 lifts the tap height to
            the 44px touch guideline (the move chevrons especially are easy to mis-hit when short) */}
        <div className="flex items-center gap-2 mb-3">
          <Button onClick={() => setSwapOpen(true)} variant="secondary" size="sm" className="tap-min-h-44 flex-1">
            <SwapIcon size={16} /> Swap
          </Button>
          <Button onClick={() => setInfoOpen(true)} variant="secondary" size="sm" className="tap-min-h-44 flex-1">
            <InfoIcon size={16} /> How-to
          </Button>
          <Button
            onClick={() => reorderExercise(exKey, -1)}
            disabled={idx === 0}
            aria-label="Move up"
            variant="secondary"
            size="sm"
            className="tap-min-h-44 px-3"
          >
            <ChevronUp size={16} />
          </Button>
          <Button
            onClick={() => reorderExercise(exKey, 1)}
            disabled={idx === exercises.length - 1}
            aria-label="Move down"
            variant="secondary"
            size="sm"
            className="tap-min-h-44 px-3"
          >
            <ChevronDown size={16} />
          </Button>
        </div>

        {/* column header */}
        <div className="grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_4.25rem] items-center gap-1.5 px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg/35">
          <div>Set</div>
          <div>{isBodyweight ? 'Added' : unit}</div>
          <div>Reps</div>
          <div className="text-center">Done</div>
        </div>

        {/* warm-up toggle (shown by default) */}
        {warmupCount > 0 && (
          <button
            onClick={() => setShowWarmups((v) => !v)}
            className="mb-1 text-[11px] font-medium text-fg/45 active:text-fg/70"
          >
            {showWarmups ? 'Hide' : 'Show'} {warmupCount} warm-up set{warmupCount === 1 ? '' : 's'}
          </button>
        )}

        {/* set rows */}
        <div className="space-y-0.5">
          {we.sets.map((set) => {
            const isW = !!set.warmup
            // 0-based index among working sets (warm-ups don't map to a "last time" set)
            const wIndex = isW ? -1 : workingCounter
            const label = isW ? 'W' : String(++workingCounter)
            if (isW && !showWarmups) return null
            // align by working-set position; if you added sets beyond last time, reuse its last set
            const lastRef =
              !isW && lastSets && lastSets.length ? lastSets[Math.min(wIndex, lastSets.length - 1)] : null
            return (
              <SetRow
                key={set.id}
                set={set}
                label={label}
                unit={unit}
                isBodyweight={isBodyweight}
                ex={ex}
                domId={`set-${set.id}`}
                lastRef={lastRef}
                onApplyLast={
                  lastRef ? () => updateSet(exKey, set.id, { weight: lastRef.weight, reps: lastRef.reps }) : undefined
                }
                onWeight={(weight) => updateSetCascade(exKey, set.id, { weight })}
                onReps={(reps) => updateSetCascade(exKey, set.id, { reps })}
                onToggle={() => {
                  const advancing = !set.done
                  toggleSetDone(exKey, set.id)
                  if (advancing) scrollNextUndoneIntoView(we.sets, set)
                }}
                onRemove={() => removeSet(exKey, set.id)}
              />
            )
          })}
        </div>

        {/* one-tap warm-up ramp — only when there are no warm-ups yet and a working load to ramp toward */}
        {warmupCount === 0 && workingSets.some((s) => s.weight > 0) && (
          <button
            onClick={() => addWarmupSets(exKey)}
            className="mt-3 w-full text-center text-[13px] font-medium text-fg/45 active:text-fg/70 min-h-[44px] flex items-center justify-center gap-1.5"
          >
            <FlameIcon size={14} /> Add warm-up sets
          </button>
        )}

        {/* add set */}
        <button
          onClick={() => addSet(exKey)}
          className={`w-full rounded-xl border border-dashed border-hairline/20 py-2.5 text-sm font-medium text-fg/55 hover:text-fg hover:border-hairline/40 active:scale-[0.99] transition flex items-center justify-center gap-1.5 ${
            warmupCount === 0 && workingSets.some((s) => s.weight > 0) ? 'mt-1' : 'mt-3'
          }`}
        >
          <PlusIcon size={16} /> Add set
        </button>

        {/* effort recap — once the lift is fully logged, surface the recorded reps-in-reserve and let
            the user open the prompt again to change it */}
        {allDone && (
          <button
            onClick={() => setEffortOpen(true)}
            className="mt-3 w-full rounded-xl bg-raised border border-hairline/[0.08] px-3.5 py-2.5 flex items-center justify-between text-left active:scale-[0.99] transition"
          >
            <span className="text-[13px] font-medium text-fg/55">Effort</span>
            <span className="text-[13px] font-semibold text-fg tabular-nums">
              {loggedRir == null ? 'Tap to rate' : `${loggedRir >= 4 ? '4+' : loggedRir} more rep${loggedRir === 1 ? '' : 's'} left`}
            </span>
          </button>
        )}

        {/* remove exercise */}
        <button
          onClick={async () => {
            if (await confirm({ title: `Remove ${name}?`, body: 'It will be taken out of this workout.', confirmLabel: 'Remove', tone: 'danger' })) {
              removeExercise(exKey)
              router.replace('/session')
            }
          }}
          className="mt-6 w-full flex items-center justify-center gap-2 text-sm text-red-400/80 active:text-red-400 py-2"
        >
          <TrashIcon size={16} /> Remove exercise
        </button>
      </main>

      {/* bottom: next / done */}
      <div className="fixed bottom-0 inset-x-0 z-30 mx-auto max-w-md bg-bg/90 backdrop-blur border-t border-hairline/[0.08]">
        <div className="px-5 py-3 safe-bottom">
          <Button onClick={goNext} fullWidth>
            {next ? (
              <>
                {nextIsPartner ? 'Superset → ' : 'Next: '}
                {nextIsPartner ? `${exerciseGroupLabel(exercises, nextIdx)} ` : ''}
                {getExercise(next.exerciseId)?.name ?? 'Exercise'} <ChevronRight size={18} />
              </>
            ) : (
              <>
                <CheckIcon size={18} /> Back to workout
              </>
            )}
          </Button>
        </div>
      </div>

      {/* effort prompt — asked once all sets are logged: reps-in-reserve on the final working set */}
      <Sheet open={effortOpen} onClose={() => setEffortOpen(false)} title="How many more reps could you do?">
        <div className="pt-1">
          <p className="text-[14px] leading-snug text-fg/55">
            On your last set of {name}, how many more reps could you have done?
          </p>
          <div className="mt-4 grid grid-cols-5 gap-2">
            {[0, 1, 2, 3, 4].map((rir) => {
              const active = loggedRir != null && (rir === 4 ? loggedRir >= 4 : loggedRir === rir)
              return (
                <button
                  key={rir}
                  type="button"
                  onClick={() => {
                    setExerciseEffort(exKey, rir)
                    setEffortOpen(false)
                  }}
                  aria-pressed={active}
                  aria-label={`${rir === 4 ? '4 or more' : rir} more reps`}
                  className={`h-14 rounded-xl text-lg font-bold tabular-nums transition active:scale-90 ${
                    active
                      ? 'bg-blaze/[0.15] text-blaze-label border border-blaze/40'
                      : 'bg-raised text-fg/70 border border-hairline/[0.08] active:text-fg'
                  }`}
                >
                  {rir === 4 ? '4+' : rir}
                </button>
              )
            })}
          </div>
          <p className="mt-3 text-center text-xs text-fg/40">0 = couldn’t do another · 4+ = plenty left in the tank</p>
        </div>
      </Sheet>

      {/* swap picker */}
      <ExercisePicker
        open={swapOpen}
        onClose={() => setSwapOpen(false)}
        onPick={onSwapPick}
        exclude={existingIds}
        title="Swap Exercise"
        equipment={pickerEquipment}
        defaultMuscle={ex?.primary[0]}
      />

      {/* swap scope: one-time vs replace-in-active-plan (plan lifts only) */}
      <Sheet
        open={pendingSwap !== null}
        onClose={() => setPendingSwap(null)}
        title={`Swap to ${getExercise(pendingSwap ?? '')?.name ?? 'this exercise'}?`}
      >
        {pendingSwap && (
          <div className="pt-1">
            <p className="text-[15px] leading-snug text-fg/70">
              {doneWorking > 0
                ? `Your ${doneWorking} logged set${doneWorking === 1 ? '' : 's'} will carry over. `
                : ''}
              Use it just for today, or for every {name} day on this plan from now on?
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              <Button onClick={() => applySwap(pendingSwap, true)} fullWidth>
                <SwapIcon size={18} /> Replace in my plan
              </Button>
              <Button onClick={() => applySwap(pendingSwap, false)} variant="secondary" fullWidth>
                Just this time
              </Button>
            </div>
            <p className="mt-3 text-center text-xs text-fg/40">
              Applies while you follow this plan — your saved plan isn’t changed.
            </p>
          </div>
        )}
      </Sheet>

      {/* info sheet */}
      <Sheet open={infoOpen} onClose={() => setInfoOpen(false)} title={name}>
        {ex ? (
          <div className="pt-1 space-y-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-fg/40 mb-2">How to perform</div>
              <ol className="space-y-2">
                {ex.instructions.map((step, i) => (
                  <li key={i} className="flex gap-3 text-[15px] text-fg/80">
                    <span className="shrink-0 grid place-items-center h-6 w-6 rounded-full bg-blaze/[0.12] text-blaze-label text-xs font-bold tabular-nums">
                      {i + 1}
                    </span>
                    <span className="leading-snug">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-fg/40 mb-2">Muscles</div>
              <div className="flex flex-wrap gap-1.5">
                {ex.primary.map((m) => (
                  <span key={m} className="pill bg-blaze/[0.12] text-blaze-label">
                    {muscleLabel(m)}
                  </span>
                ))}
                {ex.secondary.map((m) => (
                  <span key={m} className="pill bg-raised text-fg/60">
                    {muscleLabel(m)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-fg/40 text-sm py-6 text-center">No details available.</div>
        )}
      </Sheet>
    </div>
  )
}

function CueBadge({ label, dir }: { label: string; dir: Dir }) {
  const arrow = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→'
  const tone =
    dir === 'up'
      ? 'bg-recovery-fresh/[0.18] text-recovery-fresh'
      : dir === 'down'
        ? 'bg-recovery-moderate/15 text-recovery-moderate'
        : 'bg-raised text-fg/50'
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-fg/55">
      {label}
      <span className={`grid place-items-center h-4 w-4 rounded-full text-[11px] font-bold ${tone}`}>{arrow}</span>
    </span>
  )
}
