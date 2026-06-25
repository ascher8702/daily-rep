import type { Equipment, Profile } from '../types'
import { isExerciseDoable } from './equipment'
import { getExercise } from '../data/exercises'
import type { WorkoutPlan, EquipmentContext } from '../data/plans'

/**
 * Best-guess equipment context for a user's gear, used to seed the Plans catalogue's equipment filter
 * so the default view is already relevant. Returns 'any' when we can't meaningfully narrow (no gear on
 * file), so a new/empty profile isn't over-filtered. A barbell or gym machines imply a full gym;
 * dumbbells/kettlebells imply a home setup; otherwise (bodyweight/bands/pull-up bar) we show bodyweight.
 */
export function profileEquipmentContext(equipment: Equipment[]): EquipmentContext | 'any' {
  const have = new Set(equipment)
  if (have.has('barbell') || have.has('machine') || have.has('cable')) return 'full-gym'
  if (have.has('dumbbell') || have.has('kettlebell')) return 'home-dumbbell'
  if (equipment.some((e) => e !== 'bodyweight') || have.has('bodyweight')) return 'bodyweight'
  return 'any'
}

/** Fraction of a plan's prescribed lifts the user can't perform with their equipment (0..1). */
export function planUndoableRatio(plan: WorkoutPlan, owned: Set<Equipment>): number {
  let undoable = 0
  let total = 0
  for (const day of plan.schedule) {
    for (const lift of day.lifts ?? []) {
      const ex = getExercise(lift.exerciseId)
      if (!ex) continue
      total += 1
      if (!isExerciseDoable(ex, owned)) undoable += 1
    }
  }
  return total ? undoable / total : 0
}

export interface PlanMatch {
  plan: WorkoutPlan
  score: number
  /** short human reasons the plan fits ("matches your goal", "3 days/week", "fits your equipment") */
  reasons: string[]
}

/**
 * Rank built-in plans by fit to the user's profile — goal, experience, weekly availability and
 * equipment. Pure + deterministic so it can power both the onboarding "recommended plan" and the
 * Plans catalogue's "Recommended for you" section. Custom plans are excluded (we recommend programs).
 */
export function recommendPlans(
  plans: WorkoutPlan[],
  profile: Profile,
  opts: { limit?: number } = {},
): PlanMatch[] {
  const owned = new Set<Equipment>([...profile.equipment, 'bodyweight'])
  const ranked = plans
    .filter((p) => !p.custom)
    .map((plan) => {
      let score = 0
      const reasons: string[] = []

      if (plan.goalFit.includes(profile.goal)) {
        score += 3
        reasons.push('matches your goal')
      }

      if (plan.level === profile.experience) {
        score += 2
        reasons.push(`${profile.experience} level`)
      } else if (plan.level === 'all') {
        score += 1
      }

      const freqs = plan.daysPerWeekOptions ?? [plan.daysPerWeek]
      if (profile.daysPerWeek != null) {
        if (freqs.includes(profile.daysPerWeek)) {
          score += 2
          reasons.push(`${profile.daysPerWeek} days/week`)
        } else {
          const closest = freqs.reduce(
            (a, b) => (Math.abs(b - profile.daysPerWeek!) < Math.abs(a - profile.daysPerWeek!) ? b : a),
            freqs[0],
          )
          if (Math.abs(closest - profile.daysPerWeek) <= 1) score += 1
        }
      }

      // equipment fit as a SIGNED factor: +2 when fully doable, down to -2 when the user can't do it,
      // so a plan you mostly can't perform is pushed below a goal-matching plan you can.
      const undoable = planUndoableRatio(plan, owned)
      score += 2 - undoable * 4
      if (undoable === 0) reasons.push('fits your equipment')
      else if (undoable > 0.5) reasons.push('needs more gear')

      // gentle nudge for a plan oriented toward the user's gender — surfaces it, never excludes others.
      // unshift so it leads the reason chips (it's the distinguishing reason this plan is recommended).
      if (plan.genderAffinity && profile.gender && plan.genderAffinity === profile.gender) {
        score += 2
        reasons.unshift(`popular with ${profile.gender === 'female' ? 'women' : 'men'}`)
      }

      return { plan, score, reasons }
    })
    // stable, deterministic ordering: score desc, then name for ties
    .sort((a, b) => b.score - a.score || a.plan.name.localeCompare(b.plan.name))

  return opts.limit != null ? ranked.slice(0, opts.limit) : ranked
}
