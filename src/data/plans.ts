import type { Equipment, Experience, Goal, MuscleGroup } from '../types'

/** Finer equipment context than the display label, used to map the generation pool. */
export type EquipmentContext = 'full-gym' | 'home-dumbbell' | 'bodyweight' | 'minimal'

/** An explicit prescribed lift on a plan day (hybrid fidelity: real lift + scheme, app drives load). */
export interface PlanLift {
  /** exercise id from data/exercises (substituted at generation time if not equippable) */
  exerciseId: string
  sets: number
  repMin: number
  repMax: number
  /**
   * Superset/tri-set/circuit grouping: CONSECUTIVE lifts in a day that share the same group id are
   * performed together (alternated, with rest after the round). e.g. group "A" on two adjacent lifts
   * = an A1/A2 superset. Absent = a straight-set lift.
   */
  group?: string
  /** short scheme note, e.g. "AMRAP last set", "@RPE8", "5/3/1 wave" */
  note?: string
}

export interface PlanDay {
  /** short schedule label, e.g. "Day 1 · Push" */
  label: string
  /** the workout title used when this day is generated */
  title: string
  /** muscles the generator should target for this day */
  focus: MuscleGroup[]
  /** override the session's set/rep scheme for this day (e.g. a strength vs hypertrophy day) */
  goal?: Goal
  /**
   * Explicit prescribed lifts for this day. When present, the session is built from these
   * (with equipment substitution) instead of the recovery-aware generator. When absent, the
   * day falls back to focus-based generation.
   */
  lifts?: PlanLift[]
}

export interface WorkoutPlan {
  id: string
  name: string
  tagline: string
  description: string
  /** primary prescribed frequency */
  daysPerWeek: number
  /** all weekly frequencies this program supports, for the availability filter (defaults to [daysPerWeek]) */
  daysPerWeekOptions?: number[]
  goalFit: Goal[]
  level: Experience | 'all'
  /** equipment intensity hint shown to the user */
  equipment: 'Full gym' | 'Minimal' | 'Bodyweight'
  /** finer equipment context driving the generation pool (defaults derived from `equipment`) */
  equipmentContext?: EquipmentContext
  /** original program author / origin */
  author?: string
  /** evidence quality flag surfaced honestly in the UI */
  evidenceTier?: 'well-established' | 'popular-reasonable' | 'popular-weak-evidence'
  /** authoritative source URL(s) */
  source?: string
  /** true for user-created plans (stored in app state, not the built-in catalogue) */
  custom?: boolean
  /** plan is especially popular with / oriented toward this group — nudges recommendations, never excludes */
  genderAffinity?: 'male' | 'female'
  schedule: PlanDay[]
}

/** All weekly frequencies a plan supports (for the availability filter). */
export function planFrequencies(plan: WorkoutPlan): number[] {
  return plan.daysPerWeekOptions && plan.daysPerWeekOptions.length
    ? plan.daysPerWeekOptions
    : [plan.daysPerWeek]
}

/**
 * Honest one-line schedule summary for a plan card. The session rotation is always
 * `dayIndex % schedule.length`, so the REAL cycle = the count of distinct sessions; pair it with the
 * recommended weekly frequency so a fixed 5-day program can't read as "4 days/week" just because the
 * availability filter lists it there.
 */
export function planScheduleSummary(plan: WorkoutPlan): string {
  const n = plan.schedule.length
  const cycle = n <= 1 ? 'Repeatable' : `${n}-day cycle`
  const f = planFrequencies(plan)
  const freq = f.length > 1 ? `${Math.min(...f)}–${Math.max(...f)}×/wk` : `${f[0]}×/wk`
  return `${cycle} · ${freq}`
}

