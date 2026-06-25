import type { Equipment, Exercise } from '../types'

// Apparatus that a movement physically requires whenever it's listed — these are
// co-requirements, not "any-of" alternatives. (You can't do a bench press without a
// bench, or a pull-up without a bar.) Everything else in an exercise's equipment
// list is treated as alternatives: owning any one of them (or bodyweight) suffices.
const CO_REQUIRED: Equipment[] = ['bench', 'pullupbar']

/** Can the user perform this exercise with the equipment they own? */
export function isExerciseDoable(ex: Exercise, owned: Set<Equipment>): boolean {
  for (const co of CO_REQUIRED) {
    if (ex.equipment.includes(co) && !owned.has(co)) return false
  }
  const alternatives = ex.equipment.filter((e) => !CO_REQUIRED.includes(e))
  if (alternatives.length === 0) return true // only needed co-required gear, already satisfied
  return alternatives.some((eq) => eq === 'bodyweight' || owned.has(eq))
}
