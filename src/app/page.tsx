'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Equipment, MuscleGroup } from '@/types'
import { useStore, resolvePlan } from '@/store/useStore'
import { computeRecovery, freshnessFromFatigue, recoveryLabel, recoveryToken } from '@/lib/recovery'
import { generateWorkout } from '@/lib/generator'
import { injuryConstraints, isBlockedByInjury } from '@/lib/injuries'
import { resolvePlanLifts } from '@/lib/substitution'
import { computeWeeklyStreak, localWeek } from '@/lib/stats'
import { fmtDate, fmtDuration, fmtWeight } from '@/lib/format'
import { ALL_MUSCLES, MUSCLES } from '@/data/muscles'
import { dayFocusMuscles, planEquipment } from '@/data/plans'
import { getExercise } from '@/data/exercises'
import { Button } from '@/components/ui/Button'
import { BlazeHeroCard, type HeroChip, type HeroExercise } from '@/components/ui/BlazeHeroCard'
import { RecoveryRing } from '@/components/ui/RecoveryRing'
import { RecoveryBar } from '@/components/ui/RecoveryBar'
import { StatTile } from '@/components/ui/StatTile'
import { useConfirm } from '@/components/ConfirmProvider'
import SwitchWorkoutSheet from '@/components/SwitchWorkoutSheet'
import TrialBanner from '@/components/TrialBanner'
import { PlayIcon, PlusIcon, RefreshIcon, FlameIcon, TargetIcon, ChevronRight } from '@/components/icons'

const DAY = 1000 * 60 * 60 * 24

// Monotonic seed for free re-rolls ("Build", "Rebuild", "New workout", "Target muscles"). Module-scoped
// (not component state) so it survives HomeScreen unmount/remount across navigation — otherwise every
// rebuild would reuse seed 1 and return the same workout. The generator's jitter is keyed on `shuffle`.
let freeBuildSeed = 0

