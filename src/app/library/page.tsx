'use client'

import { useMemo, useState } from 'react'
import type { Equipment, Exercise, ExerciseCategory, MuscleGroup } from '@/types'
import { EXERCISES } from '@/data/exercises'
import { ALL_MUSCLES, MUSCLES, muscleLabel } from '@/data/muscles'
import { isExerciseDoable } from '@/lib/equipment'
import { useStore, resolvePlan, planDayExerciseIds, activePlanDayContext } from '@/store/useStore'
import { emitToast } from '@/lib/toast'
import Sheet from '@/components/Sheet'
import { Button } from '@/components/ui/Button'
import { Chip, ChipTag, type ChipVariant } from '@/components/ui/Chip'
import { SearchIcon, PlusIcon, InfoIcon, XIcon, CheckIcon } from '@/components/icons'

/** category → Chip tag variant: compound = orange, isolation = lime, else neutral */
function categoryVariant(c: ExerciseCategory): ChipVariant {
  return c === 'compound' ? 'accent' : c === 'isolation' ? 'recovery' : 'neutral'
}

type CategoryFilter = 'all' | ExerciseCategory

const CATEGORY_FILTERS: { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'compound', label: 'Compound' },
  { id: 'isolation', label: 'Isolation' },
  { id: 'core', label: 'Core' },
  { id: 'cardio', label: 'Cardio' },
]

const EQUIPMENT_LABEL: Record<Equipment, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  machine: 'Machine',
  cable: 'Cable',
  kettlebell: 'Kettlebell',
  bodyweight: 'Bodyweight',
  bands: 'Bands',
  pullupbar: 'Pull-up Bar',
  bench: 'Bench',
  ezbar: 'EZ Bar',
}

const CATEGORY_LABEL: Record<ExerciseCategory, string> = {
  compound: 'Compound',
  isolation: 'Isolation',
  core: 'Core',
  cardio: 'Cardio',
}

function equipmentLabel(e: Equipment): string {
  return EQUIPMENT_LABEL[e]
}

/** The single most representative piece of equipment (prefer a weight over bodyweight). */
function mainEquipment(ex: Exercise): Equipment {
  return ex.equipment.find((e) => e !== 'bodyweight') ?? ex.equipment[0] ?? 'bodyweight'
}

function isAvailable(ex: Exercise, owned: Set<Equipment>): boolean {
  return isExerciseDoable(ex, owned)
}

