// ---- Core domain model ----

export type MuscleGroup =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'abs'
  | 'traps'
  | 'lats'
  | 'lowerback'

export type Equipment =
  | 'barbell'
  | 'dumbbell'
  | 'machine'
  | 'cable'
  | 'kettlebell'
  | 'bodyweight'
  | 'bands'
  | 'pullupbar'
  | 'bench'
  | 'ezbar'

export type Goal = 'strength' | 'hypertrophy' | 'endurance' | 'general' | 'powerlifting'

export type Experience = 'beginner' | 'intermediate' | 'advanced'

export type Unit = 'lb' | 'kg'

export type Theme = 'system' | 'light' | 'dark'

export type ExerciseCategory = 'compound' | 'isolation' | 'cardio' | 'core'

export interface Exercise {
  id: string
  name: string
  category: ExerciseCategory
  equipment: Equipment[]
  /** primary muscles get full recovery cost */
  primary: MuscleGroup[]
  /** secondary muscles get partial recovery cost */
  secondary: MuscleGroup[]
  /** rough difficulty 1-3, used for beginner filtering */
  difficulty: 1 | 2 | 3
  /** is this a unilateral movement (per-side logging hint) */
  unilateral?: boolean
  instructions: string[]
}

export interface LoggedSet {
  id: string
  weight: number
  reps: number
  /** completed = checked off during the session */
  done: boolean
  /** warmup sets don't count toward working volume */
  warmup?: boolean
}

/** direction of a progression cue vs last session */
export type Dir = 'up' | 'down' | 'same'

/** per-exercise coaching cue derived from the progression engine */
export interface Coaching {
  /** unit-free one-line rationale, e.g. "hit your reps" or "Deload −10% · rebuild from here" */
  note?: string
  /** the load increase for this session (display unit) — rendered as "+X {unit}" at DISPLAY time so
   *  it stays correct after a unit switch (converted alongside set weights), instead of baking "+5 lb" */
  incWeight?: number
  weightDir: Dir
  repsDir: Dir
}

export interface WorkoutExercise {
  exerciseId: string
  /**
   * Stable per-block id, unique within a session. A plan day can prescribe the SAME exercise
   * twice (e.g. 5/3/1 main + supplemental), so set/edit/remove handlers key on this — not
   * exerciseId — to avoid the two blocks colliding. Optional for back-compat with older
   * persisted sessions (handlers fall back to exerciseId when absent).
   */
  instanceId?: string
  /** the plan lift's ORIGINAL exercise id this block was built from (stable across sessions), so a
   *  "replace in my plan" swap can be keyed back to the plan slot. Absent for freely-added exercises. */
  planLiftId?: string
  /** occurrence index of this exercise within the plan day (0 for the 1st block of a lift, 1 for the
   *  2nd, …), so progression reads THIS block's own history even when a lift is prescribed twice. */
  planSlot?: number
  sets: LoggedSet[]
  /** target rep range shown as guidance */
  targetReps: [number, number]
  /**
   * Superset/tri-set/circuit grouping. CONSECUTIVE exercises sharing the same non-empty group id
   * are performed together (2 = superset, 3 = tri-set, 4+ = circuit). Absent = a normal straight-set
   * exercise. Carried from the plan's PlanLift.group.
   */
  group?: string
  note?: string
  /** progression cue shown in the UI (reps/weight up-down + rationale) */
  coaching?: Coaching
  /** session effort for the whole exercise on the RPE scale (6–10), captured from the end-of-exercise
   *  "how many more reps?" prompt as reps-in-reserve (RPE = 10 − RIR). Absent until the user rates it. */
  rpe?: number
}

export type WorkoutStatus = 'planned' | 'active' | 'completed'

export interface Workout {
  id: string
  /** epoch ms */
  date: number
  status: WorkoutStatus
  title: string
  exercises: WorkoutExercise[]
  /** muscle groups this session was built to target */
  focus: MuscleGroup[]
  durationMin?: number
  startedAt?: number
  completedAt?: number
  /** set when this workout was generated from a structured plan */
  planId?: string
  planDayLabel?: string
  /** the explicit muscle focus this session was generated with, so Regenerate can preserve it */
  genFocus?: MuscleGroup[]
  /** the user's bodyweight (display unit) at completion, so bodyweight-exercise volume is stable */
  bodyweight?: number
  /** free-text reflection on the session (how it felt, context) — set on the summary or in history */
  note?: string
  /** local calendar day of completion (YYYY-MM-DD) — lets analytics bucket by the user's day, not UTC */
  performed_on?: string
  /** new Date(completedAt).getTimezoneOffset() (minutes behind UTC) — server reconstructs local day/week */
  tzOffsetMin?: number
}

/** The user's currently-followed structured plan and position in its schedule. */
export interface ActivePlan {
  planId: string
  /** index into the plan's schedule (cycles modulo schedule length) */
  dayIndex: number
  startedAt: number
}

export interface Profile {
  name: string
  goal: Goal
  experience: Experience
  unit: Unit
  equipment: Equipment[]
  /** preferred session length in minutes */
  sessionLength: number
  /** preferred rest between working sets, in seconds; overrides the goal-tuned default when set */
  restSeconds?: number
  /** muscle groups user wants to emphasize */
  focusMuscles: MuscleGroup[]
  /** muscle areas to avoid (injury/preference) — the generator won't program lifts that primarily hit them */
  avoidMuscles?: MuscleGroup[]
  bodyweight?: number
  /** optional self-reported gender — nudges plan recommendations (e.g. glute-focused programs); never gates content */
  gender?: 'male' | 'female'
  /** target training days per week (onboarding) — drives plan matching + weekly adherence */
  daysPerWeek?: number
  onboarded: boolean
  /** whether the one-time post-onboarding "30 days free" trial-welcome has been shown */
  trialWelcomeSeen?: boolean
  /** color theme preference (defaults to 'system') */
  theme?: Theme
  /** accent color id (defaults to 'blaze'); drives the whole brand ramp — see lib/theme */
  accent?: string
  /** play the completion chime + success haptics (defaults to true when unset) */
  effects?: boolean
}

/** A snapshot value 0..100 of how fatigued a muscle is (100 = fully fatigued) */
export type RecoveryMap = Record<MuscleGroup, number>