export const PLANS: WorkoutPlan[] = [
  // ---------------------------------------------------------------------------
  // Beginner barbell linear-progression (full-gym, strength)
  // ---------------------------------------------------------------------------
  {
    id: 'stronglifts-5x5',
    name: 'StrongLifts 5x5',
    tagline: 'Classic three-lift novice barbell LP',
    description:
      'A/B full-body alternating three days a week. Squat every session plus two compounds; add weight whenever you complete all 5x5. Includes the community "Plus" accessory shell — vertical pulls, direct arm work and core — to fix the program\'s thin upper-back and arm volume.',
    daysPerWeek: 3,
    daysPerWeekOptions: [2, 3],
    goalFit: ['strength', 'hypertrophy'],
    level: 'beginner',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'Mehdi Hadim',
    evidenceTier: 'well-established',
    source: 'https://stronglifts.com/stronglifts-5x5/',
    schedule: [
      {
        label: 'A',
        title: 'Workout A',
        focus: ['quads', 'glutes', 'chest', 'back', 'lats', 'biceps', 'abs'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'back-squat', sets: 5, repMin: 5, repMax: 5, note: '+5 lb/session if all reps hit' },
          { exerciseId: 'barbell-bench-press', sets: 5, repMin: 5, repMax: 5, note: '+2.5-5 lb/session' },
          { exerciseId: 'barbell-row', sets: 5, repMin: 5, repMax: 5 },
          { exerciseId: 'pullup', sets: 3, repMin: 8, repMax: 8, note: 'Plus accessory; add weight at 3x8' },
          { exerciseId: 'hanging-leg-raise', sets: 3, repMin: 8, repMax: 12, note: 'core accessory' },
        ],
      },
      {
        label: 'B',
        title: 'Workout B',
        focus: ['quads', 'glutes', 'shoulders', 'hamstrings', 'lowerback', 'triceps', 'biceps'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'back-squat', sets: 5, repMin: 5, repMax: 5, note: '+5 lb/session' },
          { exerciseId: 'overhead-press', sets: 5, repMin: 5, repMax: 5, note: '+2.5-5 lb/session' },
          { exerciseId: 'deadlift', sets: 1, repMin: 5, repMax: 5, note: 'single top set; +5-10 lb/session' },
          { exerciseId: 'dips', sets: 3, repMin: 8, repMax: 8, note: 'Plus accessory; add weight at 3x8' },
          { exerciseId: 'barbell-curl', sets: 3, repMin: 8, repMax: 8, note: 'arm accessory' },
        ],
      },
    ],
  },
  {
    id: 'starting-strength',
    name: 'Starting Strength',
    tagline: 'Rippetoe novice barbell program',
    description:
      'A/B full-body LP with press and bench alternating each session and a daily deadlift in Phase 1, swapping to power clean in Phase 2. The core squat/press/pull LP stays intact, with chins, dips, curls and core added as recovery-permitting accessories the community universally runs.',
    daysPerWeek: 3,
    daysPerWeekOptions: [2, 3],
    goalFit: ['strength', 'hypertrophy'],
    level: 'beginner',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'Mark Rippetoe',
    evidenceTier: 'well-established',
    source: 'https://startingstrength.com/get-started/programs',
    schedule: [
      {
        label: 'A',
        title: 'Workout A',
        focus: ['quads', 'glutes', 'chest', 'lowerback', 'lats', 'abs'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'back-squat', sets: 3, repMin: 5, repMax: 5, note: '+5 lb/session (low-bar)' },
          { exerciseId: 'barbell-bench-press', sets: 3, repMin: 5, repMax: 5 },
          { exerciseId: 'deadlift', sets: 1, repMin: 5, repMax: 5, note: 'single top set' },
          { exerciseId: 'chinup', sets: 3, repMin: 6, repMax: 10, note: 'accessory pull' },
          { exerciseId: 'hanging-leg-raise', sets: 3, repMin: 12, repMax: 15, note: 'core accessory' },
        ],
      },
      {
        label: 'B',
        title: 'Workout B',
        focus: ['quads', 'glutes', 'shoulders', 'lowerback', 'triceps', 'biceps'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'back-squat', sets: 3, repMin: 5, repMax: 5, note: '+5 lb/session' },
          { exerciseId: 'overhead-press', sets: 3, repMin: 5, repMax: 5 },
          { exerciseId: 'deadlift', sets: 5, repMin: 3, repMax: 3, note: 'Phase 2: power clean 5x3' },
          { exerciseId: 'dips', sets: 3, repMin: 8, repMax: 10, note: 'accessory press' },
          { exerciseId: 'barbell-curl', sets: 3, repMin: 10, repMax: 10, note: 'arm accessory' },
        ],
      },
    ],
  },
  {
    id: 'greyskull-lp',
    name: 'Greyskull LP',
    tagline: 'AMRAP-driven novice LP',
    description:
      'A/B full-body LP with upper-body pressing first each day and a 2x5 plus AMRAP final-set scheme to autoregulate progress. Runs the fuller GSLP shell — chins and curls plus a rear-delt/back plug-in and triceps/core work — to balance the press-heavy default.',
    daysPerWeek: 3,
    daysPerWeekOptions: [2, 3],
    goalFit: ['strength', 'hypertrophy'],
    level: 'beginner',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'John Sheaffer',
    evidenceTier: 'well-established',
    source: 'https://www.powerliftingtowin.com/greyskull-lp/',
    schedule: [
      {
        label: 'A',
        title: 'Workout A',
        focus: ['chest', 'quads', 'glutes', 'biceps', 'shoulders', 'triceps'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'barbell-bench-press', sets: 3, repMin: 5, repMax: 5, note: '2x5 + AMRAP last set; +2.5 lb' },
          { exerciseId: 'back-squat', sets: 3, repMin: 5, repMax: 5, note: '2x5 + AMRAP last set; +5 lb' },
          { exerciseId: 'chinup', sets: 3, repMin: 6, repMax: 8, note: 'arms plug-in' },
          { exerciseId: 'face-pull', sets: 3, repMin: 15, repMax: 15, note: 'rear delt / upper back plug-in' },
          { exerciseId: 'triceps-pushdown', sets: 3, repMin: 12, repMax: 12, note: 'triceps plug-in' },
        ],
      },
      {
        label: 'B',
        title: 'Workout B',
        focus: ['shoulders', 'hamstrings', 'lowerback', 'biceps', 'back', 'abs'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'overhead-press', sets: 3, repMin: 5, repMax: 5, note: '2x5 + AMRAP last set; +2.5 lb' },
          { exerciseId: 'deadlift', sets: 1, repMin: 5, repMax: 5, note: 'single AMRAP set; +5 lb' },
          { exerciseId: 'barbell-curl', sets: 3, repMin: 10, repMax: 15, note: 'arms plug-in' },
          { exerciseId: 'db-row', sets: 3, repMin: 10, repMax: 10, note: 'horizontal pull plug-in' },
          { exerciseId: 'plank', sets: 3, repMin: 10, repMax: 20, note: 'core plug-in, 30s holds' },
        ],
      },
    ],
  },
  {
    id: 'gzclp',
    name: 'GZCLP',
    tagline: 'Tiered linear progression by Cody LeFever',
    description:
      'MWF rotating workouts, each with a T1 primary compound, a T2 secondary compound and a T3 accessory; advance stages as reps fail.',
    daysPerWeek: 3,
    daysPerWeekOptions: [3, 4],
    goalFit: ['strength', 'hypertrophy'],
    level: 'beginner',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'Cody LeFever',
    evidenceTier: 'well-established',
    source: 'https://thefitness.wiki/routines/gzclp/',
    schedule: [
      {
        label: 'A1',
        title: 'Squat / Bench',
        focus: ['quads', 'glutes', 'chest', 'triceps'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'back-squat', sets: 5, repMin: 3, repMax: 3, note: 'T1 5x3+, last set AMRAP' },
          { exerciseId: 'barbell-bench-press', sets: 3, repMin: 10, repMax: 10, note: 'T2 3x10' },
          { exerciseId: 'lat-pulldown', sets: 3, repMin: 15, repMax: 25, note: 'T3 3x15+' },
        ],
      },
      {
        label: 'B1',
        title: 'OHP / Deadlift',
        focus: ['shoulders', 'lowerback', 'hamstrings', 'triceps'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'overhead-press', sets: 5, repMin: 3, repMax: 3, note: 'T1 5x3+, last set AMRAP' },
          { exerciseId: 'deadlift', sets: 3, repMin: 10, repMax: 10, note: 'T2 3x10' },
          { exerciseId: 'triceps-pushdown', sets: 3, repMin: 15, repMax: 25, note: 'T3 3x15+' },
        ],
      },
      {
        label: 'A2',
        title: 'Bench / Squat',
        focus: ['chest', 'triceps', 'quads', 'glutes'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'barbell-bench-press', sets: 5, repMin: 3, repMax: 3, note: 'T1 5x3+, last set AMRAP' },
          { exerciseId: 'back-squat', sets: 3, repMin: 10, repMax: 10, note: 'T2 3x10' },
          { exerciseId: 'db-row', sets: 3, repMin: 15, repMax: 25, note: 'T3 3x15+' },
        ],
      },
      {
        label: 'B2',
        title: 'Deadlift / OHP',
        focus: ['hamstrings', 'lowerback', 'shoulders', 'biceps'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'deadlift', sets: 5, repMin: 3, repMax: 3, note: 'T1 5x3+, last set AMRAP' },
          { exerciseId: 'overhead-press', sets: 3, repMin: 10, repMax: 10, note: 'T2 3x10' },
          { exerciseId: 'barbell-curl', sets: 3, repMin: 15, repMax: 25, note: 'T3 3x15+' },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // Intermediate strength (full-gym)
  // ---------------------------------------------------------------------------
  {
    id: 'madcow-5x5',
    name: 'Madcow 5x5',
    tagline: 'Weekly-progression intermediate 5x5',
    description:
      'Three-day full-body heavy/light/medium cycle with a ramped 5x5 on Monday, a light Wednesday and a Friday top-set PR. Carries the fuller accessory shell the community runs — posterior-chain, arm and core work around the ramped 5x5 mains.',
    daysPerWeek: 3,
    daysPerWeekOptions: [3],
    goalFit: ['strength', 'hypertrophy'],
    level: 'intermediate',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'Bill Starr / Madcow',
    evidenceTier: 'well-established',
    source: 'https://stronglifts.com/madcow-5x5/',
    schedule: [
      {
        label: 'Mon',
        title: 'Volume Ramp',
        focus: ['quads', 'glutes', 'chest', 'back', 'hamstrings', 'abs'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'back-squat', sets: 5, repMin: 5, repMax: 5, note: 'ramp to top set ~95% of 5RM' },
          { exerciseId: 'barbell-bench-press', sets: 5, repMin: 5, repMax: 5, note: 'ramp to top set' },
          { exerciseId: 'barbell-row', sets: 5, repMin: 5, repMax: 5, note: 'ramp to top set' },
          { exerciseId: 'romanian-deadlift', sets: 2, repMin: 10, repMax: 10, note: 'weighted hyperextension sub' },
          { exerciseId: 'hanging-leg-raise', sets: 4, repMin: 10, repMax: 10, note: 'weighted sit-ups' },
        ],
      },
      {
        label: 'Wed',
        title: 'Light / Recovery',
        focus: ['quads', 'shoulders', 'hamstrings', 'lowerback', 'abs'],
        lifts: [
          { exerciseId: 'back-squat', sets: 4, repMin: 5, repMax: 5, note: 'capped near 75%' },
          { exerciseId: 'overhead-press', sets: 4, repMin: 5, repMax: 5 },
          { exerciseId: 'deadlift', sets: 4, repMin: 5, repMax: 5 },
          { exerciseId: 'hanging-leg-raise', sets: 3, repMin: 15, repMax: 15, note: 'core accessory' },
        ],
      },
      {
        label: 'Fri',
        title: 'Intensity / PR',
        focus: ['quads', 'glutes', 'chest', 'back', 'biceps', 'triceps'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'back-squat', sets: 5, repMin: 3, repMax: 5, note: 'heavy 3-rep top set + 1x8 backoff' },
          { exerciseId: 'barbell-bench-press', sets: 5, repMin: 3, repMax: 5, note: 'heavy triple PR + backoff' },
          { exerciseId: 'barbell-row', sets: 5, repMin: 3, repMax: 5, note: 'heavy triple PR + backoff' },
          { exerciseId: 'dips', sets: 3, repMin: 6, repMax: 8, note: 'accessory press' },
          { exerciseId: 'barbell-curl', sets: 3, repMin: 8, repMax: 8, group: 'A', note: 'biceps accessory' },
          { exerciseId: 'triceps-pushdown', sets: 3, repMin: 8, repMax: 8, group: 'A', note: 'triceps accessory' },
        ],
      },
    ],
  },
  {
    id: 'texas-method',
    name: 'Texas Method',
    tagline: 'Weekly stress-recovery-adaptation cycle',
    description:
      'Three-day intermediate template: high-volume Monday, light Wednesday, single all-out Friday 5RM PR on each main lift. Bolts on the chins, dips, back-extension and direct-arm accessories the community runs (kept light so the brutal Monday volume stays recoverable).',
    daysPerWeek: 3,
    daysPerWeekOptions: [3],
    goalFit: ['strength', 'hypertrophy'],
    level: 'intermediate',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'Glenn Pendlay / Mark Rippetoe',
    evidenceTier: 'well-established',
    source: 'https://www.powerliftingtowin.com/texas-method/',
    schedule: [
      {
        label: 'Mon',
        title: 'Volume Day',
        focus: ['quads', 'glutes', 'chest', 'shoulders', 'hamstrings', 'lowerback'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'back-squat', sets: 5, repMin: 5, repMax: 5, note: '~90% of Friday weight' },
          { exerciseId: 'barbell-bench-press', sets: 5, repMin: 5, repMax: 5, note: 'alternates with OHP weekly' },
          { exerciseId: 'deadlift', sets: 5, repMin: 5, repMax: 5, note: 'power clean alternative' },
          { exerciseId: 'romanian-deadlift', sets: 3, repMin: 10, repMax: 10, note: 'back extension sub; keep light' },
        ],
      },
      {
        label: 'Wed',
        title: 'Recovery Day',
        focus: ['quads', 'shoulders', 'back', 'lowerback', 'biceps'],
        lifts: [
          { exerciseId: 'back-squat', sets: 2, repMin: 5, repMax: 5, note: '~80% of Monday' },
          { exerciseId: 'overhead-press', sets: 3, repMin: 5, repMax: 5, note: 'light' },
          { exerciseId: 'chinup', sets: 3, repMin: 6, repMax: 10, note: 'assistance' },
          { exerciseId: 'face-pull', sets: 3, repMin: 15, repMax: 15, note: 'shoulder health accessory' },
          { exerciseId: 'barbell-curl', sets: 3, repMin: 12, repMax: 12, note: 'biceps accessory' },
        ],
      },
      {
        label: 'Fri',
        title: 'Intensity Day',
        focus: ['quads', 'glutes', 'chest', 'lowerback', 'triceps'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'back-squat', sets: 1, repMin: 5, repMax: 5, note: 'new 5RM PR' },
          { exerciseId: 'barbell-bench-press', sets: 1, repMin: 5, repMax: 5, note: 'new 5RM PR; alternates with OHP' },
          { exerciseId: 'deadlift', sets: 1, repMin: 5, repMax: 5, note: 'single heavy set' },
          { exerciseId: 'dips', sets: 3, repMin: 8, repMax: 8, note: 'accessory press' },
          { exerciseId: 'triceps-pushdown', sets: 3, repMin: 12, repMax: 12, note: 'triceps accessory' },
        ],
      },
    ],
  },
  {
    id: 'nsuns-531',
    name: 'nSuns 531 LP',
    tagline: 'High-volume AMRAP-driven 531 LP',
    description:
      'Four-to-six day program; each day pairs a T1 main lift (9 sets off a Training Max) with a T2 secondary (8 sets) plus accessories. Five-day version shown.',
    daysPerWeek: 5,
    daysPerWeekOptions: [4, 5, 6],
    goalFit: ['powerlifting', 'strength'],
    level: 'intermediate',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'u/nSuns',
    evidenceTier: 'well-established',
    source: 'https://thefitness.wiki/routines/nsuns-lp/',
    schedule: [
      {
        label: 'D1',
        title: 'Bench / OHP',
        focus: ['chest', 'shoulders', 'triceps'],
        goal: 'powerlifting',
        lifts: [
          { exerciseId: 'barbell-bench-press', sets: 9, repMin: 4, repMax: 8, note: 'T1 9 sets; final 65% set is AMRAP' },
          { exerciseId: 'overhead-press', sets: 8, repMin: 3, repMax: 8, note: 'T2 8 sets, peak ~70%' },
          { exerciseId: 'triceps-pushdown', sets: 3, repMin: 8, repMax: 12, note: 'accessory' },
        ],
      },
      {
        label: 'D2',
        title: 'Squat / Deadlift',
        focus: ['quads', 'glutes', 'hamstrings', 'lowerback'],
        goal: 'powerlifting',
        lifts: [
          { exerciseId: 'back-squat', sets: 9, repMin: 1, repMax: 5, note: 'T1; 95%x1+ AMRAP drives TM' },
          { exerciseId: 'deadlift', sets: 8, repMin: 3, repMax: 7, note: 'T2 sumo, peak ~70%' },
          { exerciseId: 'hanging-leg-raise', sets: 3, repMin: 10, repMax: 15, note: 'accessory' },
        ],
      },
      {
        label: 'D3',
        title: 'OHP / Incline',
        focus: ['shoulders', 'chest', 'triceps'],
        goal: 'powerlifting',
        lifts: [
          { exerciseId: 'overhead-press', sets: 9, repMin: 1, repMax: 5, note: 'T1; 95%x1+ AMRAP drives TM' },
          { exerciseId: 'incline-bench-press', sets: 8, repMin: 3, repMax: 7, note: 'T2, peak ~60%' },
          { exerciseId: 'lateral-raise', sets: 3, repMin: 12, repMax: 20, note: 'accessory' },
        ],
      },
      {
        label: 'D4',
        title: 'Deadlift / Front Squat',
        focus: ['lowerback', 'hamstrings', 'glutes', 'quads'],
        goal: 'powerlifting',
        lifts: [
          { exerciseId: 'deadlift', sets: 9, repMin: 1, repMax: 5, note: 'T1; 95%x1+ AMRAP drives TM' },
          { exerciseId: 'front-squat', sets: 8, repMin: 3, repMax: 7, note: 'T2, peak ~55%' },
          { exerciseId: 'seated-cable-row', sets: 3, repMin: 8, repMax: 12, note: 'accessory' },
        ],
      },
      {
        label: 'D5',
        title: 'Bench / Close-Grip',
        focus: ['chest', 'triceps', 'shoulders'],
        goal: 'powerlifting',
        lifts: [
          { exerciseId: 'barbell-bench-press', sets: 9, repMin: 1, repMax: 5, note: 'T1; 95%x1+ AMRAP drives TM' },
          { exerciseId: 'close-grip-bench', sets: 8, repMin: 3, repMax: 7, note: 'T2, peak ~60%' },
          { exerciseId: 'cable-fly', sets: 3, repMin: 10, repMax: 15, note: 'accessory' },
        ],
      },
    ],
  },
  {
    id: 'wendler-bbb',
    name: '5/3/1 Boring But Big',
    tagline: 'Strength wave plus 5x10 hypertrophy',
    description:
      'One main lift per day on the 5/3/1 percentage wave off a 90% Training Max, followed by a 5x10 BBB supplemental block for size.',
    daysPerWeek: 4,
    daysPerWeekOptions: [3, 4],
    goalFit: ['strength', 'hypertrophy'],
    level: 'intermediate',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'Jim Wendler',
    evidenceTier: 'well-established',
    source: 'https://www.jimwendler.com/blogs/jimwendler-com/101077382-boring-but-big',
    schedule: [
      {
        label: 'D1',
        title: 'Overhead Press',
        focus: ['shoulders', 'triceps', 'traps'],
        lifts: [
          { exerciseId: 'overhead-press', sets: 3, repMin: 1, repMax: 5, note: '5/3/1 wave; final set AMRAP' },
          { exerciseId: 'overhead-press', sets: 5, repMin: 10, repMax: 10, note: 'BBB 5x10 @ 50-60% TM' },
          { exerciseId: 'chinup', sets: 5, repMin: 8, repMax: 12, note: 'assistance' },
        ],
      },
      {
        label: 'D2',
        title: 'Deadlift',
        focus: ['lowerback', 'hamstrings', 'glutes'],
        lifts: [
          { exerciseId: 'deadlift', sets: 3, repMin: 1, repMax: 5, note: '5/3/1 wave; final set AMRAP' },
          { exerciseId: 'deadlift', sets: 5, repMin: 10, repMax: 10, note: 'BBB 5x10 @ 50-60% TM' },
          { exerciseId: 'hanging-leg-raise', sets: 5, repMin: 10, repMax: 20, note: 'core assistance' },
        ],
      },
      {
        label: 'D3',
        title: 'Bench Press',
        focus: ['chest', 'shoulders', 'triceps'],
        lifts: [
          { exerciseId: 'barbell-bench-press', sets: 3, repMin: 1, repMax: 5, note: '5/3/1 wave; final set AMRAP' },
          { exerciseId: 'barbell-bench-press', sets: 5, repMin: 10, repMax: 10, note: 'BBB 5x10 @ 50-60% TM' },
          { exerciseId: 'db-row', sets: 5, repMin: 8, repMax: 12, note: 'assistance' },
        ],
      },
      {
        label: 'D4',
        title: 'Squat',
        focus: ['quads', 'glutes', 'hamstrings'],
        lifts: [
          { exerciseId: 'back-squat', sets: 3, repMin: 1, repMax: 5, note: '5/3/1 wave; final set AMRAP' },
          { exerciseId: 'back-squat', sets: 5, repMin: 10, repMax: 10, note: 'BBB 5x10 @ 50-60% TM' },
          { exerciseId: 'leg-curl', sets: 5, repMin: 8, repMax: 15, note: 'assistance' },
        ],
      },
    ],
  },
  {
    id: 'wendler-531-pl',
    name: '5/3/1 for Powerlifting',
    tagline: 'Four-day percentage wave for the big lifts',
    description:
      'Four-day 5/3/1: one main lift per day on a 4-week percentage wave off a 90% Training Max with an AMRAP top set and a built-in deload week.',
    daysPerWeek: 4,
    daysPerWeekOptions: [4],
    goalFit: ['powerlifting', 'strength'],
    level: 'intermediate',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'Jim Wendler',
    evidenceTier: 'well-established',
    source: 'https://arvo.guru/resources/methods/wendler-531',
    schedule: [
      {
        label: 'D1',
        title: 'Squat',
        focus: ['quads', 'glutes', 'lowerback'],
        goal: 'powerlifting',
        lifts: [
          { exerciseId: 'back-squat', sets: 3, repMin: 1, repMax: 5, note: '5/3/1 wave; AMRAP top set except deload' },
          { exerciseId: 'leg-press', sets: 5, repMin: 5, repMax: 10, note: 'FSL supplemental' },
          { exerciseId: 'lunge', sets: 4, repMin: 8, repMax: 15, note: 'assistance' },
          { exerciseId: 'cable-crunch', sets: 4, repMin: 10, repMax: 20, note: 'core' },
        ],
      },
      {
        label: 'D2',
        title: 'Bench Press',
        focus: ['chest', 'shoulders', 'triceps'],
        goal: 'powerlifting',
        lifts: [
          { exerciseId: 'barbell-bench-press', sets: 3, repMin: 1, repMax: 5, note: '5/3/1 wave; AMRAP top set' },
          { exerciseId: 'db-bench-press', sets: 5, repMin: 5, repMax: 10, note: 'FSL supplemental' },
          { exerciseId: 'seated-cable-row', sets: 4, repMin: 8, repMax: 15, note: 'assistance' },
          { exerciseId: 'triceps-pushdown', sets: 4, repMin: 10, repMax: 15, note: 'triceps' },
        ],
      },
      {
        label: 'D3',
        title: 'Deadlift',
        focus: ['lowerback', 'hamstrings', 'glutes'],
        goal: 'powerlifting',
        lifts: [
          { exerciseId: 'deadlift', sets: 3, repMin: 1, repMax: 5, note: '5/3/1 wave; AMRAP top set' },
          { exerciseId: 'deadlift', sets: 5, repMin: 5, repMax: 10, note: 'FSL supplemental' },
          { exerciseId: 'romanian-deadlift', sets: 4, repMin: 8, repMax: 12, note: 'posterior chain' },
          { exerciseId: 'plank', sets: 4, repMin: 10, repMax: 20, note: 'core' },
        ],
      },
      {
        label: 'D4',
        title: 'Overhead Press',
        focus: ['shoulders', 'triceps', 'back'],
        goal: 'powerlifting',
        lifts: [
          { exerciseId: 'overhead-press', sets: 3, repMin: 1, repMax: 5, note: '5/3/1 wave; AMRAP top set' },
          { exerciseId: 'overhead-press', sets: 5, repMin: 5, repMax: 10, note: 'FSL supplemental' },
          { exerciseId: 'chinup', sets: 4, repMin: 8, repMax: 12, note: 'assistance' },
          { exerciseId: 'lateral-raise', sets: 4, repMin: 10, repMax: 15, note: 'shoulders' },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // Hypertrophy / splits (full-gym)
  // ---------------------------------------------------------------------------
  {
    id: 'upper-lower-4',
    name: 'Upper/Lower 4-Day Split',
    tagline: 'Each muscle trained twice weekly',
    description:
      'Four-day upper/lower split with 5x5 compounds and higher-rep accessories using double progression; balanced strength and size.',
    daysPerWeek: 4,
    daysPerWeekOptions: [4],
    goalFit: ['hypertrophy', 'strength'],
    level: 'intermediate',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'StrengthLog / Daniel Richter',
    evidenceTier: 'well-established',
    source: 'https://www.strengthlog.com/strengthlogs-upper-lower-program-4-days-week/',
    schedule: [
      {
        label: 'UA',
        title: 'Upper A',
        focus: ['chest', 'back', 'shoulders', 'biceps', 'triceps'],
        lifts: [
          { exerciseId: 'barbell-bench-press', sets: 5, repMin: 5, repMax: 5, note: 'add weight when all reps hit' },
          { exerciseId: 'lat-pulldown', sets: 4, repMin: 10, repMax: 10 },
          { exerciseId: 'incline-db-press', sets: 3, repMin: 10, repMax: 10 },
          { exerciseId: 'barbell-row', sets: 4, repMin: 10, repMax: 10 },
          { exerciseId: 'lateral-raise', sets: 3, repMin: 10, repMax: 15 },
          { exerciseId: 'barbell-curl', sets: 3, repMin: 8, repMax: 12 },
        ],
      },
      {
        label: 'LA',
        title: 'Lower A',
        focus: ['quads', 'hamstrings', 'glutes', 'calves'],
        lifts: [
          { exerciseId: 'back-squat', sets: 5, repMin: 5, repMax: 5, note: 'add weight when all reps hit' },
          { exerciseId: 'romanian-deadlift', sets: 4, repMin: 10, repMax: 10 },
          { exerciseId: 'leg-press', sets: 3, repMin: 10, repMax: 15 },
          { exerciseId: 'leg-curl', sets: 3, repMin: 10, repMax: 12 },
          { exerciseId: 'standing-calf-raise', sets: 3, repMin: 10, repMax: 15 },
        ],
      },
      {
        label: 'UB',
        title: 'Upper B',
        focus: ['shoulders', 'chest', 'back', 'triceps', 'biceps'],
        lifts: [
          { exerciseId: 'overhead-press', sets: 5, repMin: 5, repMax: 5, note: 'add weight when all reps hit' },
          { exerciseId: 'pullup', sets: 4, repMin: 10, repMax: 10 },
          { exerciseId: 'close-grip-bench', sets: 3, repMin: 10, repMax: 10 },
          { exerciseId: 'db-row', sets: 4, repMin: 10, repMax: 10 },
          { exerciseId: 'face-pull', sets: 3, repMin: 12, repMax: 15 },
        ],
      },
      {
        label: 'LB',
        title: 'Lower B',
        focus: ['hamstrings', 'glutes', 'quads', 'calves'],
        lifts: [
          { exerciseId: 'deadlift', sets: 5, repMin: 5, repMax: 5, note: 'add weight when all reps hit' },
          { exerciseId: 'front-squat', sets: 5, repMin: 5, repMax: 5 },
          { exerciseId: 'leg-curl', sets: 3, repMin: 10, repMax: 12 },
          { exerciseId: 'leg-extension', sets: 3, repMin: 12, repMax: 15 },
          { exerciseId: 'seated-calf-raise', sets: 3, repMin: 12, repMax: 15 },
        ],
      },
    ],
  },
  {
    id: 'phul',
    name: 'PHUL',
    tagline: 'Power Hypertrophy Upper Lower',
    description:
      'Four-day powerbuilding split: two heavy power days and two higher-volume hypertrophy days, each muscle trained twice per week.',
    daysPerWeek: 4,
    daysPerWeekOptions: [4],
    goalFit: ['powerlifting', 'hypertrophy', 'strength'],
    level: 'intermediate',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'Brandon Campbell',
    evidenceTier: 'popular-reasonable',
    source: 'https://www.muscleandstrength.com/workouts/phul-workout',
    schedule: [
      {
        label: 'UP',
        title: 'Upper Power',
        focus: ['chest', 'back', 'shoulders', 'biceps', 'triceps'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'barbell-bench-press', sets: 4, repMin: 3, repMax: 5, note: 'heavy, 1 RIR' },
          { exerciseId: 'incline-db-press', sets: 4, repMin: 6, repMax: 10 },
          { exerciseId: 'barbell-row', sets: 4, repMin: 3, repMax: 5, note: 'heavy' },
          { exerciseId: 'lat-pulldown', sets: 4, repMin: 6, repMax: 10 },
          { exerciseId: 'overhead-press', sets: 3, repMin: 5, repMax: 8 },
          { exerciseId: 'barbell-curl', sets: 3, repMin: 6, repMax: 10 },
        ],
      },
      {
        label: 'LP',
        title: 'Lower Power',
        focus: ['quads', 'hamstrings', 'glutes', 'calves'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'back-squat', sets: 4, repMin: 3, repMax: 5, note: 'heavy' },
          { exerciseId: 'deadlift', sets: 4, repMin: 3, repMax: 5, note: 'heavy' },
          { exerciseId: 'leg-press', sets: 4, repMin: 10, repMax: 15 },
          { exerciseId: 'leg-curl', sets: 4, repMin: 6, repMax: 10 },
          { exerciseId: 'standing-calf-raise', sets: 4, repMin: 6, repMax: 10 },
        ],
      },
      {
        label: 'UH',
        title: 'Upper Hypertrophy',
        focus: ['chest', 'back', 'shoulders', 'biceps', 'triceps'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'incline-bench-press', sets: 4, repMin: 8, repMax: 12 },
          { exerciseId: 'cable-fly', sets: 4, repMin: 8, repMax: 12 },
          { exerciseId: 'seated-cable-row', sets: 4, repMin: 8, repMax: 12 },
          { exerciseId: 'db-row', sets: 4, repMin: 8, repMax: 12 },
          { exerciseId: 'lateral-raise', sets: 4, repMin: 8, repMax: 12 },
          { exerciseId: 'cable-curl', sets: 4, repMin: 8, repMax: 12 },
          { exerciseId: 'triceps-pushdown', sets: 4, repMin: 8, repMax: 12 },
        ],
      },
      {
        label: 'LH',
        title: 'Lower Hypertrophy',
        focus: ['quads', 'hamstrings', 'glutes', 'calves'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'front-squat', sets: 4, repMin: 8, repMax: 12 },
          { exerciseId: 'lunge', sets: 4, repMin: 8, repMax: 12 },
          { exerciseId: 'leg-extension', sets: 4, repMin: 10, repMax: 15 },
          { exerciseId: 'leg-curl', sets: 4, repMin: 10, repMax: 15 },
          { exerciseId: 'seated-calf-raise', sets: 4, repMin: 8, repMax: 12 },
        ],
      },
    ],
  },
  {
    id: 'phat',
    name: 'PHAT',
    tagline: 'Power Hypertrophy Adaptive Training',
    description:
      'Five-day Layne Norton powerbuilding: two power days plus three hypertrophy days that open with explosive speed work, each muscle twice weekly.',
    daysPerWeek: 5,
    daysPerWeekOptions: [5],
    goalFit: ['hypertrophy', 'strength'],
    level: 'advanced',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'Dr. Layne Norton',
    evidenceTier: 'well-established',
    source: 'https://www.boostcamp.app/coaches/layne-norton/phat',
    schedule: [
      {
        label: 'UP',
        title: 'Upper Body Power',
        focus: ['back', 'chest', 'shoulders', 'biceps', 'triceps'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'barbell-row', sets: 3, repMin: 3, repMax: 5, note: 'Pendlay/bent row, heavy' },
          { exerciseId: 'pullup', sets: 2, repMin: 6, repMax: 10, note: 'weighted' },
          { exerciseId: 'barbell-bench-press', sets: 3, repMin: 3, repMax: 5, note: 'heavy' },
          { exerciseId: 'dips', sets: 2, repMin: 6, repMax: 10, note: 'weighted' },
          { exerciseId: 'db-shoulder-press', sets: 3, repMin: 6, repMax: 10 },
          { exerciseId: 'barbell-curl', sets: 3, repMin: 6, repMax: 10 },
        ],
      },
      {
        label: 'LP',
        title: 'Lower Body Power',
        focus: ['quads', 'hamstrings', 'glutes', 'calves'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'back-squat', sets: 3, repMin: 3, repMax: 5, note: 'heavy' },
          { exerciseId: 'leg-press', sets: 2, repMin: 6, repMax: 10, note: 'hack squat' },
          { exerciseId: 'leg-extension', sets: 2, repMin: 6, repMax: 10 },
          { exerciseId: 'romanian-deadlift', sets: 3, repMin: 5, repMax: 8 },
          { exerciseId: 'leg-curl', sets: 2, repMin: 6, repMax: 10 },
          { exerciseId: 'standing-calf-raise', sets: 3, repMin: 6, repMax: 10 },
        ],
      },
      {
        label: 'BSH',
        title: 'Back & Shoulders Hypertrophy',
        focus: ['back', 'shoulders', 'traps', 'lats'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'barbell-row', sets: 6, repMin: 3, repMax: 3, note: 'speed work 65-70%' },
          { exerciseId: 'db-row', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'seated-cable-row', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'lat-pulldown', sets: 2, repMin: 15, repMax: 20 },
          { exerciseId: 'db-shoulder-press', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'lateral-raise', sets: 3, repMin: 12, repMax: 20 },
        ],
      },
      {
        label: 'LH',
        title: 'Lower Body Hypertrophy',
        focus: ['quads', 'hamstrings', 'glutes', 'calves'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'back-squat', sets: 6, repMin: 3, repMax: 3, note: 'speed work 65-70%' },
          { exerciseId: 'leg-press', sets: 3, repMin: 8, repMax: 12, note: 'hack squat' },
          { exerciseId: 'leg-extension', sets: 3, repMin: 15, repMax: 20 },
          { exerciseId: 'romanian-deadlift', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'leg-curl', sets: 2, repMin: 12, repMax: 15 },
          { exerciseId: 'seated-calf-raise', sets: 4, repMin: 10, repMax: 20 },
        ],
      },
      {
        label: 'CA',
        title: 'Chest & Arms Hypertrophy',
        focus: ['chest', 'biceps', 'triceps'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'db-bench-press', sets: 6, repMin: 3, repMax: 3, note: 'speed work ~RPE 7.5' },
          { exerciseId: 'incline-db-press', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'cable-fly', sets: 2, repMin: 15, repMax: 20 },
          { exerciseId: 'barbell-curl', sets: 3, repMin: 8, repMax: 12, note: 'preacher curl' },
          { exerciseId: 'cable-curl', sets: 3, repMin: 12, repMax: 20 },
          { exerciseId: 'overhead-triceps', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'triceps-pushdown', sets: 3, repMin: 12, repMax: 20 },
        ],
      },
    ],
  },
  {
    id: 'ppl-6',
    name: 'Metallicadpa 6-Day PPL',
    tagline: 'Push/pull/legs six days a week',
    description:
      'The Reddit r/Fitness PPL run as PPLPPL with linear progression on the lead compound each day; each muscle trained twice per week.',
    daysPerWeek: 6,
    daysPerWeekOptions: [6],
    goalFit: ['hypertrophy', 'strength'],
    level: 'beginner',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'u/Metallicadpa',
    evidenceTier: 'well-established',
    source: 'https://thefitness.wiki/routines/strength-training-muscle-building/',
    schedule: [
      {
        label: 'Push',
        title: 'Push A',
        focus: ['chest', 'shoulders', 'triceps'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'barbell-bench-press', sets: 3, repMin: 5, repMax: 5, note: 'linear progression' },
          { exerciseId: 'overhead-press', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'incline-db-press', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'lateral-raise', sets: 3, repMin: 12, repMax: 20 },
          { exerciseId: 'triceps-pushdown', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'overhead-triceps', sets: 3, repMin: 8, repMax: 12 },
        ],
      },
      {
        label: 'Pull',
        title: 'Pull A',
        focus: ['back', 'lats', 'biceps', 'traps'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'deadlift', sets: 1, repMin: 5, repMax: 5, note: 'linear progression' },
          { exerciseId: 'pullup', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'seated-cable-row', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'face-pull', sets: 3, repMin: 12, repMax: 20 },
          { exerciseId: 'barbell-curl', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'hammer-curl', sets: 3, repMin: 8, repMax: 12 },
        ],
      },
      {
        label: 'Legs',
        title: 'Legs A',
        focus: ['quads', 'hamstrings', 'glutes', 'calves'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'back-squat', sets: 3, repMin: 5, repMax: 5, note: 'linear progression' },
          { exerciseId: 'romanian-deadlift', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'leg-press', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'leg-curl', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'standing-calf-raise', sets: 5, repMin: 8, repMax: 12 },
        ],
      },
      {
        label: 'Push',
        title: 'Push B',
        focus: ['chest', 'shoulders', 'triceps'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'overhead-press', sets: 3, repMin: 5, repMax: 5, note: 'linear progression' },
          { exerciseId: 'incline-bench-press', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'db-bench-press', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'lateral-raise', sets: 3, repMin: 12, repMax: 20 },
          { exerciseId: 'overhead-triceps', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'triceps-pushdown', sets: 3, repMin: 8, repMax: 12 },
        ],
      },
      {
        label: 'Pull',
        title: 'Pull B',
        focus: ['back', 'lats', 'biceps', 'traps'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'barbell-row', sets: 3, repMin: 5, repMax: 5, note: 'linear progression' },
          { exerciseId: 'lat-pulldown', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'seated-cable-row', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'face-pull', sets: 3, repMin: 12, repMax: 20 },
          { exerciseId: 'cable-curl', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'hammer-curl', sets: 3, repMin: 8, repMax: 12 },
        ],
      },
      {
        label: 'Legs',
        title: 'Legs B',
        focus: ['quads', 'hamstrings', 'glutes', 'calves'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'back-squat', sets: 3, repMin: 5, repMax: 5, note: 'linear progression' },
          { exerciseId: 'romanian-deadlift', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'leg-extension', sets: 3, repMin: 10, repMax: 15 },
          { exerciseId: 'leg-curl', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'seated-calf-raise', sets: 5, repMin: 8, repMax: 12 },
        ],
      },
    ],
  },
  {
    id: 'bro-split-5',
    name: 'Classic 5-Day Bro Split',
    tagline: 'One muscle region per day',
    description:
      'Traditional bodybuilding split training chest, back, shoulders, legs and arms on separate days with high per-session volume.',
    daysPerWeek: 5,
    daysPerWeekOptions: [5],
    goalFit: ['hypertrophy'],
    level: 'intermediate',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'Traditional bodybuilding template',
    evidenceTier: 'popular-weak-evidence',
    source: 'https://www.hevyapp.com/bro-split-workout-program-guide/',
    schedule: [
      {
        label: 'Chest',
        title: 'Chest',
        focus: ['chest', 'triceps'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'barbell-bench-press', sets: 4, repMin: 6, repMax: 8 },
          { exerciseId: 'incline-db-press', sets: 4, repMin: 8, repMax: 12 },
          { exerciseId: 'dips', sets: 3, repMin: 8, repMax: 12, note: 'weighted or machine press' },
          { exerciseId: 'cable-fly', sets: 4, repMin: 15, repMax: 25 },
        ],
      },
      {
        label: 'Back',
        title: 'Back',
        focus: ['back', 'lats', 'traps'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'deadlift', sets: 4, repMin: 5, repMax: 8, note: 'rack pull or deadlift' },
          { exerciseId: 'pullup', sets: 4, repMin: 5, repMax: 10 },
          { exerciseId: 'db-row', sets: 4, repMin: 8, repMax: 12 },
          { exerciseId: 'seated-cable-row', sets: 4, repMin: 12, repMax: 15 },
        ],
      },
      {
        label: 'Shoulders',
        title: 'Shoulders & Traps',
        focus: ['shoulders', 'traps'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'overhead-press', sets: 4, repMin: 6, repMax: 12, note: 'push press' },
          { exerciseId: 'db-shoulder-press', sets: 4, repMin: 8, repMax: 12 },
          { exerciseId: 'shrug', sets: 4, repMin: 6, repMax: 12 },
          { exerciseId: 'lateral-raise', sets: 4, repMin: 12, repMax: 20 },
          { exerciseId: 'face-pull', sets: 4, repMin: 15, repMax: 25 },
        ],
      },
      {
        label: 'Legs',
        title: 'Legs & Abs',
        focus: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'back-squat', sets: 4, repMin: 6, repMax: 10, note: 'high-bar' },
          { exerciseId: 'leg-curl', sets: 4, repMin: 8, repMax: 12, note: 'GHR or leg curl' },
          { exerciseId: 'leg-press', sets: 3, repMin: 8, repMax: 15, note: 'hack squat or leg press' },
          { exerciseId: 'leg-extension', sets: 3, repMin: 12, repMax: 20 },
          { exerciseId: 'standing-calf-raise', sets: 4, repMin: 10, repMax: 20 },
          { exerciseId: 'hanging-leg-raise', sets: 4, repMin: 10, repMax: 20 },
        ],
      },
      {
        label: 'Arms',
        title: 'Arms',
        focus: ['biceps', 'triceps', 'forearms'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'barbell-curl', sets: 3, repMin: 6, repMax: 10, note: 'EZ-bar' },
          { exerciseId: 'close-grip-bench', sets: 3, repMin: 6, repMax: 10 },
          { exerciseId: 'hammer-curl', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'triceps-pushdown', sets: 3, repMin: 10, repMax: 15 },
          { exerciseId: 'cable-curl', sets: 3, repMin: 12, repMax: 20, note: 'preacher curl' },
          { exerciseId: 'overhead-triceps', sets: 3, repMin: 12, repMax: 20 },
        ],
      },
    ],
  },
  {
    id: 'nippard-fundamentals',
    name: 'Jeff Nippard Fundamentals',
    tagline: 'Evidence-based hypertrophy fundamentals',
    description:
      'Nippard fundamentals hypertrophy program shown as the four-day upper/lower variant; linear progression for concurrent size and strength.',
    daysPerWeek: 4,
    daysPerWeekOptions: [3, 4, 5],
    goalFit: ['hypertrophy', 'general'],
    level: 'beginner',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'Jeff Nippard',
    evidenceTier: 'well-established',
    source: 'https://jeffnippard.com/products/fundamentals-hypertrophy-program',
    schedule: [
      {
        label: 'U1',
        title: 'Upper 1',
        focus: ['chest', 'back', 'shoulders', 'biceps', 'triceps'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'barbell-bench-press', sets: 3, repMin: 5, repMax: 8, note: 'linear progression' },
          { exerciseId: 'lat-pulldown', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'incline-db-press', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'seated-cable-row', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'lateral-raise', sets: 3, repMin: 12, repMax: 15 },
          { exerciseId: 'db-curl', sets: 3, repMin: 8, repMax: 12 },
        ],
      },
      {
        label: 'L1',
        title: 'Lower 1',
        focus: ['quads', 'hamstrings', 'glutes', 'calves'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'back-squat', sets: 3, repMin: 5, repMax: 8, note: 'linear progression' },
          { exerciseId: 'romanian-deadlift', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'leg-press', sets: 3, repMin: 10, repMax: 15 },
          { exerciseId: 'leg-curl', sets: 3, repMin: 10, repMax: 15 },
          { exerciseId: 'standing-calf-raise', sets: 4, repMin: 8, repMax: 12 },
        ],
      },
      {
        label: 'U2',
        title: 'Upper 2',
        focus: ['shoulders', 'back', 'chest', 'triceps', 'biceps'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'overhead-press', sets: 3, repMin: 5, repMax: 8, note: 'linear progression' },
          { exerciseId: 'pullup', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'incline-bench-press', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'db-row', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'face-pull', sets: 3, repMin: 12, repMax: 20 },
          { exerciseId: 'triceps-pushdown', sets: 3, repMin: 8, repMax: 12 },
        ],
      },
      {
        label: 'L2',
        title: 'Lower 2',
        focus: ['hamstrings', 'quads', 'glutes', 'calves'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'deadlift', sets: 3, repMin: 5, repMax: 8, note: 'linear progression' },
          { exerciseId: 'front-squat', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'leg-extension', sets: 3, repMin: 12, repMax: 15 },
          { exerciseId: 'leg-curl', sets: 3, repMin: 10, repMax: 15 },
          { exerciseId: 'seated-calf-raise', sets: 4, repMin: 8, repMax: 12 },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // Community-loved additions (full-gym)
  // ---------------------------------------------------------------------------
  {
    id: 'rfit-bbr',
    name: 'r/Fitness Basic Beginner Routine',
    tagline: 'The wiki default novice full-body',
    description:
      'The r/Fitness wiki\'s flagship novice routine: A/B full-body alternating three days a week with horizontal and vertical pulling from day one. "3x5+" runs the last set as an AMRAP to autoregulate progress, with small jumps so beginners stall less.',
    daysPerWeek: 3,
    daysPerWeekOptions: [2, 3],
    goalFit: ['strength', 'general'],
    level: 'beginner',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'r/Fitness community',
    evidenceTier: 'well-established',
    source: 'https://thefitness.wiki/routines/r-fitness-basic-beginner-routine/',
    schedule: [
      {
        label: 'A',
        title: 'Workout A',
        focus: ['back', 'lats', 'chest', 'quads', 'glutes', 'biceps', 'abs'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'barbell-row', sets: 3, repMin: 5, repMax: 5, note: '3x5+; AMRAP last set' },
          { exerciseId: 'barbell-bench-press', sets: 3, repMin: 5, repMax: 5, note: '3x5+; AMRAP last set; +2.5 lb' },
          { exerciseId: 'back-squat', sets: 3, repMin: 5, repMax: 5, note: '3x5+; AMRAP last set; +5 lb' },
          { exerciseId: 'barbell-curl', sets: 3, repMin: 10, repMax: 15, note: 'optional arm accessory' },
          { exerciseId: 'plank', sets: 3, repMin: 10, repMax: 20, note: 'core, 30-60s holds' },
        ],
      },
      {
        label: 'B',
        title: 'Workout B',
        focus: ['lats', 'back', 'shoulders', 'hamstrings', 'lowerback', 'triceps', 'abs'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'chinup', sets: 3, repMin: 5, repMax: 5, note: '3x5+; AMRAP last set; lat-pulldown sub' },
          { exerciseId: 'overhead-press', sets: 3, repMin: 5, repMax: 5, note: '3x5+; AMRAP last set; +2.5 lb' },
          { exerciseId: 'deadlift', sets: 3, repMin: 5, repMax: 5, note: '3x5+; AMRAP last set; +5 lb' },
          { exerciseId: 'dips', sets: 3, repMin: 8, repMax: 12, note: 'optional push accessory' },
          { exerciseId: 'hanging-leg-raise', sets: 3, repMin: 10, repMax: 15, note: 'core accessory' },
        ],
      },
    ],
  },
  {
    id: 'wendler-531-beginners',
    name: '5/3/1 for Beginners',
    tagline: 'Two main lifts per day plus FSL and assistance',
    description:
      'The wiki\'s top long-term beginner strength program: two main lifts per day on a 5/3/1 wave (TM = 90% 1RM) with 5x5 First-Set-Last supplemental and mandatory push/pull/single-leg/core assistance every session. Add TM after each 3-week wave; "the program you can run for years."',
    daysPerWeek: 3,
    daysPerWeekOptions: [3],
    goalFit: ['strength'],
    level: 'beginner',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'Jim Wendler',
    evidenceTier: 'well-established',
    source: 'https://thefitness.wiki/routines/5-3-1-for-beginners/',
    schedule: [
      {
        label: 'Mon',
        title: 'Squat / Bench',
        focus: ['quads', 'glutes', 'chest', 'lats', 'abs'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'back-squat', sets: 3, repMin: 1, repMax: 5, note: '5/3/1 wave; AMRAP top set' },
          { exerciseId: 'back-squat', sets: 5, repMin: 5, repMax: 5, note: 'First-Set-Last 5x5' },
          { exerciseId: 'barbell-bench-press', sets: 3, repMin: 1, repMax: 5, note: '5/3/1 wave; AMRAP top set' },
          { exerciseId: 'barbell-bench-press', sets: 5, repMin: 5, repMax: 5, note: 'First-Set-Last 5x5' },
          { exerciseId: 'chinup', sets: 5, repMin: 10, repMax: 10, note: 'pull assistance ~50-100 reps' },
          { exerciseId: 'hanging-leg-raise', sets: 3, repMin: 15, repMax: 15, note: 'core assistance' },
        ],
      },
      {
        label: 'Wed',
        title: 'Deadlift / OHP',
        focus: ['lowerback', 'hamstrings', 'glutes', 'shoulders', 'triceps', 'quads'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'deadlift', sets: 3, repMin: 1, repMax: 5, note: '5/3/1 wave; AMRAP top set' },
          { exerciseId: 'deadlift', sets: 5, repMin: 5, repMax: 5, note: 'First-Set-Last 5x5' },
          { exerciseId: 'overhead-press', sets: 3, repMin: 1, repMax: 5, note: '5/3/1 wave; AMRAP top set' },
          { exerciseId: 'overhead-press', sets: 5, repMin: 5, repMax: 5, note: 'First-Set-Last 5x5' },
          { exerciseId: 'dips', sets: 5, repMin: 10, repMax: 10, note: 'push assistance ~50-100 reps' },
          { exerciseId: 'lunge', sets: 3, repMin: 12, repMax: 12, note: 'single-leg assistance' },
        ],
      },
      {
        label: 'Fri',
        title: 'Bench / Squat',
        focus: ['chest', 'shoulders', 'quads', 'glutes', 'back', 'abs'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'barbell-bench-press', sets: 3, repMin: 1, repMax: 5, note: '5/3/1 wave; AMRAP top set' },
          { exerciseId: 'barbell-bench-press', sets: 5, repMin: 5, repMax: 5, note: 'First-Set-Last 5x5' },
          { exerciseId: 'back-squat', sets: 3, repMin: 1, repMax: 5, note: '5/3/1 wave; AMRAP top set' },
          { exerciseId: 'back-squat', sets: 5, repMin: 5, repMax: 5, note: 'First-Set-Last 5x5' },
          { exerciseId: 'db-row', sets: 5, repMin: 10, repMax: 10, note: 'pull assistance ~50-100 reps' },
          { exerciseId: 'plank', sets: 3, repMin: 20, repMax: 20, note: 'core assistance' },
        ],
      },
    ],
  },
  {
    id: 'fierce-5',
    name: 'Fierce 5 (Novice Full-Body)',
    tagline: 'Hypertrophy-leaning novice full-body',
    description:
      'A balanced beginner full-body alternative to StrongLifts/Starting Strength with more accessory work: 3x5 strength compounds plus rows, face pulls, calves and direct arm work. Linear progression on mains, double progression on accessories; runs A/B three nonconsecutive days a week.',
    daysPerWeek: 3,
    daysPerWeekOptions: [2, 3],
    goalFit: ['general', 'hypertrophy', 'strength'],
    level: 'beginner',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'Fierce 5 / liftvault',
    evidenceTier: 'popular-reasonable',
    source: 'https://liftvault.com/programs/strength/fierce-5-novice-routine/',
    schedule: [
      {
        label: 'A',
        title: 'Workout A',
        focus: ['quads', 'glutes', 'chest', 'back', 'shoulders', 'calves', 'triceps'],
        lifts: [
          { exerciseId: 'back-squat', sets: 3, repMin: 5, repMax: 5, note: 'linear progression' },
          { exerciseId: 'barbell-bench-press', sets: 3, repMin: 5, repMax: 5, note: 'linear progression' },
          { exerciseId: 'barbell-row', sets: 3, repMin: 8, repMax: 8, note: 'Pendlay row' },
          { exerciseId: 'face-pull', sets: 3, repMin: 10, repMax: 10, note: 'rear delt / upper back' },
          { exerciseId: 'standing-calf-raise', sets: 2, repMin: 15, repMax: 15 },
          { exerciseId: 'triceps-pushdown', sets: 2, repMin: 10, repMax: 10 },
        ],
      },
      {
        label: 'B',
        title: 'Workout B',
        focus: ['quads', 'shoulders', 'hamstrings', 'lowerback', 'lats', 'biceps', 'abs'],
        lifts: [
          { exerciseId: 'front-squat', sets: 3, repMin: 5, repMax: 5, note: 'linear progression' },
          { exerciseId: 'overhead-press', sets: 3, repMin: 5, repMax: 5, note: 'linear progression' },
          { exerciseId: 'romanian-deadlift', sets: 3, repMin: 8, repMax: 8 },
          { exerciseId: 'lat-pulldown', sets: 3, repMin: 8, repMax: 8 },
          { exerciseId: 'hanging-leg-raise', sets: 2, repMin: 15, repMax: 15, note: 'ab work' },
          { exerciseId: 'barbell-curl', sets: 2, repMin: 10, repMax: 10 },
        ],
      },
    ],
  },
  {
    id: 'lyle-gbr',
    name: 'Lyle McDonald Generic Bulking Routine',
    tagline: 'Free intermediate upper/lower bodybuilding',
    description:
      'The canonical free answer to "what after StrongLifts/SS?": a 4-day upper/lower split hitting every muscle twice a week with real isolation volume baked in (calves, direct biceps/triceps). Three rep tiers run on double progression — heavy compounds, secondary work, then isolation.',
    daysPerWeek: 4,
    daysPerWeekOptions: [4],
    goalFit: ['hypertrophy', 'strength'],
    level: 'intermediate',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'Lyle McDonald',
    evidenceTier: 'well-established',
    source: 'https://liftvault.com/programs/bodybuilding/generic-bulking-routine-lyle-mcdonald/',
    schedule: [
      {
        label: 'UA',
        title: 'Upper A',
        focus: ['chest', 'back', 'lats', 'biceps', 'triceps'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'barbell-bench-press', sets: 4, repMin: 6, repMax: 8 },
          { exerciseId: 'barbell-row', sets: 4, repMin: 6, repMax: 8 },
          { exerciseId: 'incline-db-press', sets: 3, repMin: 10, repMax: 12 },
          { exerciseId: 'lat-pulldown', sets: 3, repMin: 10, repMax: 12 },
          { exerciseId: 'triceps-pushdown', sets: 2, repMin: 12, repMax: 15 },
          { exerciseId: 'db-curl', sets: 2, repMin: 12, repMax: 15 },
        ],
      },
      {
        label: 'LA',
        title: 'Lower A',
        focus: ['quads', 'hamstrings', 'glutes', 'calves'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'back-squat', sets: 4, repMin: 6, repMax: 8 },
          { exerciseId: 'romanian-deadlift', sets: 4, repMin: 6, repMax: 8 },
          { exerciseId: 'leg-press', sets: 3, repMin: 10, repMax: 12 },
          { exerciseId: 'leg-curl', sets: 3, repMin: 10, repMax: 12 },
          { exerciseId: 'standing-calf-raise', sets: 4, repMin: 8, repMax: 8 },
          { exerciseId: 'seated-calf-raise', sets: 2, repMin: 12, repMax: 12 },
        ],
      },
      {
        label: 'UB',
        title: 'Upper B',
        focus: ['chest', 'back', 'lats', 'shoulders', 'biceps', 'triceps'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'incline-bench-press', sets: 4, repMin: 6, repMax: 8 },
          { exerciseId: 'db-row', sets: 4, repMin: 6, repMax: 8 },
          { exerciseId: 'db-shoulder-press', sets: 3, repMin: 10, repMax: 12 },
          { exerciseId: 'pullup', sets: 3, repMin: 10, repMax: 12 },
          { exerciseId: 'overhead-triceps', sets: 2, repMin: 12, repMax: 15 },
          { exerciseId: 'cable-curl', sets: 2, repMin: 12, repMax: 15 },
        ],
      },
      {
        label: 'LB',
        title: 'Lower B',
        focus: ['quads', 'hamstrings', 'glutes', 'calves'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'deadlift', sets: 4, repMin: 6, repMax: 8 },
          { exerciseId: 'leg-press', sets: 3, repMin: 10, repMax: 12 },
          { exerciseId: 'leg-extension', sets: 3, repMin: 12, repMax: 15 },
          { exerciseId: 'leg-curl', sets: 3, repMin: 10, repMax: 12 },
          { exerciseId: 'standing-calf-raise', sets: 4, repMin: 8, repMax: 8 },
          { exerciseId: 'seated-calf-raise', sets: 2, repMin: 12, repMax: 12 },
        ],
      },
    ],
  },
  {
    id: 'nippard-pure-hypertrophy',
    name: 'Jeff Nippard Pure Bodybuilding (U/L)',
    tagline: 'Science-based machine-and-cable hypertrophy',
    description:
      'The modern "science-based" upper/lower split: a 5-day, 10-week program with RPE autoregulation, a dedicated arms/weak-point day, and far more machine-and-cable isolation variety than barbell-leaning templates. Working sets at RPE 9-10 with double progression inside the RPE caps.',
    daysPerWeek: 5,
    daysPerWeekOptions: [5],
    goalFit: ['hypertrophy'],
    level: 'intermediate',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'Jeff Nippard',
    evidenceTier: 'well-established',
    source: 'https://www.boostcamp.app/coaches/jeff-nippard/pure-bodybuilding-program',
    schedule: [
      {
        label: 'UA',
        title: 'Upper A',
        focus: ['shoulders', 'lats', 'chest', 'back', 'triceps'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'lateral-raise', sets: 3, repMin: 12, repMax: 12, note: 'cable' },
          { exerciseId: 'lat-pulldown', sets: 3, repMin: 10, repMax: 10, note: 'single-arm' },
          { exerciseId: 'incline-db-press', sets: 3, repMin: 10, repMax: 10 },
          { exerciseId: 'seated-cable-row', sets: 3, repMin: 10, repMax: 10, note: 'chest-supported' },
          { exerciseId: 'overhead-triceps', sets: 3, repMin: 12, repMax: 12, note: 'cable' },
          { exerciseId: 'cable-fly', sets: 3, repMin: 12, repMax: 12, note: 'pec deck' },
        ],
      },
      {
        label: 'LA',
        title: 'Lower A',
        focus: ['hamstrings', 'quads', 'glutes', 'calves'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'leg-curl', sets: 3, repMin: 12, repMax: 12, note: 'seated' },
          { exerciseId: 'leg-press', sets: 3, repMin: 10, repMax: 10 },
          { exerciseId: 'back-squat', sets: 3, repMin: 8, repMax: 8, note: 'hack squat' },
          { exerciseId: 'leg-extension', sets: 3, repMin: 12, repMax: 12 },
          { exerciseId: 'seated-calf-raise', sets: 3, repMin: 12, repMax: 12 },
        ],
      },
      {
        label: 'UB',
        title: 'Upper B',
        focus: ['back', 'lats', 'shoulders', 'chest', 'biceps'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'seated-cable-row', sets: 3, repMin: 10, repMax: 10 },
          { exerciseId: 'db-shoulder-press', sets: 3, repMin: 10, repMax: 10, note: 'machine' },
          { exerciseId: 'lat-pulldown', sets: 3, repMin: 10, repMax: 10 },
          { exerciseId: 'incline-bench-press', sets: 3, repMin: 10, repMax: 10 },
          { exerciseId: 'db-curl', sets: 3, repMin: 12, repMax: 12 },
          { exerciseId: 'lateral-raise', sets: 3, repMin: 15, repMax: 15 },
          { exerciseId: 'rear-delt-fly', sets: 3, repMin: 15, repMax: 15 },
        ],
      },
      {
        label: 'LB',
        title: 'Lower B',
        focus: ['hamstrings', 'quads', 'glutes', 'calves'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'leg-curl', sets: 3, repMin: 12, repMax: 12 },
          { exerciseId: 'leg-press', sets: 3, repMin: 12, repMax: 12 },
          { exerciseId: 'romanian-deadlift', sets: 3, repMin: 10, repMax: 10 },
          { exerciseId: 'leg-extension', sets: 3, repMin: 12, repMax: 12 },
          { exerciseId: 'standing-calf-raise', sets: 3, repMin: 12, repMax: 12 },
        ],
      },
      {
        label: 'Arms',
        title: 'Arms & Weak Points',
        focus: ['biceps', 'triceps', 'abs'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'cable-curl', sets: 3, repMin: 12, repMax: 12, note: 'Bayesian' },
          { exerciseId: 'overhead-triceps', sets: 3, repMin: 10, repMax: 10, note: 'skullcrusher' },
          { exerciseId: 'db-curl', sets: 2, repMin: 12, repMax: 12, note: 'spider curl' },
          { exerciseId: 'triceps-pushdown', sets: 2, repMin: 15, repMax: 15, note: 'kickback' },
          { exerciseId: 'cable-crunch', sets: 3, repMin: 15, repMax: 15 },
        ],
      },
    ],
  },
  {
    id: 'gzcl-jt2',
    name: 'GZCL Jacked & Tan 2.0',
    tagline: 'Intermediate GZCL powerbuilding',
    description:
      'The crown-jewel GZCL powerbuilding template: a 4-day, 12-week program pairing every barbell day with three dedicated isolation accessories on the 1:2:3 T1:T2:T3 volume ratio. T1 works up heavy, T2 builds with Max-Rep Sets, and T3 piles on the bodybuilding volume.',
    daysPerWeek: 4,
    daysPerWeekOptions: [4],
    goalFit: ['hypertrophy', 'strength'],
    level: 'intermediate',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'Cody LeFever',
    evidenceTier: 'well-established',
    source: 'https://www.boostcamp.app/coaches/cody-lefever/jacked-tan-2-0',
    schedule: [
      {
        label: 'D1',
        title: 'Squat',
        focus: ['quads', 'glutes', 'hamstrings', 'back', 'triceps', 'biceps'],
        lifts: [
          { exerciseId: 'back-squat', sets: 5, repMin: 5, repMax: 5, note: 'T1; work to ~10RM then back-off, AMRAP' },
          { exerciseId: 'deadlift', sets: 5, repMin: 6, repMax: 6, note: 'T2a deficit' },
          { exerciseId: 'db-row', sets: 4, repMin: 8, repMax: 8, note: 'T2b incline row; last set AMRAP (MRS)' },
          { exerciseId: 'triceps-pushdown', sets: 3, repMin: 15, repMax: 15, note: 'T3' },
          { exerciseId: 'barbell-row', sets: 3, repMin: 15, repMax: 15, note: 'T3 bent-over' },
          { exerciseId: 'hammer-curl', sets: 3, repMin: 15, repMax: 15, note: 'T3' },
        ],
      },
      {
        label: 'D2',
        title: 'Bench',
        focus: ['chest', 'triceps', 'shoulders', 'traps', 'back'],
        lifts: [
          { exerciseId: 'barbell-bench-press', sets: 5, repMin: 5, repMax: 5, note: 'T1 5x5+, AMRAP last set' },
          { exerciseId: 'close-grip-bench', sets: 5, repMin: 6, repMax: 6, note: 'T2a' },
          { exerciseId: 'db-shoulder-press', sets: 4, repMin: 8, repMax: 8, note: 'T2b; last set AMRAP (MRS)' },
          { exerciseId: 'shrug', sets: 3, repMin: 15, repMax: 15, note: 'T3' },
          { exerciseId: 'cable-fly', sets: 3, repMin: 15, repMax: 15, note: 'T3 pec deck' },
          { exerciseId: 'face-pull', sets: 3, repMin: 15, repMax: 15, note: 'T3' },
        ],
      },
      {
        label: 'D3',
        title: 'Deadlift',
        focus: ['lowerback', 'hamstrings', 'glutes', 'quads', 'lats', 'biceps'],
        lifts: [
          { exerciseId: 'deadlift', sets: 5, repMin: 5, repMax: 5, note: 'T1 5x5+, AMRAP last set' },
          { exerciseId: 'front-squat', sets: 5, repMin: 6, repMax: 6, note: 'T2a' },
          { exerciseId: 'lat-pulldown', sets: 4, repMin: 8, repMax: 8, note: 'T2b; last set AMRAP (MRS)' },
          { exerciseId: 'leg-extension', sets: 3, repMin: 15, repMax: 15, note: 'T3' },
          { exerciseId: 'db-row', sets: 3, repMin: 15, repMax: 15, note: 'T3 one-arm' },
          { exerciseId: 'barbell-curl', sets: 3, repMin: 15, repMax: 15, note: 'T3' },
        ],
      },
      {
        label: 'D4',
        title: 'OHP',
        focus: ['shoulders', 'chest', 'triceps', 'traps', 'biceps'],
        lifts: [
          { exerciseId: 'overhead-press', sets: 5, repMin: 5, repMax: 5, note: 'T1 5x5+, AMRAP last set' },
          { exerciseId: 'incline-bench-press', sets: 5, repMin: 6, repMax: 6, note: 'T2a' },
          { exerciseId: 'overhead-press', sets: 4, repMin: 8, repMax: 8, note: 'T2b push press; last set AMRAP (MRS)' },
          { exerciseId: 'triceps-pushdown', sets: 3, repMin: 15, repMax: 15, note: 'T3' },
          { exerciseId: 'shrug', sets: 3, repMin: 15, repMax: 15, note: 'T3' },
          { exerciseId: 'cable-curl', sets: 3, repMin: 15, repMax: 15, note: 'T3 incline' },
        ],
      },
    ],
  },
  {
    id: 'bullmastiff',
    name: 'Bullmastiff (Alex Bromley)',
    tagline: 'Base-building powerbuilding with a peak',
    description:
      'A 4-day, 18-week periodized powerbuilding program (9-week Base plus 9-week Peak, each three 3-week waves). Hard strength waves on the four lifts with AMRAP autoregulation (+1% load per extra rep) meet genuine bodybuilding back-end volume; each day pairs a main lift with an opposite-pattern developmental and accessories.',
    daysPerWeek: 4,
    daysPerWeekOptions: [4],
    goalFit: ['powerlifting', 'strength', 'hypertrophy'],
    level: 'intermediate',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'Alex Bromley',
    evidenceTier: 'well-established',
    source: 'https://www.boostcamp.app/coaches/alex-bromley/bullmastiff',
    schedule: [
      {
        label: 'D1',
        title: 'Squat',
        focus: ['quads', 'glutes', 'hamstrings', 'back', 'abs'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'back-squat', sets: 5, repMin: 4, repMax: 6, note: 'main wave; last set AMRAP, +1% per extra rep' },
          { exerciseId: 'romanian-deadlift', sets: 4, repMin: 10, repMax: 10, note: 'developmental, RPE 6-8' },
          { exerciseId: 'barbell-row', sets: 3, repMin: 12, repMax: 12 },
          { exerciseId: 'leg-curl', sets: 2, repMin: 15, repMax: 15 },
          { exerciseId: 'leg-extension', sets: 2, repMin: 15, repMax: 15 },
          { exerciseId: 'cable-crunch', sets: 2, repMin: 15, repMax: 15 },
        ],
      },
      {
        label: 'D2',
        title: 'Bench',
        focus: ['chest', 'shoulders', 'triceps', 'biceps'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'barbell-bench-press', sets: 5, repMin: 4, repMax: 6, note: 'main wave; last set AMRAP, +1% per extra rep' },
          { exerciseId: 'overhead-press', sets: 4, repMin: 10, repMax: 10, note: 'developmental, tempo' },
          { exerciseId: 'overhead-triceps', sets: 3, repMin: 15, repMax: 15 },
          { exerciseId: 'db-curl', sets: 2, repMin: 15, repMax: 15 },
          { exerciseId: 'rear-delt-fly', sets: 2, repMin: 15, repMax: 15 },
        ],
      },
      {
        label: 'D3',
        title: 'Deadlift',
        focus: ['lowerback', 'hamstrings', 'glutes', 'quads', 'lats', 'abs'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'deadlift', sets: 5, repMin: 4, repMax: 6, note: 'main wave; last set AMRAP, +1% per extra rep' },
          { exerciseId: 'front-squat', sets: 4, repMin: 10, repMax: 10, note: 'developmental' },
          { exerciseId: 'lat-pulldown', sets: 3, repMin: 12, repMax: 12 },
          { exerciseId: 'leg-curl', sets: 2, repMin: 15, repMax: 15 },
          { exerciseId: 'leg-extension', sets: 2, repMin: 15, repMax: 15 },
          { exerciseId: 'cable-crunch', sets: 2, repMin: 15, repMax: 15 },
        ],
      },
      {
        label: 'D4',
        title: 'OHP',
        focus: ['shoulders', 'chest', 'triceps', 'biceps'],
        goal: 'strength',
        lifts: [
          { exerciseId: 'overhead-press', sets: 5, repMin: 4, repMax: 6, note: 'main wave; last set AMRAP, +1% per extra rep' },
          { exerciseId: 'close-grip-bench', sets: 4, repMin: 10, repMax: 10, note: 'developmental, Spoto sub' },
          { exerciseId: 'triceps-pushdown', sets: 3, repMin: 15, repMax: 15 },
          { exerciseId: 'barbell-curl', sets: 2, repMin: 15, repMax: 15 },
          { exerciseId: 'rear-delt-fly', sets: 2, repMin: 15, repMax: 15 },
        ],
      },
    ],
  },
  {
    id: 'arnold-split',
    name: 'Arnold Split (Golden-Era 6-Day)',
    tagline: 'Antagonist chest/back, shoulders/arms, legs',
    description:
      'The most-loved old-school physique routine: a recovery-demanding 6-day split pairing Chest/Back (agonist-antagonist supersets), a brutal Shoulders/Arms day and Legs, with abs every session. Mostly 5x8-12. Advanced and very high-volume — bring a serious recovery and nutrition base.',
    daysPerWeek: 6,
    daysPerWeekOptions: [6],
    goalFit: ['hypertrophy'],
    level: 'advanced',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'Arnold Schwarzenegger / StrengthLog',
    evidenceTier: 'popular-reasonable',
    source: 'https://www.strengthlog.com/arnold-split/',
    schedule: [
      {
        label: 'CB',
        title: 'Chest & Back',
        focus: ['chest', 'back', 'lats', 'lowerback', 'abs'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'barbell-bench-press', sets: 5, repMin: 8, repMax: 12 },
          { exerciseId: 'incline-bench-press', sets: 5, repMin: 8, repMax: 12 },
          { exerciseId: 'cable-fly', sets: 5, repMin: 8, repMax: 12, note: 'DB pullover sub' },
          { exerciseId: 'pullup', sets: 4, repMin: 8, repMax: 12, note: 'to failure' },
          { exerciseId: 'barbell-row', sets: 5, repMin: 8, repMax: 12 },
          { exerciseId: 'deadlift', sets: 3, repMin: 4, repMax: 10, note: '10/6/4 descending' },
          { exerciseId: 'hanging-leg-raise', sets: 5, repMin: 20, repMax: 20 },
        ],
      },
      {
        label: 'SA',
        title: 'Shoulders & Arms',
        focus: ['shoulders', 'biceps', 'triceps', 'forearms', 'abs'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'overhead-press', sets: 5, repMin: 8, repMax: 12 },
          { exerciseId: 'lateral-raise', sets: 5, repMin: 8, repMax: 12 },
          { exerciseId: 'overhead-press', sets: 5, repMin: 8, repMax: 12, note: 'push press' },
          { exerciseId: 'barbell-curl', sets: 5, repMin: 8, repMax: 12 },
          { exerciseId: 'db-curl', sets: 5, repMin: 8, repMax: 12 },
          { exerciseId: 'close-grip-bench', sets: 5, repMin: 8, repMax: 12 },
          { exerciseId: 'overhead-triceps', sets: 5, repMin: 8, repMax: 12, note: 'lying extension' },
          { exerciseId: 'wrist-curl', sets: 5, repMin: 8, repMax: 12 },
          { exerciseId: 'bicycle-crunch', sets: 5, repMin: 25, repMax: 25, note: 'crunch' },
        ],
      },
      {
        label: 'Legs',
        title: 'Legs',
        focus: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'back-squat', sets: 5, repMin: 8, repMax: 12 },
          { exerciseId: 'lunge', sets: 5, repMin: 8, repMax: 12 },
          { exerciseId: 'leg-curl', sets: 5, repMin: 8, repMax: 12 },
          { exerciseId: 'standing-calf-raise', sets: 5, repMin: 8, repMax: 12 },
          { exerciseId: 'romanian-deadlift', sets: 3, repMin: 4, repMax: 10, note: 'stiff-leg, 10/6/4' },
          { exerciseId: 'hanging-leg-raise', sets: 5, repMin: 20, repMax: 20 },
        ],
      },
    ],
  },
  {
    id: 'super-squats',
    name: 'Super Squats (20-Rep)',
    tagline: '6-week breathing-squat mass block',
    description:
      'A legendary finite mass program built around a single all-out 20-rep "breathing squat" set: load your 10RM and grind 20 reps, adding 5 lb to the bar every session. A real accessory shell (press, pullover, bench, row, stiff-leg) surrounds it. Run as a 6-week block, not year-round.',
    daysPerWeek: 3,
    daysPerWeekOptions: [2, 3],
    goalFit: ['hypertrophy', 'strength'],
    level: 'intermediate',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'Randall Strossen',
    evidenceTier: 'popular-reasonable',
    source: 'https://empire-barbell.com/super-squats-review/',
    schedule: [
      {
        label: 'FB',
        title: 'Full Body',
        focus: ['quads', 'glutes', 'chest', 'shoulders', 'back', 'biceps'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'overhead-press', sets: 3, repMin: 12, repMax: 12 },
          { exerciseId: 'back-squat', sets: 1, repMin: 20, repMax: 20, note: 'breathing squats; 10RM for 20, +5 lb/session' },
          { exerciseId: 'cable-fly', sets: 1, repMin: 20, repMax: 20, note: 'cross-bench DB pullover sub, light' },
          { exerciseId: 'barbell-bench-press', sets: 3, repMin: 12, repMax: 12 },
          { exerciseId: 'barbell-row', sets: 3, repMin: 15, repMax: 15 },
          { exerciseId: 'romanian-deadlift', sets: 1, repMin: 15, repMax: 15, note: 'stiff-leg' },
          { exerciseId: 'barbell-curl', sets: 2, repMin: 10, repMax: 10, note: 'optional arm work' },
        ],
      },
    ],
  },
  {
    id: 'arnold-golden-six',
    name: "Arnold's Golden Six",
    tagline: 'Old-school beginner full-body classic',
    description:
      'The most-recommended entry into old-school bodybuilding: a simple full-body routine of six compound exercises, three days a week. Add weight or reps at the top of each range. A nostalgic, well-loved beginner hypertrophy classic that pairs naturally with the advanced Arnold Split as a "start here" option.',
    daysPerWeek: 3,
    daysPerWeekOptions: [2, 3],
    goalFit: ['hypertrophy', 'general'],
    level: 'beginner',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'Arnold Schwarzenegger / liftvault',
    evidenceTier: 'popular-reasonable',
    source: 'https://liftvault.com/programs/bodybuilding/golden-six-workout/',
    schedule: [
      {
        label: 'FB',
        title: 'Full Body',
        focus: ['quads', 'glutes', 'chest', 'shoulders', 'lats', 'biceps', 'abs'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'back-squat', sets: 4, repMin: 10, repMax: 10 },
          { exerciseId: 'barbell-bench-press', sets: 3, repMin: 10, repMax: 10, note: 'wide-grip' },
          { exerciseId: 'chinup', sets: 3, repMin: 8, repMax: 12, note: 'to failure' },
          { exerciseId: 'overhead-press', sets: 4, repMin: 10, repMax: 10, note: 'OHP sub for behind-neck press' },
          { exerciseId: 'barbell-curl', sets: 3, repMin: 10, repMax: 10, note: 'standing' },
          { exerciseId: 'hanging-leg-raise', sets: 3, repMin: 10, repMax: 20, note: 'bent-knee sit-up sub; to failure' },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // Powerlifting (full-gym)
  // ---------------------------------------------------------------------------
  {
    id: 'sheiko',
    name: 'Sheiko #29/#30',
    tagline: 'Russian high-volume percentage powerlifting',
    description:
      'Three-day full-body big-3 rotation off competition 1RM percentages: squat twice, bench three times and deadlift once weekly. Wraps the classic Sheiko GPP shell — upper-back work, direct arms, core and rear-delt health — around the percentage-based big-3 sets.',
    daysPerWeek: 3,
    daysPerWeekOptions: [3],
    goalFit: ['powerlifting', 'strength'],
    level: 'advanced',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'Boris Sheiko',
    evidenceTier: 'well-established',
    source: 'https://www.powerliftingtowin.com/sheiko/',
    schedule: [
      {
        label: 'Mon',
        title: 'Squat / Bench Emphasis',
        focus: ['quads', 'glutes', 'chest', 'triceps', 'lats', 'abs'],
        goal: 'powerlifting',
        lifts: [
          { exerciseId: 'barbell-bench-press', sets: 10, repMin: 3, repMax: 5, note: '50-80% comp 1RM' },
          { exerciseId: 'back-squat', sets: 8, repMin: 2, repMax: 5, note: '55-85% comp 1RM' },
          { exerciseId: 'db-bench-press', sets: 5, repMin: 10, repMax: 10, note: 'GPP accessory' },
          { exerciseId: 'romanian-deadlift', sets: 5, repMin: 5, repMax: 5, note: 'good morning, GPP' },
          { exerciseId: 'lat-pulldown', sets: 4, repMin: 8, repMax: 10, note: 'upper back GPP' },
          { exerciseId: 'hanging-leg-raise', sets: 4, repMin: 15, repMax: 15, note: 'core GPP' },
        ],
      },
      {
        label: 'Wed',
        title: 'Deadlift / Bench Emphasis',
        focus: ['lowerback', 'hamstrings', 'chest', 'back', 'biceps', 'triceps'],
        goal: 'powerlifting',
        lifts: [
          { exerciseId: 'barbell-bench-press', sets: 9, repMin: 3, repMax: 5, note: '55-80% comp 1RM' },
          { exerciseId: 'deadlift', sets: 8, repMin: 2, repMax: 5, note: '55-85% comp 1RM' },
          { exerciseId: 'close-grip-bench', sets: 5, repMin: 3, repMax: 4, note: '~70-75% variation' },
          { exerciseId: 'pullup', sets: 5, repMin: 6, repMax: 10, note: 'GPP accessory' },
          { exerciseId: 'barbell-curl', sets: 3, repMin: 10, repMax: 10, note: 'arm GPP' },
          { exerciseId: 'triceps-pushdown', sets: 3, repMin: 12, repMax: 12, note: 'arm GPP' },
        ],
      },
      {
        label: 'Fri',
        title: 'Squat / Bench Emphasis',
        focus: ['quads', 'glutes', 'chest', 'triceps', 'shoulders', 'abs'],
        goal: 'powerlifting',
        lifts: [
          { exerciseId: 'back-squat', sets: 9, repMin: 3, repMax: 5, note: '55-80% comp 1RM' },
          { exerciseId: 'barbell-bench-press', sets: 8, repMin: 3, repMax: 5, note: '50-80% comp 1RM' },
          { exerciseId: 'front-squat', sets: 4, repMin: 3, repMax: 5, note: '~65-75% variation' },
          { exerciseId: 'overhead-triceps', sets: 5, repMin: 8, repMax: 12, note: 'GPP accessory' },
          { exerciseId: 'rear-delt-fly', sets: 3, repMin: 15, repMax: 15, note: 'shoulder health GPP' },
          { exerciseId: 'cable-crunch', sets: 4, repMin: 15, repMax: 15, note: 'core GPP' },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // Bodyweight
  // ---------------------------------------------------------------------------
  {
    id: 'rr-bodyweight',
    name: 'r/bodyweightfitness Recommended Routine',
    tagline: 'Community-vetted beginner calisthenics',
    description:
      'Full-body bodyweight routine three days a week using paired push/pull/legs supersets with movement-progression ladders and double progression.',
    daysPerWeek: 3,
    daysPerWeekOptions: [3],
    goalFit: ['general'],
    level: 'beginner',
    equipment: 'Bodyweight',
    equipmentContext: 'bodyweight',
    author: 'r/bodyweightfitness community',
    evidenceTier: 'well-established',
    source: 'https://www.reddit.com/r/bodyweightfitness/wiki/kb/recommended_routine',
    schedule: [
      {
        label: 'FB',
        title: 'Full Body',
        focus: ['lats', 'chest', 'quads', 'glutes', 'back', 'abs'],
        lifts: [
          { exerciseId: 'pullup', sets: 3, repMin: 5, repMax: 8, note: 'pull-up progression; advance at 3x8' },
          { exerciseId: 'bulgarian-split-squat', sets: 3, repMin: 5, repMax: 8, note: 'squat progression to pistol' },
          { exerciseId: 'dips', sets: 3, repMin: 5, repMax: 8, note: 'dip progression' },
          { exerciseId: 'romanian-deadlift', sets: 3, repMin: 5, repMax: 8, note: 'hinge progression to Nordic curl' },
          { exerciseId: 'inverted-row', sets: 3, repMin: 5, repMax: 8, note: 'row progression' },
          { exerciseId: 'pushup', sets: 3, repMin: 5, repMax: 8, note: 'push-up progression' },
          { exerciseId: 'plank', sets: 3, repMin: 8, repMax: 12, note: 'core triplet, 30-60s holds' },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // Home / minimal
  // ---------------------------------------------------------------------------
  {
    id: 'dumbbell-full-body-3',
    name: '3-Day Full-Body Dumbbell',
    tagline: 'Dumbbell-only full-body for home',
    description:
      'Three distinct full-body dumbbell workouts a week with compound-first ordering and double progression by feel.',
    daysPerWeek: 3,
    daysPerWeekOptions: [2, 3],
    goalFit: ['hypertrophy', 'general'],
    level: 'beginner',
    equipment: 'Minimal',
    equipmentContext: 'home-dumbbell',
    author: 'Josh England, Muscle & Strength',
    evidenceTier: 'popular-reasonable',
    source: 'https://www.muscleandstrength.com/workouts/3-day-full-body-dumbbell-workout',
    schedule: [
      {
        label: 'D1',
        title: 'Day 1',
        focus: ['quads', 'hamstrings', 'back', 'chest', 'shoulders', 'biceps', 'triceps'],
        lifts: [
          { exerciseId: 'goblet-squat', sets: 3, repMin: 10, repMax: 10, note: 'dumbbell squat' },
          { exerciseId: 'romanian-deadlift', sets: 3, repMin: 10, repMax: 10, note: 'stiff-leg DL' },
          { exerciseId: 'db-row', sets: 3, repMin: 10, repMax: 10 },
          { exerciseId: 'db-bench-press', sets: 3, repMin: 10, repMax: 10 },
          { exerciseId: 'lateral-raise', sets: 2, repMin: 8, repMax: 8 },
          { exerciseId: 'db-curl', sets: 2, repMin: 8, repMax: 8 },
          { exerciseId: 'overhead-triceps', sets: 2, repMin: 8, repMax: 8 },
        ],
      },
      {
        label: 'D2',
        title: 'Day 2',
        focus: ['quads', 'hamstrings', 'shoulders', 'chest', 'biceps', 'triceps'],
        lifts: [
          { exerciseId: 'lunge', sets: 3, repMin: 10, repMax: 10, note: 'dumbbell lunge' },
          { exerciseId: 'leg-curl', sets: 3, repMin: 10, repMax: 10, note: 'dumbbell hamstring curl' },
          { exerciseId: 'deadlift', sets: 3, repMin: 10, repMax: 10, note: 'dumbbell deadlift' },
          { exerciseId: 'db-shoulder-press', sets: 3, repMin: 10, repMax: 10, note: 'military press' },
          { exerciseId: 'cable-fly', sets: 2, repMin: 8, repMax: 8, note: 'dumbbell flye' },
          { exerciseId: 'hammer-curl', sets: 2, repMin: 8, repMax: 8 },
          { exerciseId: 'overhead-triceps', sets: 2, repMin: 8, repMax: 8, note: 'seated extension' },
        ],
      },
      {
        label: 'D3',
        title: 'Day 3',
        focus: ['quads', 'hamstrings', 'back', 'shoulders', 'biceps', 'triceps'],
        lifts: [
          { exerciseId: 'lunge', sets: 3, repMin: 10, repMax: 10, note: 'dumbbell step-up' },
          { exerciseId: 'romanian-deadlift', sets: 3, repMin: 10, repMax: 10, note: 'stiff-leg DL' },
          { exerciseId: 'db-row', sets: 3, repMin: 10, repMax: 10, note: 'one-arm row' },
          { exerciseId: 'incline-db-press', sets: 3, repMin: 10, repMax: 10, note: 'reverse-grip press' },
          { exerciseId: 'rear-delt-fly', sets: 2, repMin: 8, repMax: 8 },
          { exerciseId: 'db-curl', sets: 2, repMin: 8, repMax: 8, note: 'Zottman curl' },
          { exerciseId: 'close-grip-bench', sets: 2, repMin: 8, repMax: 8, note: 'close-grip DB press' },
        ],
      },
    ],
  },
  {
    id: 'band-travel-circuit',
    name: 'Travel Resistance Band Circuit',
    tagline: 'Packable full-body band circuit',
    description:
      'A single full-body resistance-band circuit run for one to four rounds, ideal for maintaining muscle and conditioning while traveling.',
    daysPerWeek: 3,
    daysPerWeekOptions: [3],
    goalFit: ['general', 'endurance'],
    level: 'beginner',
    equipment: 'Minimal',
    equipmentContext: 'minimal',
    author: 'Rachael Sacerdoti, Coach',
    evidenceTier: 'popular-reasonable',
    source: 'https://www.coachweb.com/exercises/free-weight-exercises/2497/travel-gym-workout',
    schedule: [
      {
        label: 'Circuit',
        title: 'Full-Body Band Circuit',
        focus: ['quads', 'glutes', 'back', 'chest', 'shoulders', 'triceps', 'abs'],
        goal: 'endurance',
        lifts: [
          { exerciseId: 'goblet-squat', sets: 4, repMin: 12, repMax: 12, note: 'band squat; 1-4 rounds' },
          { exerciseId: 'lunge', sets: 4, repMin: 6, repMax: 6, note: 'band reverse lunge each side' },
          { exerciseId: 'barbell-row', sets: 4, repMin: 12, repMax: 12, note: 'band bent-over row' },
          { exerciseId: 'triceps-pushdown', sets: 4, repMin: 12, repMax: 12, note: 'band kick-back' },
          { exerciseId: 'overhead-press', sets: 4, repMin: 12, repMax: 12, note: 'band overhead press' },
          { exerciseId: 'lateral-raise', sets: 4, repMin: 12, repMax: 12, note: 'band lateral raise' },
          { exerciseId: 'bicycle-crunch', sets: 4, repMin: 12, repMax: 12, note: 'core station' },
        ],
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // Women-oriented, glute / lower-body emphasis (inclusive — available to everyone)
  // ---------------------------------------------------------------------------
  {
    id: 'strong-curves',
    name: 'Strong Curves',
    tagline: 'Glute-focused full-body hypertrophy',
    description:
      'A hip-thrust–centric full-body program popularized by glute researcher Bret Contreras. Three full-body days a week bias volume toward glutes and hamstrings while keeping balanced upper-body work, so you build lower-body shape without neglecting the rest. Loads climb by double progression within each rep range.',
    daysPerWeek: 3,
    daysPerWeekOptions: [3, 4],
    goalFit: ['hypertrophy', 'general'],
    level: 'all',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    author: 'Bret Contreras',
    evidenceTier: 'popular-reasonable',
    source: 'https://bretcontreras.com/',
    genderAffinity: 'female',
    schedule: [
      {
        label: 'A',
        title: 'Glute-Focus Full Body A',
        focus: ['glutes', 'hamstrings', 'quads', 'chest', 'shoulders', 'abs'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'hip-thrust', sets: 4, repMin: 8, repMax: 12, note: 'primary glute lift; pause + squeeze at top' },
          { exerciseId: 'goblet-squat', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'db-bench-press', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'db-shoulder-press', sets: 3, repMin: 10, repMax: 12 },
          { exerciseId: 'glute-bridge', sets: 3, repMin: 12, repMax: 15, note: 'glute burnout' },
          { exerciseId: 'plank', sets: 3, repMin: 8, repMax: 12, note: 'core' },
        ],
      },
      {
        label: 'B',
        title: 'Glute-Focus Full Body B',
        focus: ['glutes', 'hamstrings', 'back', 'lats', 'biceps', 'abs'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'romanian-deadlift', sets: 4, repMin: 8, repMax: 12, note: 'hamstrings + glutes' },
          { exerciseId: 'hip-thrust', sets: 3, repMin: 10, repMax: 15 },
          { exerciseId: 'lat-pulldown', sets: 3, repMin: 10, repMax: 12 },
          { exerciseId: 'db-row', sets: 3, repMin: 10, repMax: 12 },
          { exerciseId: 'cable-curl', sets: 3, repMin: 12, repMax: 15 },
          { exerciseId: 'hanging-leg-raise', sets: 3, repMin: 8, repMax: 12, note: 'core' },
        ],
      },
      {
        label: 'C',
        title: 'Glute-Focus Full Body C',
        focus: ['glutes', 'quads', 'hamstrings', 'shoulders', 'abs'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'hip-thrust', sets: 4, repMin: 8, repMax: 12 },
          { exerciseId: 'bulgarian-split-squat', sets: 3, repMin: 8, repMax: 12, note: 'each leg' },
          { exerciseId: 'leg-curl', sets: 3, repMin: 10, repMax: 15 },
          { exerciseId: 'lunge', sets: 3, repMin: 10, repMax: 12, note: 'each leg' },
          { exerciseId: 'lateral-raise', sets: 3, repMin: 12, repMax: 15 },
          { exerciseId: 'glute-bridge', sets: 2, repMin: 15, repMax: 20, note: 'burnout' },
        ],
      },
    ],
  },
  {
    id: 'glute-upper-lower',
    name: 'Glute-Focus Upper/Lower',
    tagline: 'Lower days built around glutes · 4×/week',
    description:
      'A four-day upper/lower split that biases both lower days toward glute and hamstring development (hip thrusts, RDLs, split squats) while training the upper body in full. A strong intermediate choice for lower-body emphasis with balanced overall physique work.',
    daysPerWeek: 4,
    daysPerWeekOptions: [4],
    goalFit: ['hypertrophy', 'general'],
    level: 'intermediate',
    equipment: 'Full gym',
    equipmentContext: 'full-gym',
    evidenceTier: 'popular-reasonable',
    genderAffinity: 'female',
    schedule: [
      {
        label: 'L1',
        title: 'Lower · Glute Emphasis',
        focus: ['glutes', 'hamstrings', 'quads', 'abs'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'hip-thrust', sets: 4, repMin: 8, repMax: 12 },
          { exerciseId: 'romanian-deadlift', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'bulgarian-split-squat', sets: 3, repMin: 8, repMax: 12, note: 'each leg' },
          { exerciseId: 'leg-curl', sets: 3, repMin: 10, repMax: 15 },
          { exerciseId: 'cable-crunch', sets: 3, repMin: 12, repMax: 15, note: 'core' },
        ],
      },
      {
        label: 'U1',
        title: 'Upper A',
        focus: ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'lats'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'db-bench-press', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'lat-pulldown', sets: 3, repMin: 10, repMax: 12 },
          { exerciseId: 'db-shoulder-press', sets: 3, repMin: 10, repMax: 12 },
          { exerciseId: 'seated-cable-row', sets: 3, repMin: 10, repMax: 12 },
          { exerciseId: 'cable-curl', sets: 3, repMin: 12, repMax: 15 },
          { exerciseId: 'triceps-pushdown', sets: 3, repMin: 12, repMax: 15 },
        ],
      },
      {
        label: 'L2',
        title: 'Lower · Hamstring & Glute',
        focus: ['glutes', 'hamstrings', 'quads', 'calves'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'romanian-deadlift', sets: 4, repMin: 8, repMax: 12 },
          { exerciseId: 'hip-thrust', sets: 3, repMin: 10, repMax: 15 },
          { exerciseId: 'lunge', sets: 3, repMin: 10, repMax: 12, note: 'each leg' },
          { exerciseId: 'leg-curl', sets: 3, repMin: 10, repMax: 15 },
          { exerciseId: 'standing-calf-raise', sets: 4, repMin: 10, repMax: 15 },
        ],
      },
      {
        label: 'U2',
        title: 'Upper B',
        focus: ['shoulders', 'back', 'chest', 'biceps', 'triceps', 'lats'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'incline-db-press', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'db-row', sets: 3, repMin: 10, repMax: 12 },
          { exerciseId: 'lateral-raise', sets: 4, repMin: 12, repMax: 15 },
          { exerciseId: 'face-pull', sets: 3, repMin: 12, repMax: 15 },
          { exerciseId: 'db-curl', sets: 3, repMin: 10, repMax: 12 },
          { exerciseId: 'overhead-triceps', sets: 3, repMin: 10, repMax: 12 },
        ],
      },
    ],
  },
  {
    id: 'home-glutes-body',
    name: 'Home Glutes & Body',
    tagline: 'Dumbbell glute + full-body · minimal gear',
    description:
      'A three-day full-body program you can run at home with dumbbells and a bench. Every session leads with a glute or hamstring movement, then trains the whole body, so you build lower-body shape and overall strength without a full gym. Add load or reps whenever you top the range.',
    daysPerWeek: 3,
    daysPerWeekOptions: [3, 4],
    goalFit: ['hypertrophy', 'general'],
    level: 'beginner',
    equipment: 'Minimal',
    equipmentContext: 'home-dumbbell',
    evidenceTier: 'popular-reasonable',
    genderAffinity: 'female',
    schedule: [
      {
        label: 'A',
        title: 'Glutes + Push (Home)',
        focus: ['glutes', 'quads', 'chest', 'shoulders', 'abs'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'glute-bridge', sets: 4, repMin: 10, repMax: 15, note: 'hold a dumbbell on the hips' },
          { exerciseId: 'goblet-squat', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'db-bench-press', sets: 3, repMin: 8, repMax: 12 },
          { exerciseId: 'db-shoulder-press', sets: 3, repMin: 10, repMax: 12 },
          { exerciseId: 'plank', sets: 3, repMin: 8, repMax: 12, note: 'core' },
        ],
      },
      {
        label: 'B',
        title: 'Hamstrings + Pull (Home)',
        focus: ['hamstrings', 'glutes', 'back', 'lats', 'biceps'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'romanian-deadlift', sets: 4, repMin: 8, repMax: 12, note: 'dumbbells' },
          { exerciseId: 'bulgarian-split-squat', sets: 3, repMin: 8, repMax: 12, note: 'each leg' },
          { exerciseId: 'db-row', sets: 3, repMin: 10, repMax: 12 },
          { exerciseId: 'db-curl', sets: 3, repMin: 10, repMax: 12 },
          { exerciseId: 'glute-bridge', sets: 3, repMin: 12, repMax: 20, note: 'burnout' },
        ],
      },
      {
        label: 'C',
        title: 'Lower Burn + Shoulders (Home)',
        focus: ['glutes', 'quads', 'hamstrings', 'shoulders', 'abs'],
        goal: 'hypertrophy',
        lifts: [
          { exerciseId: 'lunge', sets: 4, repMin: 10, repMax: 12, note: 'each leg; dumbbells' },
          { exerciseId: 'goblet-squat', sets: 3, repMin: 10, repMax: 15 },
          { exerciseId: 'glute-bridge', sets: 3, repMin: 12, repMax: 15 },
          { exerciseId: 'lateral-raise', sets: 3, repMin: 12, repMax: 15 },
          { exerciseId: 'hanging-leg-raise', sets: 3, repMin: 8, repMax: 12, note: 'or lying leg raise; core' },
        ],
      },
    ],
  },
]

export const PLAN_BY_ID: Record<string, WorkoutPlan> = Object.fromEntries(
  PLANS.map((p) => [p.id, p]),
)

/**
 * Merge DB-managed plans over the bundled catalogue: a remote plan with the same id OVERRIDES the
 * bundled one; remote-only plans are appended. Bundled order is preserved (offline-first — the bundled
 * set is always the baseline). Pure; drives both the browse catalogue and the by-id registry below.
 */
export function mergeCatalogue(remote: readonly WorkoutPlan[] | null | undefined): WorkoutPlan[] {
  if (!remote || remote.length === 0) return PLANS
  const byId = new Map<string, WorkoutPlan>(remote.map((p) => [p.id, p]))
  const merged = PLANS.map((p) => byId.get(p.id) ?? p)
  const bundledIds = new Set(PLANS.map((p) => p.id))
  for (const p of remote) if (!bundledIds.has(p.id)) merged.push(p)
  return merged
}

// Runtime by-id registry for getPlan(). Defaults to the bundled catalogue (so resolution works
// offline + before any DB fetch) and is overlaid by DB plans once loaded — see setRuntimePlans.
let runtimeById: Record<string, WorkoutPlan> = PLAN_BY_ID

/** Point getPlan() at a (merged) catalogue. Called when DB plans load; safe to call repeatedly. */
export function setRuntimePlans(catalogue: readonly WorkoutPlan[]): void {
  runtimeById = Object.fromEntries(catalogue.map((p) => [p.id, p]))
}

export function getPlan(id: string): WorkoutPlan | undefined {
  return runtimeById[id]
}

/** The equipment a plan narrows generation to (undefined = use the user's full set). */
export function planEquipment(plan: WorkoutPlan): Equipment[] | undefined {
  const ctx = plan.equipmentContext ?? contextFromLabel(plan.equipment)
  switch (ctx) {
    case 'bodyweight':
      return ['bodyweight', 'pullupbar', 'bands']
    case 'minimal':
      return ['bands', 'dumbbell', 'bodyweight', 'pullupbar']
    case 'home-dumbbell':
      return ['dumbbell', 'kettlebell', 'bench', 'bands', 'bodyweight', 'pullupbar']
    default:
      return undefined // full gym — use the user's full set
  }
}

function contextFromLabel(label: WorkoutPlan['equipment']): EquipmentContext {
  if (label === 'Bodyweight') return 'bodyweight'
  if (label === 'Minimal') return 'home-dumbbell'
  return 'full-gym'
}
