'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Equipment, MuscleGroup } from '../types'
import { getExercisePool } from '../data/exercises'
import { ALL_MUSCLES, MUSCLES, muscleLabel } from '../data/muscles'
import { isExerciseDoable } from '../lib/equipment'
import { useStore } from '../store/useStore'
import { useExercisesStore } from '../lib/exercisesRemote'
import Sheet from './Sheet'
import { SearchIcon, PlusIcon } from './icons'
import { Chip } from './ui/Chip'

interface Props {
  open: boolean
  onClose: () => void
  onPick: (exerciseId: string) => void
  exclude?: string[]
  title?: string
  /** restrict availability to this equipment set (e.g. a bodyweight plan session) */
  equipment?: Equipment[]
  /** when opening, pre-select this muscle filter (e.g. swap → same muscle group) */
  defaultMuscle?: MuscleGroup
}

export default function ExercisePicker({
  open,
  onClose,
  onPick,
  exclude = [],
  title = 'Add Exercise',
  equipment: equipmentProp,
  defaultMuscle,
}: Props) {
  const profileEquipment = useStore((s) => s.profile.equipment)
  const equipment = equipmentProp ?? profileEquipment
  const owned = useMemo(() => new Set(equipment), [equipment])
  const [q, setQ] = useState('')
  const [muscle, setMuscle] = useState<MuscleGroup | 'all'>(defaultMuscle ?? 'all')
  const [onlyAvailable, setOnlyAvailable] = useState(true)

  // each time the picker opens, focus it on the requested muscle group (or reset)
  useEffect(() => {
    if (open) {
      setMuscle(defaultMuscle ?? 'all')
      setQ('')
    }
  }, [open, defaultMuscle])

  const excludeSet = useMemo(() => new Set(exclude), [exclude])

  // subscribe to the exercise-catalogue source so a late DB overlay repaints results (bundled-only:
  // stays 'bundled', one render, no behavior change).
  const exerciseSource = useExercisesStore((s) => s.source)

  const results = useMemo(() => {
    const query = q.trim().toLowerCase()
    return getExercisePool().filter((ex) => {
      if (excludeSet.has(ex.id)) return false
      if (muscle !== 'all' && !ex.primary.includes(muscle) && !ex.secondary.includes(muscle)) return false
      if (onlyAvailable && !isExerciseDoable(ex, owned)) return false
      if (query && !ex.name.toLowerCase().includes(query)) return false
      return true
    })
    // exerciseSource is a dep so a late DB overlay repaints; the pool itself is read inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, muscle, onlyAvailable, owned, excludeSet, exerciseSource])

  return (
    <Sheet open={open} onClose={onClose} title={title} full>
      <div className="sticky top-0 -mx-5 px-5 pb-3 bg-card z-10">
        <div className="flex items-center gap-2 rounded-xl bg-raised border border-hairline/[0.08] px-3 py-2.5 transition focus-within:border-blaze">
          <SearchIcon size={18} className="text-fg/40" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search exercises"
            className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-fg/30"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar mt-3 -mx-1 px-1">
          <Chip selected={muscle === 'all'} onClick={() => setMuscle('all')} label="All">
            All
          </Chip>
          {ALL_MUSCLES.map((m) => (
            <Chip key={m} selected={muscle === m} onClick={() => setMuscle(m)} label={MUSCLES[m].label}>
              {MUSCLES[m].label}
            </Chip>
          ))}
        </div>
        <label className="flex items-center gap-2 mt-2.5 text-xs text-fg/50">
          <input
            type="checkbox"
            checked={onlyAvailable}
            onChange={(e) => setOnlyAvailable(e.target.checked)}
            className="accent-blaze"
          />
          Only show exercises I have equipment for
        </label>
      </div>

      <div className="space-y-2 mt-1">
        {results.length === 0 && (
          <div className="text-center text-fg/40 py-10 text-sm">No exercises match your filters.</div>
        )}
        {results.map((ex) => (
          <button
            key={ex.id}
            onClick={() => {
              onPick(ex.id)
              onClose()
            }}
            className="w-full text-left card px-4 py-3 flex items-center gap-3 active:scale-[0.99] transition"
          >
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">{ex.name}</div>
              <div className="text-xs text-fg/45 truncate">
                {ex.primary.map(muscleLabel).join(', ')}
                <span className="text-fg/25"> · {ex.equipment.filter((e) => e !== 'bodyweight')[0] ?? 'bodyweight'}</span>
              </div>
            </div>
            <span className="shrink-0 grid place-items-center h-8 w-8 rounded-full bg-blaze/15 text-blaze-label">
              <PlusIcon size={18} />
            </span>
          </button>
        ))}
        <div className="h-4" />
      </div>
    </Sheet>
  )
}
