'use client'

import { useMemo, useState } from 'react'
import type { Equipment, Exercise, ExerciseCategory, MuscleGroup } from '@/types'
import { EXERCISES } from '@/data/exercises'
import { ALL_MUSCLES, MUSCLES, muscleLabel } from '@/data/muscles'
import { isExerciseDoable } from '@/lib/equipment'
import { useStore } from '@/store/useStore'
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
  const equipment = useStore((s) => s.profile.equipment)
  const current = useStore((s) => s.current)
  const generate = useStore((s) => s.generate)
  const addExercise = useStore((s) => s.addExercise)
  const removeExercise = useStore((s) => s.removeExercise)

  const owned = useMemo(() => new Set(equipment), [equipment])

  const [query, setQuery] = useState('')
  const [muscle, setMuscle] = useState<MuscleGroup | 'all'>('all')
  const [category, setCategory] = useState<CategoryFilter>('all')
  // default to "what I can do" — matches the in-session ExercisePicker's default
  const [onlyAvailable, setOnlyAvailable] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)

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

  // Add without leaving the library, so several exercises can be queued in a row. A toast confirms
  // the add (and that a session was built if there wasn't one); the bottom nav goes to it when ready.
  const addToToday = (ex: Exercise) => {
    if (current?.exercises.some((e) => e.exerciseId === ex.id)) return
    const built = !current
    if (built) generate()
    addExercise(ex.id)
    emitToast(built ? `Built today's workout · added ${ex.name}` : `Added ${ex.name} to today's workout`)
  }

  // tap the check on an already-added exercise to take it back out (removeExercise shows an Undo toast)
  const toggleToday = (ex: Exercise) => {
    if (current?.exercises.some((e) => e.exerciseId === ex.id)) removeExercise(ex.id)
    else addToToday(ex)
  }

  // from the detail sheet: add or remove, then close the sheet (stay on the library)
  const handleToggle = (ex: Exercise) => {
    toggleToday(ex)
    setOpenId(null)
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
              onQuickToggle={() => toggleToday(ex)}
              added={!!current?.exercises.some((e) => e.exerciseId === ex.id)}
            />
          ))
        )}
      </div>

      {/* Detail sheet */}
      <Sheet open={!!active} onClose={() => setOpenId(null)} title={active?.name}>
        {active && (
          <ExerciseDetail
            ex={active}
            onToggle={() => handleToggle(active)}
            hasCurrent={!!current}
            alreadyIn={!!current?.exercises.some((e) => e.exerciseId === active.id)}
          />
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