export default function LibraryPage() {
  const profile = useStore((s) => s.profile)
  const current = useStore((s) => s.current)
  const activePlan = useStore((s) => s.activePlan)
  const customPlans = useStore((s) => s.customPlans)
  const planOverrides = useStore((s) => s.planOverrides)
  const planDayEdits = useStore((s) => s.planDayEdits)
  const addExerciseToday = useStore((s) => s.addExerciseToday)
  const removeExerciseToday = useStore((s) => s.removeExerciseToday)

  const owned = useMemo(() => new Set(profile.equipment), [profile.equipment])

  // The exercise ids that make up TODAY's workout, resolved correctly whether or not the session has
  // been built yet: the live session if there is one, else the active plan day's exercises (swaps +
  // the user's add/remove edits applied). This is what drives the checks — so they're right on first
  // paint, no longer waiting for an interaction to materialize `current`.
  const todayIds = useMemo(() => {
    if (current) return new Set(current.exercises.map((e) => e.exerciseId))
    if (activePlan) {
      const plan = resolvePlan(activePlan.planId, customPlans)
      if (plan) {
        const day = plan.schedule[activePlan.dayIndex % plan.schedule.length]
        return new Set(
          planDayExerciseIds(day, profile, planOverrides[activePlan.planId] ?? {}, planDayEdits[activePlan.planId]?.[day.label]),
        )
      }
    }
    return new Set<string>()
  }, [current, activePlan, customPlans, profile, planOverrides, planDayEdits])

  // the active-plan day "today" maps to (null when there's no plan day to edit) — gates the prompt
  const planCtx = useMemo(
    () => activePlanDayContext(current, activePlan, customPlans),
    [current, activePlan, customPlans],
  )

  const [query, setQuery] = useState('')
  const [muscle, setMuscle] = useState<MuscleGroup | 'all'>('all')
  const [category, setCategory] = useState<CategoryFilter>('all')
  // default to "what I can do" — matches the in-session ExercisePicker's default
  const [onlyAvailable, setOnlyAvailable] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  // pending scope choice for a plan day: { ex, adding } — "just today" vs "going forward"
  const [pending, setPending] = useState<{ ex: Exercise; adding: boolean } | null>(null)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matchesQuery = (ex: Exercise): boolean => {
      if (!q) return true
      // search name, targeted muscles and equipment so "chest" or "barbell" find things
      const haystack = [
        ex.name,
        ...ex.primary.map(muscleLabel),
        ...ex.secondary.map(muscleLabel),
        ...ex.equipment.map(equipmentLabel),
        ex.category,
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    }
    return EXERCISES.filter((ex) => {
      if (!matchesQuery(ex)) return false
      if (muscle !== 'all' && !ex.primary.includes(muscle) && !ex.secondary.includes(muscle)) return false
      if (category !== 'all' && ex.category !== category) return false
      if (onlyAvailable && !isAvailable(ex, owned)) return false
      return true
    })
  }, [query, muscle, category, onlyAvailable, owned])

  const active = openId ? EXERCISES.find((e) => e.id === openId) ?? null : null

  // Apply a toggle for a given scope. `forward` (plan days only) also edits the user's plan copy so the
  // change persists to future sessions of this day. Toasts confirm; removeExerciseToday shows an Undo.
  const applyToggle = (ex: Exercise, forward: boolean) => {
    const adding = !todayIds.has(ex.id)
    const built = !current // the store builds today's session on the first add
    if (adding) {
      addExerciseToday(ex.id, forward)
      emitToast(
        forward
          ? `Added ${ex.name} to ${planCtx?.dayTitle ?? 'this day'} going forward`
          : built
            ? `Built today's workout · added ${ex.name}`
            : `Added ${ex.name} to today's workout`,
      )
    } else {
      // removeExerciseToday → removeExercise owns the "Exercise removed · Undo" toast (avoid a 2nd one)
      removeExerciseToday(ex.id, forward)
    }
  }

  // Toggle from a card or the detail sheet. On a plan day, ask whether it's just for today or for the
  // day going forward; off-plan (or no active plan) there's nothing to carry forward, so just do it.
  const onToggle = (ex: Exercise) => {
    setOpenId(null) // close the detail sheet if it was the trigger
    if (planCtx) setPending({ ex, adding: !todayIds.has(ex.id) })
    else applyToggle(ex, false)
  }

  // resolve the scope sheet
  const commitPending = (forward: boolean) => {
    if (pending) applyToggle(pending.ex, forward)
    setPending(null)
  }

  return (
    <div className="animate-fade-in">
      {/* Header + search */}
      <div className="px-5 pt-5 safe-top">
        <h1 className="font-display text-3xl font-black uppercase tracking-[-0.02em] leading-[0.95]">Exercises</h1>
        <p className="text-fg/50 mt-1.5 text-[13px]">Browse the full library and add to today.</p>
        <div className="mt-3.5 flex items-center gap-2.5 rounded-[13px] bg-raised border border-hairline/[0.08] px-3.5 py-2.5 focus-within:border-blaze transition">
          <SearchIcon size={18} className="text-fg/40" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search exercises"
            aria-label="Search exercises"
            className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-fg/35"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="p-0.5 rounded-full text-fg/40 active:scale-95"
              aria-label="Clear search"
            >
              <XIcon size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Muscle chips */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar mt-3.5 px-5 pb-0.5">
        <Chip selected={muscle === 'all'} label="All muscles" onClick={() => setMuscle('all')}>
          All
        </Chip>
        {ALL_MUSCLES.map((m) => (
          <Chip key={m} selected={muscle === m} label={MUSCLES[m].label} onClick={() => setMuscle(m)}>
            {MUSCLES[m].label}
          </Chip>
        ))}
      </div>

      {/* Category chips */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar mt-2 px-5 pb-0.5">
        {CATEGORY_FILTERS.map((c) => (
          <Chip key={c.id} selected={category === c.id} label={`${c.label} category`} onClick={() => setCategory(c.id)}>
            {c.label}
          </Chip>
        ))}
      </div>

      {/* Equipment toggle + count */}
      <div className="px-5 mt-3 flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-fg/55 select-none">
          <input
            type="checkbox"
            checked={onlyAvailable}
            onChange={(e) => setOnlyAvailable(e.target.checked)}
            className="accent-blaze h-4 w-4"
          />
          Available with my equipment
        </label>
        <span className="text-xs text-fg/40 tabular-nums shrink-0">
          {results.length} {results.length === 1 ? 'exercise' : 'exercises'}
        </span>
      </div>

      {/* Results list */}
      <div className="px-5 mt-3 space-y-2">
        {results.length === 0 ? (
          <EmptyState
            onReset={() => {
              setQuery('')
              setMuscle('all')
              setCategory('all')
              setOnlyAvailable(false)
            }}
          />
        ) : (
          results.map((ex) => (
            <ExerciseCard
              key={ex.id}
              ex={ex}
              onOpen={() => setOpenId(ex.id)}
              onQuickToggle={() => onToggle(ex)}
              added={todayIds.has(ex.id)}
            />
          ))
        )}
      </div>

      {/* Detail sheet */}
      <Sheet open={!!active} onClose={() => setOpenId(null)} title={active?.name}>
        {active && (
          <ExerciseDetail
            ex={active}
            onToggle={() => onToggle(active)}
            hasCurrent={!!current}
            alreadyIn={todayIds.has(active.id)}
          />
        )}
      </Sheet>

      {/* Scope prompt — only on an active plan day: just today vs the day going forward (plan copy) */}
      <Sheet
        open={!!pending}
        onClose={() => setPending(null)}
        title={pending ? `${pending.adding ? 'Add' : 'Remove'} ${pending.ex.name}` : ''}
      >
        {pending && (
          <div className="pt-1">
            <p className="text-[15px] leading-snug text-fg/70">
              {pending.adding
                ? `Add to just today’s workout, or to every ${planCtx?.dayTitle ?? 'session'} on this plan going forward?`
                : `Remove from just today’s workout, or from every ${planCtx?.dayTitle ?? 'session'} on this plan going forward?`}
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              <Button onClick={() => commitPending(true)} variant={pending.adding ? 'primary' : 'secondary'} fullWidth>
                {pending.adding ? <PlusIcon size={18} /> : <XIcon size={18} />}
                {pending.adding ? 'Add' : 'Remove'} for {planCtx?.dayTitle ?? 'this day'} going forward
              </Button>
              <Button onClick={() => commitPending(false)} variant={pending.adding ? 'secondary' : 'primary'} fullWidth>
                Just for today
              </Button>
            </div>
            <p className="mt-3 text-center text-xs text-fg/40">
              Updates your copy of the plan — the original plan isn’t changed.
            </p>
          </div>
        )}
      </Sheet>
    </div>
  )
}

