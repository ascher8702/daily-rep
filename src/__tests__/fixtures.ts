import type { Equipment, MuscleGroup, Profile, Workout } from '../types'

export const NOW = 1_700_000_000_000

export const FULL_EQUIPMENT: Equipment[] = [
  'barbell',
  'dumbbell',
  'bench',
  'cable',
  'machine',
  'kettlebell',
  'pullupbar',
  'bands',
  'ezbar',
  'bodyweight',
]

export const fullGymProfile: Profile = {
  name: 'Tester',
  goal: 'hypertrophy',
  experience: 'intermediate',
  unit: 'lb',
  equipment: [...FULL_EQUIPMENT],
  sessionLength: 50,
  focusMuscles: [],
  onboarded: true,
}

export const PUSH: MuscleGroup[] = ['chest', 'shoulders', 'triceps']

/** A completed workout that trains the given primary exercise, for recovery tests. */
export function completedWorkout(exerciseId: string, when: number, weight = 135): Workout {
  return {
    id: 'w-' + exerciseId + '-' + when,
    date: when,
    status: 'completed',
    title: 'Test',
    focus: [],
    completedAt: when,
    startedAt: when - 45 * 60000,
    durationMin: 45,
    exercises: [
      {
        exerciseId,
        targetReps: [8, 12],
        sets: [
          { id: 's1', weight, reps: 10, done: true },
          { id: 's2', weight, reps: 10, done: true },
          { id: 's3', weight, reps: 10, done: true },
        ],
      },
    ],
  }
}
