import type { Goal, Experience, MuscleGroup, Profile, Workout } from '../types'
import type { EquipmentContext, PlanDay, PlanLift, WorkoutPlan } from '../data/plans'
import { generateWorkout } from './generator'
import { planEquipment } from '../data/plans'
import { uid } from './format'

/** Split focus templates keyed by weekly frequency, used to scaffold a guided custom plan. */
const SPLIT_TEMPLATES: Record<number, { label: string; title: string; focus: MuscleGroup[] }[]> = {
  2: [
    { label: 'Day 1 · Full Body A', title: 'Full Body A', focus: ['chest', 'back', 'quads'] },
    { label: 'Day 2 · Full Body B', title: 'Full Body B', focus: ['shoulders', 'hamstrings', 'lats'] },
  ],
  3: [
    { label: 'Day 1 · Full Body A', title: 'Full Body A', focus: ['quads', 'chest', 'back'] },
    { label: 'Day 2 · Full Body B', title: 'Full Body B', focus: ['hamstrings', 'shoulders', 'lats'] },
    { label: 'Day 3 · Full Body C', title: 'Full Body C', focus: ['glutes', 'chest', 'biceps'] },
  ],
  4: [
    { label: 'Day 1 · Upper A', title: 'Upper A', focus: ['chest', 'back', 'shoulders'] },
    { label: 'Day 2 · Lower A', title: 'Lower A', focus: ['quads', 'hamstrings', 'glutes'] },
    { label: 'Day 3 · Upper B', title: 'Upper B', focus: ['lats', 'shoulders', 'biceps', 'triceps'] },
    { label: 'Day 4 · Lower B', title: 'Lower B', focus: ['glutes', 'hamstrings', 'quads', 'calves'] },
  ],
  5: [
    { label: 'Day 1 · Push', title: 'Push', focus: ['chest', 'shoulders', 'triceps'] },
    { label: 'Day 2 · Pull', title: 'Pull', focus: ['back', 'lats', 'biceps'] },
    { label: 'Day 3 · Legs', title: 'Legs', focus: ['quads', 'hamstrings', 'glutes', 'calves'] },
    { label: 'Day 4 · Upper', title: 'Upper', focus: ['chest', 'back', 'shoulders'] },
    { label: 'Day 5 · Lower', title: 'Lower', focus: ['quads', 'glutes', 'hamstrings'] },
  ],
  6: [
    { label: 'Day 1 · Push', title: 'Push', focus: ['chest', 'shoulders', 'triceps'] },
    { label: 'Day 2 · Pull', title: 'Pull', focus: ['back', 'lats', 'biceps'] },
    { label: 'Day 3 · Legs', title: 'Legs', focus: ['quads', 'hamstrings', 'glutes', 'calves'] },
    { label: 'Day 4 · Push', title: 'Push', focus: ['chest', 'shoulders', 'triceps'] },
    { label: 'Day 5 · Pull', title: 'Pull', focus: ['back', 'lats', 'biceps'] },
    { label: 'Day 6 · Legs', title: 'Legs', focus: ['quads', 'hamstrings', 'glutes', 'calves'] },
  ],
}

export const EQUIPMENT_CONTEXTS: { id: EquipmentContext; label: string }[] = [
  { id: 'full-gym', label: 'Full gym' },
  { id: 'home-dumbbell', label: 'Home / dumbbells' },
  { id: 'minimal', label: 'Minimal / bands' },
  { id: 'bodyweight', label: 'Bodyweight' },
]

const CONTEXT_LABEL: Record<EquipmentContext, WorkoutPlan['equipment']> = {
  'full-gym': 'Full gym',
  'home-dumbbell': 'Minimal',
  minimal: 'Minimal',
  bodyweight: 'Bodyweight',
}

export interface ScaffoldOptions {
  name: string
  level: Experience
  goal: Goal
  equipmentContext: EquipmentContext
  daysPerWeek: number
}

/** Map a generated session's working exercises to plan lifts. */
function liftsFromWorkout(w: Workout): PlanLift[] {
  return w.exercises.map((we) => ({
    exerciseId: we.exerciseId,
    sets: Math.max(1, we.sets.filter((s) => !s.warmup).length),
    repMin: we.targetReps[0],
    repMax: we.targetReps[1],
  }))
}

/**
 * Build a guided custom plan: pick a split template for the chosen frequency and fill each day's
 * lifts using the recovery-aware generator (constrained to the chosen goal + equipment). The user
 * can then edit any of it. Returns a complete, ready-to-save WorkoutPlan.
 */
export function scaffoldPlan(opts: ScaffoldOptions, profile: Profile): WorkoutPlan {
  const days = Math.max(2, Math.min(6, Math.round(opts.daysPerWeek)))
  const template = SPLIT_TEMPLATES[days] ?? SPLIT_TEMPLATES[3]
  const planProfile: Profile = { ...profile, goal: opts.goal, experience: opts.level }
  const equipmentOverride = planEquipment({ equipmentContext: opts.equipmentContext } as WorkoutPlan)

  const schedule: PlanDay[] = template.map((t, i) => {
    const w = generateWorkout(planProfile, [], Date.now(), {
      focusOverride: t.focus,
      equipmentOverride,
      goalOverride: opts.goal,
      shuffle: i,
    })
    return { label: t.label, title: t.title, focus: t.focus, goal: opts.goal, lifts: liftsFromWorkout(w) }
  })

  return {
    id: uid('plan'),
    name: opts.name.trim() || 'My Plan',
    tagline: `${days}-day custom plan`,
    description: `A custom ${opts.level} ${opts.goal} program, ${days} days a week.`,
    daysPerWeek: days,
    daysPerWeekOptions: [days],
    goalFit: [opts.goal],
    level: opts.level,
    equipment: CONTEXT_LABEL[opts.equipmentContext],
    equipmentContext: opts.equipmentContext,
    custom: true,
    schedule,
  }
}

/** A blank day for manual building. */
export function blankDay(index: number): PlanDay {
  return { label: `Day ${index + 1}`, title: `Day ${index + 1}`, focus: [], lifts: [] }
}

/**
 * Remove the day at index `i`, but never drop below one day. A plan with zero days can't be saved
 * (the builder's canSave requires schedule.length > 0), so deleting the last remaining day would
 * strand the builder in an unsaveable dead-end. Returns the schedule unchanged when one day is left.
 */
export function removeScheduleDay(schedule: PlanDay[], i: number): PlanDay[] {
  if (schedule.length <= 1) return schedule
  return schedule.filter((_, idx) => idx !== i)
}
