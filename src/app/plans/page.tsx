'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Equipment } from '@/types'
import { useStore } from '@/store/useStore'
import { useConfirm } from '@/components/ConfirmProvider'
import Sheet from '@/components/Sheet'
import { getExercise } from '@/data/exercises'
import { isExerciseDoable } from '@/lib/equipment'
import { emitToast } from '@/lib/toast'
import { getPlan, planFrequencies, planScheduleSummary, type WorkoutPlan, type EquipmentContext } from '@/data/plans'
import { usePlansStore } from '@/lib/plansRemote'
import { recommendPlans, profileEquipmentContext, type PlanMatch } from '@/lib/planMatch'
import { Button } from '@/components/ui/Button'
import { Chip, ChipTag } from '@/components/ui/Chip'
import { ChevronLeft, CheckIcon, TargetIcon, PlayIcon, XIcon, PlusIcon, ChevronRight, TrashIcon, SearchIcon, RefreshIcon, DumbbellIcon, SettingsIcon } from '@/components/icons'

const EQUIPMENT_LABEL: Record<Equipment, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbells',
  machine: 'Machines',
  cable: 'Cable',
  kettlebell: 'Kettlebell',
  bodyweight: 'Bodyweight',
  bands: 'Bands',
  pullupbar: 'Pull-up bar',
  bench: 'Bench',
  ezbar: 'EZ bar',
}

/** Equipment the plan's lifts need that the user lacks, plus how much of the plan can't be done. */
function planEquipmentGap(
  plan: WorkoutPlan,
  owned: Set<Equipment>,
): { missing: Equipment[]; undoableRatio: number } {
  const needed = new Set<Equipment>()
  let undoable = 0
  let total = 0
  for (const day of plan.schedule) {
    for (const lift of day.lifts ?? []) {
      const ex = getExercise(lift.exerciseId)
      if (!ex) continue
      total += 1
      if (isExerciseDoable(ex, owned)) continue
      undoable += 1
      for (const eq of ex.equipment) {
        if (eq !== 'bodyweight' && !owned.has(eq)) needed.add(eq)
      }
    }
  }
  return { missing: [...needed], undoableRatio: total ? undoable / total : 0 }
}

type DayFilter = 'any' | number
type EquipFilter = 'any' | EquipmentContext

const EQUIP_FILTERS: { id: EquipFilter; label: string }[] = [
  { id: 'any', label: 'Any' },
  { id: 'full-gym', label: 'Full gym' },
  { id: 'home-dumbbell', label: 'Home' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'bodyweight', label: 'Bodyweight' },
]

function contextOf(p: WorkoutPlan): EquipmentContext {
  if (p.equipmentContext) return p.equipmentContext
  if (p.equipment === 'Bodyweight') return 'bodyweight'
  if (p.equipment === 'Minimal') return 'home-dumbbell'
  return 'full-gym'
}

function EvidenceBadge({ tier }: { tier: WorkoutPlan['evidenceTier'] }) {
  if (!tier) return null
  if (tier === 'popular-weak-evidence')
    return <span className="pill bg-amber-500/15 border border-amber-500/30 text-amber-300">limited evidence</span>
  if (tier === 'popular-reasonable') return <ChipTag variant="neutral">community-tested</ChipTag>
  return <ChipTag variant="recovery">evidence-based</ChipTag>
}