function ExerciseCard({
  ex,
  onOpen,
  onQuickToggle,
  added,
}: {
  ex: Exercise
  onOpen: () => void
  onQuickToggle: () => void
  added: boolean
}) {
  return (
    <div className="card px-4 py-3.5 flex items-center gap-3">
      <button onClick={onOpen} className="flex-1 min-w-0 text-left active:opacity-80 transition">
        <div className="font-bold truncate">{ex.name}</div>
        <div className="text-xs text-fg/45 truncate mt-0.5">
          {ex.primary.map(muscleLabel).join(', ')}
        </div>
        <div className="flex items-center gap-1.5 mt-2">
          <ChipTag variant={categoryVariant(ex.category)}>{CATEGORY_LABEL[ex.category]}</ChipTag>
          <ChipTag variant="neutral">{equipmentLabel(mainEquipment(ex))}</ChipTag>
        </div>
      </button>
      {/* quick toggle — stays on the library so several can be queued (or taken back out) in a row.
          when already added, the check shows on its own and reveals an × on press to remove. */}
      <button
        onClick={onQuickToggle}
        aria-label={added ? `Remove ${ex.name} from today's workout` : `Add ${ex.name} to today's workout`}
        className={`group shrink-0 grid place-items-center h-10 w-10 rounded-full border transition active:scale-90 ${
          added
            ? 'bg-recovery-fresh/15 border-recovery-fresh/35 text-recovery-fresh active:bg-red-500/15 active:border-red-500/35 active:text-red-400'
            : 'bg-raised border-hairline/[0.08] text-fg/70 active:bg-card'
        }`}
      >
        {added ? (
          <>
            <CheckIcon size={18} strokeWidth={3} className="group-active:hidden" />
            <XIcon size={18} strokeWidth={3} className="hidden group-active:block" />
          </>
        ) : (
          <PlusIcon size={20} />
        )}
      </button>
    </div>
  )
}

