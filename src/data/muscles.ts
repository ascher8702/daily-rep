import type { MuscleGroup } from '../types'

export interface MuscleMeta {
  id: MuscleGroup
  label: string
  /** which view of the body the muscle is most visible on */
  view: 'front' | 'back'
  /** broad region for balance analytics */
  region: 'push' | 'pull' | 'legs' | 'core'
}

export const MUSCLES: Record<MuscleGroup, MuscleMeta> = {
  chest: { id: 'chest', label: 'Chest', view: 'front', region: 'push' },
  shoulders: { id: 'shoulders', label: 'Shoulders', view: 'front', region: 'push' },
  triceps: { id: 'triceps', label: 'Triceps', view: 'back', region: 'push' },
  biceps: { id: 'biceps', label: 'Biceps', view: 'front', region: 'pull' },
  forearms: { id: 'forearms', label: 'Forearms', view: 'front', region: 'pull' },
  back: { id: 'back', label: 'Upper Back', view: 'back', region: 'pull' },
  lats: { id: 'lats', label: 'Lats', view: 'back', region: 'pull' },
  traps: { id: 'traps', label: 'Traps', view: 'back', region: 'pull' },
  lowerback: { id: 'lowerback', label: 'Lower Back', view: 'back', region: 'core' },
  abs: { id: 'abs', label: 'Abs', view: 'front', region: 'core' },
  quads: { id: 'quads', label: 'Quads', view: 'front', region: 'legs' },
  hamstrings: { id: 'hamstrings', label: 'Hamstrings', view: 'back', region: 'legs' },
  glutes: { id: 'glutes', label: 'Glutes', view: 'back', region: 'legs' },
  calves: { id: 'calves', label: 'Calves', view: 'back', region: 'legs' },
}

export const ALL_MUSCLES = Object.keys(MUSCLES) as MuscleGroup[]

export function muscleLabel(m: MuscleGroup): string {
  // guard against stale/corrupted persisted muscle ids
  return MUSCLES[m]?.label ?? 'Other'
}