export default function PlansScreen() {
  const router = useRouter()
  const confirm = useConfirm()
  const activePlan = useStore((s) => s.activePlan)
  const startPlan = useStore((s) => s.startPlan)
  const stopPlan = useStore((s) => s.stopPlan)
  const generateFromPlan = useStore((s) => s.generateFromPlan)
  const startWorkout = useStore((s) => s.startWorkout)
  const deleteCustomPlan = useStore((s) => s.deleteCustomPlan)
  const duplicatePlan = useStore((s) => s.duplicatePlan)
  const current = useStore((s) => s.current)
  const customPlans = useStore((s) => s.customPlans)
  const planProgress = useStore((s) => s.planProgress)
  const profile = useStore((s) => s.profile)
  const updateProfile = useStore((s) => s.updateProfile)
  // bundled catalogue overlaid by any DB-managed plans (offline-first; bundled until remote loads)
  const catalogue = usePlansStore((s) => s.catalogue)

  const [dayFilter, setDayFilter] = useState<DayFilter>('any')
  // Seed the equipment filter from the user's gear so the default catalogue view is already relevant
  // (a 'Show all' reset clears it). Lazy init reads the persisted profile once on mount.
  const [equipFilter, setEquipFilter] = useState<EquipFilter>(() => profileEquipmentContext(profile.equipment))
  const [query, setQuery] = useState('')
  // when starting a plan the user has progressed in, ask resume vs restart
  const [resumeChoice, setResumeChoice] = useState<{ planId: string; name: string; day: number } | null>(null)
  // when starting a plan that needs equipment the user doesn't have, offer to add it or adapt
  const [equipGap, setEquipGap] = useState<{ planId: string; name: string; missing: Equipment[] } | null>(null)

  const ownedEquipment = useMemo(() => new Set<Equipment>([...profile.equipment, 'bodyweight']), [profile.equipment])

  // Top profile matches — a curated shortcut above the full catalogue, independent of the browse filters.
  const recommended = useMemo(() => recommendPlans(catalogue, profile, { limit: 3 }), [profile, catalogue])

  const resolve = (id: string) => customPlans.find((p) => p.id === id) ?? getPlan(id)
  const active = activePlan ? resolve(activePlan.planId) : undefined
  const activeDay =
    active && activePlan ? active.schedule[activePlan.dayIndex % active.schedule.length] : undefined

  const q = query.trim().toLowerCase()
  const match = (p: WorkoutPlan) =>
    (dayFilter === 'any' || planFrequencies(p).includes(dayFilter)) &&
    (equipFilter === 'any' || contextOf(p) === equipFilter) &&
    (q === '' ||
      [p.name, p.tagline, p.description, p.author ?? '', p.level].some((f) =>
        f.toLowerCase().includes(q),
      ))

  const builtIn = useMemo(() => catalogue.filter(match), [catalogue, dayFilter, equipFilter, q])
  const customMatch = useMemo(() => customPlans.filter(match), [customPlans, dayFilter, equipFilter, q])

  const beginPlan = (planId: string, restart: boolean) => {
    startPlan(planId, restart)
    setResumeChoice(null)
    router.push('/')
  }

  // resume/switch/start, AFTER any equipment-gap prompt has been handled
  const proceedStart = async (planId: string) => {
    const target = resolve(planId)
    const name = target?.name ?? 'this plan'
    const savedDay = planProgress[planId] ?? 0
    const resumable = !!target && savedDay > 0 && savedDay < target.schedule.length

    // Plan you've progressed in → let the user choose Resume vs Start over.
    if (resumable) {
      setResumeChoice({ planId, name, day: savedDay })
      return
    }
    // Switching from a different plan to a NEW one → confirm (the old plan's progress is saved).
    if (activePlan && activePlan.planId !== planId) {
      if (
        !(await confirm({
          title: `Switch to ${name}?`,
          body: "You'll start at Day 1. Your current plan's progress is saved if you come back.",
          confirmLabel: 'Switch',
        }))
      )
        return
    }
    startPlan(planId)
    router.push('/')
  }

  const handleStart = async (planId: string) => {
    const target = resolve(planId)
    // Notify if the plan needs equipment the user doesn't have (and would heavily adapt) → offer to
    // add the gear for them, open Settings, or continue adapting to bodyweight.
    if (target) {
      const { missing, undoableRatio } = planEquipmentGap(target, ownedEquipment)
      if (missing.length > 0 && undoableRatio >= 0.34) {
        setEquipGap({ planId, name: target.name, missing })
        return
      }
    }
    proceedStart(planId)
  }

  const addMissingEquipment = (missing: Equipment[]) => {
    const merged = Array.from(new Set<Equipment>([...profile.equipment, ...missing]))
    updateProfile({ equipment: merged })
    emitToast(`Added ${missing.map((e) => EQUIPMENT_LABEL[e]).join(', ')} to your equipment`)
  }

  const startTodaysPlanWorkout = async () => {
    // already on a session for THIS plan day — resume it, and start the clock if it
    // was only built (Home behaves the same: tapping "Start" means the workout is underway)
    if (
      current &&
      activePlan &&
      current.planId === activePlan.planId &&
      current.planDayLabel === activeDay?.label
    ) {
      if (current.status !== 'active') startWorkout()
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
    // one tap from Plans = today's workout actually started (timer running), matching Home
    generateFromPlan()
    startWorkout()
    router.push('/session')
  }

  const Card = ({ p }: { p: WorkoutPlan }) => {
    const isActive = activePlan?.planId === p.id
    const gap = planEquipmentGap(p, ownedEquipment)
    const needsGear = gap.missing.length > 0 && gap.undoableRatio >= 0.34
    return (
      <section className={`card p-5 ${isActive ? 'border-blaze/40' : ''}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-black uppercase leading-tight">{p.name}</h3>
            <p className="text-sm text-fg/55 mt-1">{p.tagline}</p>
          </div>
          <span className="grid place-items-center h-10 w-10 rounded-xl bg-blaze/15 text-blaze-label shrink-0">
            <TargetIcon size={20} />
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-3">
          <ChipTag variant="neutral">{planScheduleSummary(p)}</ChipTag>
          <ChipTag variant="neutral"><span className="capitalize">{p.level}</span></ChipTag>
          <ChipTag variant="neutral">{p.equipment}</ChipTag>
          <EvidenceBadge tier={p.evidenceTier} />
          {needsGear && (
            <span className="pill bg-amber-400/12 border border-amber-400/30 text-amber-300" title={`Needs ${gap.missing.map((e) => EQUIPMENT_LABEL[e]).join(', ')}`}>
              <DumbbellIcon size={12} /> needs gear
            </span>
          )}
        </div>

        <p className="text-sm text-fg/50 mt-3">{p.description}</p>

        <div className="mt-3 space-y-1.5">
          {p.schedule.map((d, i) => (
            <div key={`${d.label}-${i}`} className="flex items-center gap-2 text-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-blaze-warm shrink-0" />
              <span className="text-fg/75">{d.title}</span>
              {d.lifts && d.lifts.length > 0 && (
                <span className="text-fg/35 text-xs">· {d.lifts.length} lifts</span>
              )}
            </div>
          ))}
        </div>

        <div className="flex gap-2 mt-4">
          <Button
            onClick={() => handleStart(p.id)}
            disabled={isActive}
            variant={isActive ? 'secondary' : 'primary'}
            className="flex-1"
          >
            {isActive ? (
              <>
                <CheckIcon size={18} /> Following
              </>
            ) : (
              'Start Plan'
            )}
          </Button>
          {!p.custom && (
            <Button
              onClick={() => {
                const newId = duplicatePlan(p.id)
                if (newId) {
                  // duplicatePlan makes an editable copy — tell the user the original is untouched
                  emitToast('Created an editable copy')
                  router.push(`/plans/builder?edit=${newId}`)
                }
              }}
              variant="secondary"
              className="px-4"
              aria-label={`Customize ${p.name}`}
            >
              Customize
            </Button>
          )}
          {p.custom && (
            <>
              <Button
                onClick={() => router.push(`/plans/builder?edit=${p.id}`)}
                variant="secondary"
                className="px-4"
                aria-label={`Edit ${p.name}`}
              >
                Edit
              </Button>
              <Button
                onClick={async () => {
                  if (
                    await confirm({
                      title: `Delete "${p.name}"?`,
                      body: "This custom plan will be removed. This can't be undone.",
                      confirmLabel: 'Delete',
                      tone: 'danger',
                    })
                  )
                    deleteCustomPlan(p.id)
                }}
                variant="secondary"
                className="px-3 !text-red-300"
                aria-label={`Delete ${p.name}`}
              >
                <TrashIcon size={16} />
              </Button>
            </>
          )}
        </div>
      </section>
    )
  }

  // Compact card for the "Recommended for you" shortcut — name, fit reasons, and a one-tap Start.
  const RecommendedCard = ({ m }: { m: PlanMatch }) => {
    const p = m.plan
    const isActive = activePlan?.planId === p.id
    return (
      <section className="card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-bold leading-tight truncate">{p.name}</h3>
            <p className="text-xs text-fg/50 mt-0.5 truncate">{p.tagline}</p>
            <div className="flex flex-wrap gap-1 mt-2">
              <ChipTag variant="neutral">{planScheduleSummary(p)}</ChipTag>
              {m.reasons.slice(0, 2).map((r) => (
                <ChipTag key={r} variant="accent">
                  {r}
                </ChipTag>
              ))}
            </div>
          </div>
          <Button
            onClick={() => handleStart(p.id)}
            disabled={isActive}
            variant={isActive ? 'secondary' : 'primary'}
            size="sm"
            className="shrink-0 self-center"
            aria-label={isActive ? `Following ${p.name}` : `Start ${p.name}`}
          >
            {isActive ? 'Following' : 'Start'}
          </Button>
        </div>
      </section>
    )
  }

  return (
    <div className="animate-fade-in">
      <header className="px-5 pt-5 safe-top">
        <button
          onClick={() => router.push('/')}
          className="inline-flex items-center gap-1 text-sm text-fg/50 active:text-fg/80 -ml-1"
        >
          <ChevronLeft size={18} /> Today
        </button>
        <h1 className="font-display text-[26px] font-black uppercase tracking-[-0.02em] leading-[0.95] mt-2">Training Plans</h1>
        <p className="text-[13px] text-fg/55 mt-1.5 leading-snug">
          Proven programs — or build your own. Each session adapts to your equipment.
        </p>
      </header>

      <div className="px-5 mt-5 space-y-4">
        {/* Search */}
        <div className="relative">
          <SearchIcon size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg/35 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search programs — name, author, focus…"
            aria-label="Search programs"
            className="w-full rounded-[13px] bg-card border border-hairline/[0.08] pl-10 pr-9 py-2.5 text-[15px] outline-none focus:border-blaze placeholder:text-fg/35"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 grid place-items-center h-7 w-7 rounded-full text-fg/40 active:text-fg/70"
            >
              <XIcon size={15} />
            </button>
          )}
        </div>

        {/* Availability filter */}
        <section>
          <div className="text-xs font-semibold text-fg/50 mb-1.5">How many days a week can you train?</div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days per week" aria-describedby="day-filter-note">
            {(['any', 2, 3, 4, 5, 6] as DayFilter[]).map((d) => (
              <Chip
                key={d}
                selected={dayFilter === d}
                label={d === 'any' ? 'Any days' : `${d} days`}
                onClick={() => setDayFilter(d)}
              >
                {d === 'any' ? 'Any' : `${d} days`}
              </Chip>
            ))}
          </div>
          <p id="day-filter-note" className="text-[11px] text-fg/40 mt-1.5">
            Lists programs that fit your week. Each runs on its own cycle (shown on the card), so some
            rotate across more sessions than this.
          </p>
          <div className="flex items-center justify-between mt-2.5 mb-1.5">
            <div className="text-xs font-semibold text-fg/50">Equipment</div>
            {equipFilter !== 'any' && (
              <button
                onClick={() => setEquipFilter('any')}
                className="text-[11px] font-semibold text-blaze-label active:text-blaze-warm"
              >
                Show all
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Equipment">
            {EQUIP_FILTERS.map((e) => (
              <Chip key={e.id} selected={equipFilter === e.id} label={e.label} onClick={() => setEquipFilter(e.id)}>
                {e.label}
              </Chip>
            ))}
          </div>
        </section>

        {/* Orphaned plan */}
        {activePlan && !active && (
          <section className="card p-5 border-hairline/[0.12]">
            <div className="flex items-center justify-between">
              <span className="text-sm text-fg/60">You&apos;re following a plan that&apos;s no longer available.</span>
              <button
                onClick={() => stopPlan()}
                className="text-xs text-fg/60 active:text-fg/90 inline-flex items-center gap-1 shrink-0"
              >
                <XIcon size={13} /> End plan
              </button>
            </div>
          </section>
        )}

        {/* Active plan banner */}
        {active && activeDay && (
          <section className="card p-5 border-blaze/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[11px] font-extrabold text-blaze-label uppercase tracking-[0.08em]">
                <CheckIcon size={15} /> Currently following
              </div>
              <button
                onClick={() => stopPlan()}
                className="text-xs text-fg/50 active:text-fg/80 inline-flex items-center gap-1"
              >
                <XIcon size={13} /> End plan
              </button>
            </div>
            <h2 className="text-xl font-black uppercase mt-2">{active.name}</h2>
            <p className="text-sm text-fg/55 mt-0.5">
              Up next · {activeDay.title}
              {activePlan!.dayIndex > 0 ? ` · Day ${activePlan!.dayIndex + 1} of ${active.schedule.length}` : ''}
            </p>
            <Button onClick={startTodaysPlanWorkout} fullWidth className="mt-4">
              <PlayIcon size={18} /> Start {activeDay.title}
            </Button>
            {activePlan!.dayIndex > 0 && (
              <button
                onClick={async () => {
                  if (
                    await confirm({
                      title: `Restart ${active.name}?`,
                      body: 'Start this plan over from Day 1. Your logged workout history is kept.',
                      confirmLabel: 'Restart from Day 1',
                      tone: 'danger',
                    })
                  )
                    beginPlan(activePlan!.planId, true)
                }}
                className="w-full text-center text-sm text-fg/45 mt-3 py-1 active:text-fg/70"
              >
                Restart from Day 1
              </button>
            )}
          </section>
        )}

        {/* Create custom plan */}
        <button
          onClick={() => router.push('/plans/builder')}
          className="card w-full p-4 flex items-center gap-3 text-left active:scale-[0.99] transition"
        >
          <span className="grid place-items-center h-10 w-10 rounded-xl bg-blaze/15 text-blaze-label shrink-0">
            <PlusIcon size={20} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold">Create a custom plan</div>
            <div className="text-sm text-fg/45">Guided builder or start from scratch</div>
          </div>
          <ChevronRight size={18} className="text-fg/35 shrink-0" />
        </button>

        {/* Custom plans */}
        {customMatch.length > 0 && (
          <>
            <div className="text-xs font-semibold text-fg/40 uppercase tracking-wide pt-1">Your plans</div>
            {customMatch.map((p) => (
              <Card key={p.id} p={p} />
            ))}
          </>
        )}

        {/* Recommended for you — top profile matches, shown when not searching (independent of filters) */}
        {q === '' && recommended.length > 0 && (
          <section>
            <div className="text-xs font-semibold text-fg/40 uppercase tracking-wide pt-1 mb-2">
              Recommended for you
            </div>
            <div className="space-y-2">
              {recommended.map((m) => (
                <RecommendedCard key={m.plan.id} m={m} />
              ))}
            </div>
          </section>
        )}

        {/* Built-in catalogue */}
        <div className="text-xs font-semibold text-fg/40 uppercase tracking-wide pt-1">
          Proven programs{builtIn.length ? ` · ${builtIn.length}` : ''}
        </div>
        {builtIn.length === 0 ? (
          <div className="py-4">
            <p className="text-sm text-fg/45">
              {q
                ? `No programs match “${query.trim()}”. Try a different search, or clear the filters.`
                : 'No programs match that filter. Try a different number of days or equipment.'}
            </p>
            {/* one tap back to the full catalogue when filters/search hide everything */}
            <Button
              onClick={() => {
                setDayFilter('any')
                setEquipFilter('any')
                setQuery('')
              }}
              variant="secondary"
              className="mt-3"
            >
              <RefreshIcon size={16} /> Show all programs
            </Button>
          </div>
        ) : (
          builtIn.map((p) => <Card key={p.id} p={p} />)
        )}

        <div className="h-2" />
      </div>

      {/* Resume-vs-restart choice when starting a plan you've already progressed in */}
      <Sheet
        open={resumeChoice !== null}
        onClose={() => setResumeChoice(null)}
        title={resumeChoice ? `Continue ${resumeChoice.name}?` : ''}
      >
        {resumeChoice && (
          <div className="pt-1">
            <p className="text-[15px] leading-snug text-fg/70">
              You were on Day {resumeChoice.day + 1} of this plan
              {activePlan && activePlan.planId !== resumeChoice.planId
                ? ' — switching back. Your current plan’s progress is saved too.'
                : '.'}
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              <Button onClick={() => beginPlan(resumeChoice.planId, false)} fullWidth>
                <PlayIcon size={18} /> Resume Day {resumeChoice.day + 1}
              </Button>
              <Button onClick={() => beginPlan(resumeChoice.planId, true)} variant="secondary" fullWidth>
                <RefreshIcon size={17} /> Start over from Day 1
              </Button>
              <Button onClick={() => setResumeChoice(null)} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Sheet>

      {/* Equipment-gap notice when a plan needs gear the user doesn't have */}
      <Sheet
        open={equipGap !== null}
        onClose={() => setEquipGap(null)}
        title={equipGap ? `${equipGap.name} needs more gear` : ''}
      >
        {equipGap && (
          <div className="pt-1">
            <p className="text-[15px] leading-snug text-fg/70">
              This plan is built around equipment you haven’t added:
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {equipGap.missing.map((e) => (
                <ChipTag key={e} variant="neutral">
                  {EQUIPMENT_LABEL[e]}
                </ChipTag>
              ))}
            </div>
            <p className="text-[13px] leading-snug text-fg/45 mt-3">
              With only your current gear, sessions are heavily adapted to bodyweight. Add the
              equipment so the plan uses its real lifts, or continue with what you have.
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              <Button
                onClick={() => {
                  const { planId, missing } = equipGap
                  addMissingEquipment(missing)
                  setEquipGap(null)
                  proceedStart(planId)
                }}
                fullWidth
              >
                <DumbbellIcon size={18} /> Add{' '}
                {equipGap.missing.length === 1 ? EQUIPMENT_LABEL[equipGap.missing[0]] : `${equipGap.missing.length} items`}{' '}
                &amp; start
              </Button>
              <Button
                onClick={() => {
                  const { planId } = equipGap
                  setEquipGap(null)
                  proceedStart(planId)
                }}
                variant="secondary"
                fullWidth
              >
                Continue with my gear
              </Button>
              <Button
                onClick={() => {
                  setEquipGap(null)
                  router.push('/settings')
                }}
                variant="secondary"
                fullWidth
              >
                <SettingsIcon size={16} /> Update equipment in Settings
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  )
}