function ExerciseDetail({
  ex,
  onToggle,
  hasCurrent,
  alreadyIn,
}: {
  ex: Exercise
  onToggle: () => void
  hasCurrent: boolean
  alreadyIn: boolean
}) {
  return (
    <div className="pt-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <ChipTag variant={categoryVariant(ex.category)}>{CATEGORY_LABEL[ex.category]}</ChipTag>
        {ex.unilateral && <ChipTag variant="neutral">Unilateral</ChipTag>}
        <ChipTag variant="neutral">Difficulty {ex.difficulty}/3</ChipTag>
      </div>

      <DetailSection title="Primary muscles">
        <div className="flex flex-wrap gap-1.5">
          {ex.primary.map((m) => (
            <ChipTag key={m} variant="accent">
              {muscleLabel(m)}
            </ChipTag>
          ))}
        </div>
      </DetailSection>

      {ex.secondary.length > 0 && (
        <DetailSection title="Secondary muscles">
          <div className="flex flex-wrap gap-1.5">
            {ex.secondary.map((m) => (
              <ChipTag key={m} variant="neutral">
                {muscleLabel(m)}
              </ChipTag>
            ))}
          </div>
        </DetailSection>
      )}

      <DetailSection title="Equipment">
        <div className="flex flex-wrap gap-1.5">
          {ex.equipment.map((e) => (
            <ChipTag key={e} variant="neutral">
              {equipmentLabel(e)}
            </ChipTag>
          ))}
        </div>
      </DetailSection>

      <DetailSection title="How to perform">
        <ol className="space-y-2.5">
          {ex.instructions.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="shrink-0 grid place-items-center h-6 w-6 rounded-full bg-raised border border-hairline/[0.08] text-xs font-bold text-blaze-label tabular-nums">
                {i + 1}
              </span>
              <span className="text-[15px] text-fg/80 leading-snug pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
      </DetailSection>

      <div className="mt-6 mb-2 flex items-start gap-2 text-xs text-fg/40">
        <InfoIcon size={15} className="shrink-0 mt-px" />
        <span>
          {alreadyIn
            ? 'This exercise is in today’s session. Tap below to take it back out.'
            : hasCurrent
              ? "Adds this exercise to the end of today's session."
              : "Builds today's session, then adds this exercise."}
        </span>
      </div>

      <Button onClick={onToggle} variant={alreadyIn ? 'secondary' : 'primary'} fullWidth>
        {alreadyIn ? (
          <>
            <XIcon size={18} /> Remove from today&apos;s workout
          </>
        ) : (
          <>
            <PlusIcon size={18} /> Add to today&apos;s workout
          </>
        )}
      </Button>
    </div>
  )
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-fg/40 mb-2">{title}</div>
      {children}
    </div>
  )
}

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="card px-6 py-12 text-center flex flex-col items-center">
      <div className="grid place-items-center h-14 w-14 rounded-full bg-raised border border-hairline/[0.08] text-fg/40 mb-4">
        <SearchIcon size={24} />
      </div>
      <div className="font-semibold">No exercises found</div>
      <p className="text-sm text-fg/45 mt-1.5 max-w-[16rem]">
        Try a different search or loosen your muscle, category, and equipment filters.
      </p>
      <Button onClick={onReset} variant="secondary" size="sm" className="mt-5">
        Clear filters
      </Button>
    </div>
  )
}