function greeting(now: number): string {
  const h = new Date(now).getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/** A short label for the user's equipment profile, shown on the workout card. */
function gymLabel(equipment: string[]): string {
  if (equipment.includes('barbell') && (equipment.includes('machine') || equipment.includes('cable')))
    return 'Full Gym'
  if (equipment.includes('barbell') || equipment.includes('dumbbell')) return 'Home Gym'
  return 'Bodyweight'
}

export default function HomeScreen() {
  const router = useRouter()
  const confirm = useConfirm()
  const profile = useStore((s) => s.profile)
  const workouts = useStore((s) => s.workouts)
  const current = useStore((s) => s.current)
  const generate = useStore((s) => s.generate)
  const discardCurrent = useStore((s) => s.discardCurrent)
  const activePlan = useStore((s) => s.activePlan)
  const customPlans = useStore((s) => s.customPlans)
  const generateFromPlan = useStore((s) => s.generateFromPlan)
  const generateFromPlanDay = useStore((s) => s.generateFromPlanDay)
  const skipPlanDay = useStore((s) => s.skipPlanDay)
  const startWorkout = useStore((s) => s.startWorkout)

  const [switchOpen, setSwitchOpen] = useState(false)

  const now = Date.now()
  // a stable timestamp for previewing a generated session, so the plan hero's fallback preview
  // doesn't re-roll its exercises on every render
  const [genNow] = useState(() => Date.now())

  const fresh = useMemo(() => {
    const fatigue = computeRecovery(workouts, now)
    return freshnessFromFatigue(fatigue)
  }, [workouts, now])

  const overallReadiness = useMemo(() => {
    const total = ALL_MUSCLES.reduce((sum, m) => sum + fresh[m], 0)
    return Math.round(total / ALL_MUSCLES.length)
  }, [fresh])


  const stats = useMemo(() => {
    const completed = workouts.filter((w) => w.status === 'completed')
    const completionTimes = completed.map((w) => w.completedAt ?? w.date)
    const thisWeek = completionTimes.filter((ts) => ts <= now && now - ts <= 7 * DAY).length
    // calendar-week count (Mon-aligned, matches the streak) for the adherence chip
    const weekDone = completionTimes.filter((ts) => localWeek(ts) === localWeek(now)).length
    return {
      thisWeek,
      weekDone,
      total: completed.length,
      streak: computeWeeklyStreak(completionTimes, now),
    }
  }, [workouts, now])

  const name = profile.name.trim() || 'Athlete'

  const plan = activePlan ? resolvePlan(activePlan.planId, customPlans) : undefined
  const planDay = plan ? plan.schedule[activePlan!.dayIndex % plan.schedule.length] : undefined
  const onPlan = !!(plan && planDay)
  const planDayNum = onPlan ? (activePlan!.dayIndex % plan!.schedule.length) + 1 : 0
  // weekly training target: the plan's frequency when on a plan, else the onboarding preference
  const weeklyTarget = Math.max(1, onPlan ? plan!.daysPerWeek : profile.daysPerWeek ?? 3)
  const weekMet = stats.weekDone >= weeklyTarget
  // does the in-progress session belong to the active plan's current day?
  const currentIsPlanDay = !!(
    current &&
    activePlan &&
    current.planId === activePlan.planId &&
    current.planDayLabel === planDay?.label
  )

  // A one-tap preview of today's plan day. It must mirror what `Start` (generateFromPlan) ACTUALLY
  // builds, or the hero looks broken: for a bodyweight user on a barbell plan day, the explicit lifts
  // resolve to nothing, but generateFromPlan falls back to a recovery-aware session from the day's
  // focus — so the preview falls back the same way (showing real, equippable exercises) instead of
  // an empty "your gear doesn't fit this day's lifts" hero.
  const planPreviewData = useMemo<{
    items: { exerciseId: string; name: string; detail: string }[]
    adapted: boolean
  }>(() => {
    if (!onPlan || !planDay || !plan) return { items: [], adapted: false }
    // 1) the program's explicit lifts, equipment-substituted (distinct). Use them only when they
    //    didn't collapse heavily — mirrors generateFromPlan so the preview matches what Start builds.
    if (planDay.lifts?.length) {
      const owned = new Set<Equipment>([...profile.equipment, 'bodyweight'])
      let resolved = resolvePlanLifts(planDay.lifts, owned, planDay.goal ?? profile.goal).resolved
      // mirror the build (resolveDayLifts): on plan days, drop lifts the user opted to work around in plans
      const previewConstraints = injuryConstraints(profile, { surface: 'plan' })
      if (previewConstraints.hasConstraints) {
        resolved = resolved.filter(({ exerciseId }) => {
          const ex = getExercise(exerciseId)
          return !ex || !isBlockedByInjury(ex, previewConstraints)
        })
      }
      if (resolved.length >= Math.min(3, planDay.lifts.length)) {
        return {
          adapted: false,
          items: resolved.map(({ lift, exerciseId }) => ({
            exerciseId,
            name: getExercise(exerciseId)?.name ?? 'Exercise',
            detail: `${lift.sets} × ${lift.repMin}–${lift.repMax}`,
          })),
        }
      }
    }
    // 2) explicit lifts don't equip / collapsed → preview the focus-based fallback Start will build
    if (planDay.focus.length === 0) return { items: [], adapted: false }
    const fallback = generateWorkout(profile, workouts, genNow, {
      focusOverride: dayFocusMuscles(planDay.focus),
      equipmentOverride: planEquipment(plan),
      goalOverride: planDay.goal,
      // mirror generateFromPlan's fallback so the preview matches the build
      surface: 'plan',
    })
    return {
      adapted: !!planDay.lifts?.length, // had named lifts but none equipped → adapted to gear
      items: fallback.exercises.map((we) => {
        const working = we.sets.filter((s) => !s.warmup)
        return {
          exerciseId: we.exerciseId,
          name: getExercise(we.exerciseId)?.name ?? 'Exercise',
          detail: `${working.length} × ${we.targetReps[0]}–${we.targetReps[1]}`,
        }
      }),
    }
  }, [onPlan, planDay, plan, profile, workouts, genNow])
  const planPreview = planPreviewData.items
  const planAdapted = planPreviewData.adapted

  const muscleCount = current
    ? new Set(current.exercises.flatMap((e) => getExercise(e.exerciseId)?.primary ?? [])).size
    : 0
  // same "{n} exercises · {m} muscles" meta for the plan-day hero as the session hero
  const planMuscleCount = useMemo(
    () => new Set(planPreview.flatMap((p) => getExercise(p.exerciseId)?.primary ?? [])).size,
    [planPreview],
  )
  // estimated session length — prefer the generator's stored estimate, else ~11 min/exercise
  const estDuration = (n: number) => Math.max(11, n * 11)

  // ---- Today hero (Charge/Blaze "PUSH DAY" design) data ----
  // shared status chips: equipment · weekly adherence · streak
  const heroChips: HeroChip[] = [
    { label: gymLabel(profile.equipment) },
    { label: `${stats.weekDone}/${weeklyTarget} week` },
    ...(stats.streak > 0 ? [{ label: `${stats.streak} wk`, icon: <FlameIcon size={11} /> }] : []),
  ]
  // in-progress session → numbered exercise rows (focus lift first), compact "N × a–b · weight" detail
  const sessionExercises: HeroExercise[] = (current?.exercises ?? []).slice(0, 4).map((we, i) => {
    const ex = getExercise(we.exerciseId)
    const working = we.sets.filter((s) => !s.warmup)
    const topW = working.reduce((m, s) => Math.max(m, s.weight), 0)
    const bw = ex?.equipment.includes('bodyweight') && topW === 0
    return {
      name: ex?.name ?? 'Exercise',
      detail: `${working.length} × ${we.targetReps[0]}–${we.targetReps[1]}${topW > 0 ? ' · ' + fmtWeight(topW, profile.unit) : bw ? ' · BW' : ''}`,
      focus: i === 0,
    }
  })
  // plan-day preview → same row shape (no logged weight yet)
  const planExercises: HeroExercise[] = planPreview
    .slice(0, 4)
    .map((p, i) => ({ name: p.name, detail: p.detail, focus: i === 0 }))

  // recovery card: average freshness per body region → the mockup's 4 bars (Push/Pull/Legs/Core)
  const REGION_LABELS = { push: 'Push', pull: 'Pull', legs: 'Legs', core: 'Core' } as const
  const regionBars = (['push', 'pull', 'legs', 'core'] as const).map((region) => {
    const ms = ALL_MUSCLES.filter((m) => MUSCLES[m].region === region)
    const avg = ms.length ? ms.reduce((s, m) => s + fresh[m], 0) / ms.length : 0
    return { label: REGION_LABELS[region], pct: avg, tone: recoveryToken(avg) }
  })

  const buildAndGo = async (override?: MuscleGroup[]) => {
    if (current) {
      const hasLogged =
        current.status === 'active' || current.exercises.some((we) => we.sets.some((s) => s.done))
      // An untouched, not-yet-started session (e.g. the one auto-generated at onboarding) holds no
      // work to lose, so replace it silently — a first-time user tapping a Recommended Focus pill,
      // which the copy invites, shouldn't hit a "Replace workout?" dialog before logging anything.
      if (
        hasLogged &&
        !(await confirm({
          title: 'Replace workout?',
          body: 'Your in-progress workout will be replaced with a new one. Logged sets will be lost.',
          confirmLabel: 'Replace',
          tone: 'danger',
        }))
      )
        return
    }
    generate({ ...(override ? { focusOverride: override } : {}), shuffle: ++freeBuildSeed })
    router.push('/session')
  }

  const startPlanWorkout = async () => {
    // already mid-session on THIS plan day — resume it instead of discarding logged work
    if (
      current &&
      activePlan &&
      current.planId === activePlan.planId &&
      current.planDayLabel === planDay?.label
    ) {
      router.push('/session')
      return
    }
    if (current) {
      const hasLogged =
        current.status === 'active' || current.exercises.some((we) => we.sets.some((s) => s.done))
      if (
        !(await confirm(
          hasLogged
            ? {
                title: 'Replace workout?',
                body: 'Your in-progress workout will be replaced with this plan day. Logged sets will be lost.',
                confirmLabel: 'Replace',
                tone: 'danger',
              }
            : {
                title: 'Replace workout?',
                body: 'Your current workout will be replaced with this plan day.',
                confirmLabel: 'Replace',
              },
        ))
      )
        return
    }
    // one tap from Home = today's workout actually started (timer running), not a second "Start"
    generateFromPlan()
    startWorkout()
    router.push('/session')
  }

  /** Build a chosen plan-schedule day (from the Switch picker) and open it, confirming a replace if
   *  there's logged work to lose. Lands on the planned session so the user can review then Start. */
  const switchToPlanDay = async (dayIndex: number) => {
    if (current) {
      const hasLogged =
        current.status === 'active' || current.exercises.some((we) => we.sets.some((s) => s.done))
      if (
        hasLogged &&
        !(await confirm({
          title: 'Replace workout?',
          body: 'Your in-progress workout will be replaced with this plan day. Logged sets will be lost.',
          confirmLabel: 'Replace',
          tone: 'danger',
        }))
      )
        return
    }
    generateFromPlanDay(dayIndex)
    router.push('/session')
  }

  /** Resume an active session, or START a built-but-not-yet-started one (timer running). */
  const openCurrent = () => {
    if (current && current.status !== 'active') startWorkout()
    router.push('/session')
  }

  /** Skip the current plan day, warning that it advances the schedule (and detaches a tied session). */
  const confirmSkip = async () => {
    const tied = currentIsPlanDay
    if (
      await confirm({
        title: `Skip ${planDay?.title ?? 'this day'}?`,
        body: tied
          ? 'This moves you to the next plan day. Your in-progress workout will be kept but no longer count toward the plan.'
          : 'This moves you to the next plan day in the schedule.',
        confirmLabel: 'Skip day',
      })
    )
      skipPlanDay()
  }

  return (
    <div className="animate-fade-in">
      {/* ---- Header ---- */}
      <header className="px-5 pt-4 safe-top">
        <div className="text-xs text-fg/40">{fmtDate(now)}</div>
        <h1 className="text-[22px] font-extrabold leading-tight mt-0.5">
          {greeting(now)}, {name}
        </h1>
      </header>

      <div className="px-5 mt-4 space-y-4">
        {/* ---- Free-trial nudge (only while trialing & not yet subscribed) ---- */}
        <TrialBanner />

        {/* ---- Today's Workout: the one-tap hero (plan day leads when on a plan) ---- */}
        {current ? (
          <BlazeHeroCard
            eyebrow={`Today${currentIsPlanDay && plan ? ` · ${plan.name} · Day ${planDayNum}/${plan.schedule.length}` : ''}`}
            title={current.title}
            meta={
              current.exercises.length > 0
                ? `${current.exercises.length} exercise${current.exercises.length === 1 ? '' : 's'} · ${muscleCount} muscle${muscleCount === 1 ? '' : 's'} · ~${fmtDuration(current.durationMin ?? estDuration(current.exercises.length))}`
                : undefined
            }
            chips={heroChips}
            onSwitch={() => setSwitchOpen(true)}
            exercises={sessionExercises}
            extraCount={Math.max(0, current.exercises.length - 4)}
            onExerciseClick={() => router.push('/session')}
            description={current.exercises.length === 0 ? 'No exercises yet — add some to get started.' : undefined}
            cta={
              current.exercises.length === 0
                ? { label: 'Add exercises', onClick: () => router.push('/session'), icon: <PlusIcon size={18} /> }
                : {
                    label: current.status === 'active' ? 'Continue' : 'Start',
                    onClick: openCurrent,
                    icon: <PlayIcon size={18} />,
                  }
            }
            footer={
              <button
                onClick={async () => {
                  const hasLogged =
                    current.status === 'active' || current.exercises.some((we) => we.sets.some((s) => s.done))
                  if (
                    hasLogged &&
                    !(await confirm({
                      title: 'Discard workout?',
                      body: 'This workout will be removed without being saved. Logged sets will be lost.',
                      confirmLabel: 'Discard',
                      tone: 'danger',
                    }))
                  )
                    return
                  discardCurrent()
                }}
                className="w-full text-center text-sm text-fg/40 mt-2 min-h-[44px] py-2 active:text-fg/60"
              >
                Discard workout
              </button>
            }
          />
        ) : onPlan ? (
          /* on a plan with no session yet → today's plan day IS today's workout: one tap to Start */
          <BlazeHeroCard
            eyebrow={`Today · ${plan!.name} · Day ${planDayNum}/${plan!.schedule.length}`}
            title={planDay!.title}
            meta={
              planPreview.length > 0
                ? `${planPreview.length} exercise${planPreview.length === 1 ? '' : 's'} · ${planMuscleCount} muscle${planMuscleCount === 1 ? '' : 's'} · ~${fmtDuration(estDuration(planPreview.length))}${planAdapted ? ' · adapted' : ''}`
                : undefined
            }
            chips={heroChips}
            onSwitch={() => setSwitchOpen(true)}
            exercises={planExercises}
            extraCount={Math.max(0, planPreview.length - 4)}
            description={
              planPreview.length === 0
                ? "We can't build this day with your gear — add equipment in Settings, or build a free workout."
                : undefined
            }
            cta={
              planPreview.length > 0
                ? { label: 'Start', onClick: startPlanWorkout, icon: <PlayIcon size={18} /> }
                : { label: 'Build a free workout', onClick: () => buildAndGo(), icon: <PlusIcon size={18} /> }
            }
            footer={
              <button
                onClick={confirmSkip}
                className="w-full text-center text-sm text-fg/40 mt-2 min-h-[44px] py-2 active:text-fg/60"
              >
                Skip to next day
              </button>
            }
          />
        ) : (
          /* no plan, no session → build a recovery-aware one */
          <BlazeHeroCard
            eyebrow="Today's Workout"
            title="Ready when you are"
            chips={heroChips}
            onSwitch={() => setSwitchOpen(true)}
            switchLabel="Options"
            description="We'll build a fresh session around how recovered each muscle is — targeting what's ready and resting what isn't."
            cta={{ label: "Build today's workout", onClick: () => buildAndGo(), icon: <PlusIcon size={18} /> }}
          />
        )}

        {/* ---- Plan entry — clear, tappable way to find/manage a plan from Home ---- */}
        {onPlan ? (
          <section className="card px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-medium text-fg/45">
                  <TargetIcon size={14} className="text-blaze-label" /> Following {plan!.name}
                </div>
                <div className="text-sm text-fg/70 mt-0.5 truncate">
                  {currentIsPlanDay || !current
                    ? `Day ${planDayNum} of ${plan!.schedule.length}`
                    : `Plan day up next · ${planDay!.title}`}
                </div>
              </div>
              <button
                onClick={() => router.push('/plans')}
                className="shrink-0 text-xs font-semibold text-blaze-label active:text-blaze-warm inline-flex items-center gap-0.5"
              >
                Change <ChevronRight size={13} />
              </button>
            </div>
            {current && !currentIsPlanDay && (
              <Button onClick={startPlanWorkout} variant="secondary" fullWidth className="mt-3">
                <PlayIcon size={16} /> Start {planDay!.title} instead
              </Button>
            )}
            {current && (
              <button
                onClick={confirmSkip}
                className="w-full text-center text-xs text-fg/35 mt-1.5 min-h-[44px] py-2 active:text-fg/60"
              >
                Skip to next day
              </button>
            )}
          </section>
        ) : (
          <button
            onClick={() => router.push('/plans')}
            className="card w-full p-4 flex items-center gap-4 text-left active:scale-[0.99] transition"
          >
            <span className="grid place-items-center h-12 w-12 rounded-xl bg-blaze/15 text-blaze-label shrink-0">
              <TargetIcon size={24} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-bold">Follow a Plan</div>
              <p className="text-sm text-fg/50">Push/Pull/Legs, Upper/Lower, Full Body and more.</p>
            </div>
            <ChevronRight size={20} className="text-fg/35 shrink-0" />
          </button>
        )}

        {/* ---- Recovery ---- */}
        <section className="card p-5">
          {/* recovery summary — conic ring + per-region bars (Charge/Blaze recovery card) */}
          <div className="flex items-center gap-4">
            <RecoveryRing
              pct={overallReadiness}
              tone={recoveryToken(overallReadiness)}
              label={recoveryLabel(overallReadiness)}
            />
            <div className="min-w-0 flex-1">
              <div className="mb-2.5 text-[11px] font-extrabold uppercase tracking-[0.1em] text-fg/40">Recovery</div>
              <div className="flex flex-col gap-2">
                {regionBars.map((b) => (
                  <RecoveryBar key={b.label} label={b.label} pct={b.pct} tone={b.tone} />
                ))}
              </div>
            </div>
          </div>

        </section>

        {/* ---- Stats strip (warm first-run copy instead of three zeros) ---- */}
        {stats.total === 0 ? (
          <section className="card px-5 py-4 flex items-center gap-3">
            <span className="grid place-items-center h-10 w-10 rounded-xl bg-blaze/[0.12] text-blaze-warm shrink-0">
              <FlameIcon size={20} />
            </span>
            <div className="min-w-0">
              <div className="font-semibold">Your first workout starts it all</div>
              <p className="text-sm text-fg/50">Finish a session to begin your streak and track progress.</p>
            </div>
          </section>
        ) : (
          <section className="grid grid-cols-3 gap-2.5">
            <StatTile value={stats.thisWeek} label="Last 7 days" accent />
            <StatTile value={stats.total} label={stats.total === 1 ? 'Workout' : 'Workouts'} />
            <StatTile value={stats.streak} label={stats.streak === 1 ? 'Week streak' : 'Week streak'} />
          </section>
        )}

        {/* ---- Regenerate shortcut ---- */}
        {current && (
          <button
            onClick={() => buildAndGo()}
            className="w-full flex items-center justify-center gap-2 text-sm text-fg/45 py-2 active:text-fg/70"
          >
            <RefreshIcon size={15} /> Rebuild a fresh workout
          </button>
        )}
      </div>

      <SwitchWorkoutSheet
        open={switchOpen}
        onClose={() => setSwitchOpen(false)}
        fresh={fresh}
        onPickPlanDay={switchToPlanDay}
        onNewWorkout={() => buildAndGo()}
        onPickSaved={() => router.push('/history')}
        onPickMuscles={(muscles) => buildAndGo(muscles)}
      />
    </div>
  )
}

