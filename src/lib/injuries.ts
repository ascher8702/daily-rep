import type {
  Avoidance,
  BodyRegion,
  Exercise,
  InjuryAvoidance,
  InjurySeverity,
  MuscleGroup,
  Profile,
} from '../types'
import type { MovementPattern } from './substitution'
import { PATTERN } from './substitution'
import { getExercise } from '../data/exercises'
import { muscleLabel } from '../data/muscles'

/**
 * Injury-aware training: turn a user's reported injuries into (a) hard constraints the generator
 * trains AROUND and (b) a curated set of therapeutic exercises to aid recovery.
 *
 * Grounded in the modern sports-medicine consensus that for most musculoskeletal complaints the goal
 * is RELATIVE rest + graded loading, not total rest — so we avoid the aggravating movements while
 * keeping the rest of the body training, and we surface evidence-based rehab work (isometrics,
 * eccentrics, motor-control drills) rather than just saying "skip leg day". See docs/research-injury-rehab.md.
 *
 * This is NOT medical advice. The app trains around a limitation and suggests common rehab movements;
 * it never diagnoses or treats. Copy throughout the feature reflects that (see DISCLAIMER / RED_FLAGS).
 */

export interface RegionMeta {
  id: BodyRegion
  /** how the user refers to it */
  label: string
  /** which body view the region lives on (mirrors MuscleMeta.view for a future body map) */
  view: 'front' | 'back'
  /**
   * Muscle groups the region loads. Avoided as a PRIMARY mover at every severity; also avoided as a
   * SECONDARY mover at moderate/severe (see injuryConstraints). This is what flows into the generator's
   * existing muscle-avoid filter.
   */
  muscles: MuscleGroup[]
  /**
   * Movement patterns that specifically aggravate the region — dropped at EVERY severity, because a
   * pattern is the precise provocative movement (e.g. a hinge for a low back, overhead press for a
   * shoulder) regardless of which muscle a given lift calls "primary".
   */
  patterns: MovementPattern[]
  /** plain-language note on how to train around it — shown on the injury card */
  guidance: string
  /** what's generally still safe to train — reassures the user the app isn't benching their whole week */
  stillTrain: string
  /** ordered ids into the rehab catalogue (data/rehab) — most-foundational first */
  rehab: string[]
}

/**
 * The region catalogue. Regions are joints / common strain sites, each mapped to the muscles +
 * movement patterns to avoid and the therapeutic work that helps. Mappings are deliberately
 * conservative on the side of the injured tissue but try not to wipe out the whole session — severity
 * does the escalation (mild keeps secondary involvement; moderate/severe drops it).
 */
export const REGIONS: Record<BodyRegion, RegionMeta> = {
  neck: {
    id: 'neck',
    label: 'Neck',
    view: 'back',
    muscles: ['traps'],
    patterns: ['shrug', 'vertical-push'],
    guidance: 'Skip shrugs and overhead pressing, and keep your neck neutral while bracing. Avoid loaded movements that crane or shrug the neck.',
    stillTrain: 'Most lower-body, chest, and horizontal pulling stays in.',
    rehab: ['rehab-chin-tuck', 'rehab-neck-isometrics', 'rehab-scap-wall-slide', 'rehab-upper-trap-stretch'],
  },
  shoulder: {
    id: 'shoulder',
    label: 'Shoulder',
    view: 'front',
    muscles: ['shoulders'],
    patterns: ['vertical-push', 'lateral-raise', 'rear-delt', 'face-pull'],
    guidance: 'Avoid overhead pressing and raises. Keep pressing/pulling pain-free and in a comfortable range — stop short of any pinch.',
    stillTrain: 'Lower body, core, and (at mild) flat pressing within a pain-free range.',
    rehab: ['rehab-band-external-rotation', 'rehab-scap-wall-slide', 'rehab-band-pull-apart', 'rehab-wall-angel'],
  },
  elbow: {
    id: 'elbow',
    label: 'Elbow',
    view: 'front',
    muscles: ['biceps', 'triceps'],
    patterns: ['curl', 'triceps-ext'],
    guidance: 'Lay off direct curls and extensions, and ease grip-heavy holds. Eccentric wrist work is the staple for tennis/golfer’s elbow.',
    stillTrain: 'Lower body and core; at mild, machine/supported pressing that stays pain-free.',
    rehab: ['rehab-eccentric-wrist-extension', 'rehab-eccentric-wrist-flexion', 'rehab-supination-curl', 'rehab-forearm-stretch'],
  },
  wrist: {
    id: 'wrist',
    label: 'Wrist',
    view: 'front',
    muscles: ['forearms'],
    patterns: ['wrist', 'curl'],
    guidance: 'Avoid loaded wrist flexion/extension and heavy gripping. Neutral-grip and strapped variations are usually kinder than a barbell.',
    stillTrain: 'Lower body, and machine/neutral-grip upper work that keeps the wrist straight.',
    rehab: ['rehab-wrist-flexion-extension', 'rehab-forearm-stretch', 'rehab-grip-squeeze', 'rehab-wrist-radial-ulnar'],
  },
  upperback: {
    id: 'upperback',
    label: 'Upper Back',
    view: 'back',
    muscles: ['back', 'lats', 'traps'],
    patterns: ['horizontal-pull', 'vertical-pull', 'shrug'],
    guidance: 'Reduce heavy rowing, pulldowns, and shrugs. Light scapular and thoracic-mobility work keeps the area moving without loading it.',
    stillTrain: 'Lower body, chest, and arms within comfort.',
    rehab: ['rehab-band-pull-apart', 'rehab-cat-cow', 'rehab-prone-ytw', 'rehab-thoracic-rotation'],
  },
  lowerback: {
    id: 'lowerback',
    label: 'Lower Back',
    view: 'back',
    muscles: ['lowerback'],
    patterns: ['hinge'],
    guidance: 'Avoid loaded hinging (deadlifts, good mornings, swings) and round-back lifting. Brace and keep a neutral spine. The McGill “big 3” are the go-to for building pain-free trunk endurance.',
    stillTrain: 'At mild, supported squats and most upper body; moderate+ also rests axial loading like back squats and barbell rows.',
    rehab: ['rehab-mcgill-curlup', 'rehab-side-plank', 'rehab-bird-dog', 'rehab-dead-bug', 'rehab-cat-cow'],
  },
  hip: {
    id: 'hip',
    label: 'Hip',
    view: 'front',
    muscles: ['glutes'],
    patterns: ['hinge'],
    guidance: 'Ease deep hip flexion and loaded hinging. Glute activation and controlled range usually feel better than stretching into the pinch.',
    stillTrain: 'Upper body in full, plus knee-dominant isolation (leg extension, leg curl) and calves.',
    rehab: ['rehab-clamshell', 'rehab-glute-bridge-iso', 'rehab-90-90-hip', 'rehab-hip-flexor-stretch'],
  },
  knee: {
    id: 'knee',
    label: 'Knee',
    view: 'front',
    muscles: ['quads'],
    patterns: ['squat', 'leg-ext'],
    guidance: 'Avoid deep squatting, lunging, and leg extensions. Isometrics (wall sit, Spanish squat) and short-range work load the quad/tendon without the painful range.',
    stillTrain: 'All upper body, plus hip-dominant work (hip thrusts, RDLs at mild) and hamstring curls.',
    rehab: ['rehab-quad-set', 'rehab-wall-sit', 'rehab-spanish-squat', 'rehab-terminal-knee-extension', 'rehab-step-down'],
  },
  ankle: {
    id: 'ankle',
    label: 'Ankle',
    view: 'back',
    muscles: ['calves'],
    patterns: ['calf'],
    guidance: 'Skip loaded calf raises and jumping. Restore range and balance first, then reload the calf with slow eccentrics.',
    stillTrain: 'Seated and upper-body work; most knee/hip lifts with both feet planted.',
    rehab: ['rehab-ankle-alphabet', 'rehab-ankle-dorsiflexion', 'rehab-single-leg-balance', 'rehab-eccentric-calf-raise'],
  },
  hamstring: {
    id: 'hamstring',
    label: 'Hamstring',
    view: 'back',
    muscles: ['hamstrings'],
    patterns: ['leg-curl', 'hinge'],
    guidance: 'Back off loaded hinging, leg curls, and any sprint/stretch that provokes it. Reintroduce length with light isometrics, then eccentrics (the Nordic is the gold standard).',
    stillTrain: 'Upper body in full, plus quad-dominant work like leg press and goblet squats at mild.',
    rehab: ['rehab-hamstring-bridge-iso', 'rehab-single-leg-rdl-light', 'rehab-nordic-eccentric', 'rehab-prone-hamstring-curl'],
  },
}

export const ALL_REGIONS = Object.keys(REGIONS) as BodyRegion[]
export const VALID_REGIONS = new Set<BodyRegion>(ALL_REGIONS)
export const VALID_SEVERITIES = new Set<InjurySeverity>(['mild', 'moderate', 'severe'])

export function regionLabel(r: BodyRegion): string {
  return REGIONS[r]?.label ?? 'Area'
}

/**
 * Generic graded-loading work for a muscle STRAIN that isn't one of the named joint regions (e.g. a
 * tweaked pec or biceps). Honest clinical ceiling: a bare muscle has no provocative-pattern map and no
 * joint-specific protocol, so we offer the universal strain progression — isometrics → light eccentrics
 * → rebuild range — framed as general strengthening, never treatment. See docs/research-injury-rehab.md.
 */
export const GENERIC_STRAIN_REHAB: string[] = [
  'rehab-strain-isometric',
  'rehab-strain-eccentric',
  'rehab-strain-rom',
]
export const GENERIC_STRAIN_GUIDANCE =
  'General strengthening for a muscle strain — isometrics first, then light eccentrics, then rebuild your range. Stay inside the pain rule below and progress gradually.'

/** Per-row resolved metadata, kind-agnostic, so the constraint engine + UI branch uniformly. */
export interface AvoidanceMeta {
  label: string
  muscles: MuscleGroup[]
  patterns: MovementPattern[]
  rehab: string[]
  guidance: string
  stillTrain: string
}

/** Resolve any avoidance row to the muscles/patterns/rehab/copy it implies. */
export function avoidanceMeta(a: Avoidance): AvoidanceMeta {
  if (a.kind === 'injury' && a.target.type === 'region') {
    const r = REGIONS[a.target.region]
    if (r) return { label: r.label, muscles: r.muscles, patterns: r.patterns, rehab: r.rehab, guidance: r.guidance, stillTrain: r.stillTrain }
  }
  const muscle = a.kind === 'injury' ? (a.target.type === 'muscle' ? a.target.muscle : undefined) : a.muscle
  const muscles = muscle ? [muscle] : []
  if (a.kind === 'injury') {
    return { label: muscle ? muscleLabel(muscle) : 'Area', muscles, patterns: [], rehab: GENERIC_STRAIN_REHAB, guidance: GENERIC_STRAIN_GUIDANCE, stillTrain: '' }
  }
  // preference — no rehab, no medical framing
  return { label: muscle ? muscleLabel(muscle) : 'Area', muscles, patterns: [], rehab: [], guidance: '', stillTrain: '' }
}

/** Display label for an avoidance row (region or muscle). */
export function avoidanceLabel(a: Avoidance): string {
  return avoidanceMeta(a).label
}

const SEVERITY_META: Record<InjurySeverity, { label: string; detail: string }> = {
  mild: {
    label: 'Mild',
    detail: 'A niggle (pain ~0–3/10). We skip the moves that aggravate it and keep training the rest.',
  },
  moderate: {
    label: 'Moderate',
    detail: 'Sore under load (pain ~4–5/10). We skip lifts that work the area and lead with recovery work.',
  },
  severe: {
    label: 'Severe',
    detail: 'Painful even lightly (pain 6+/10). We rest the area entirely and foreground gentle rehab.',
  },
}
export const ALL_SEVERITIES: InjurySeverity[] = ['mild', 'moderate', 'severe']
export function severityLabel(s: InjurySeverity): string {
  return SEVERITY_META[s]?.label ?? 'Mild'
}
export function severityDetail(s: InjurySeverity): string {
  return SEVERITY_META[s]?.detail ?? ''
}

/**
 * Every avoidance row that currently constrains programming — un-resolved. Branches on `kind`, NOT on
 * region validity, so a muscle-anchored injury and a plain preference survive (they have no region).
 */
export function activeAvoidances(profile: Profile): Avoidance[] {
  return (profile.avoiding ?? []).filter((a) => a && !a.resolvedAt)
}

/** The active rows that are INJURIES (region or muscle) — i.e. carry rehab + pain framing. */
export function activeInjuries(profile: Profile): InjuryAvoidance[] {
  return activeAvoidances(profile).filter((a): a is InjuryAvoidance => a.kind === 'injury')
}

/** Whether any active row is an injury — gates the pain guide / red-flags / disclaimer surfaces. */
export function hasActiveInjury(profile: Profile): boolean {
  return activeAvoidances(profile).some((a) => a.kind === 'injury')
}

export interface InjuryConstraints {
  /** muscles never trained as a PRIMARY mover */
  avoidPrimary: Set<MuscleGroup>
  /** muscles also avoided as a SECONDARY mover (worse injuries) */
  avoidSecondary: Set<MuscleGroup>
  /** movement patterns dropped entirely (region injuries, all severities) */
  avoidPatterns: Set<MovementPattern>
  /** whether anything is constraining the session (drives generator fallback + UI copy) */
  hasConstraints: boolean
}

export interface InjuryConstraintOptions {
  /**
   * Which surface is asking. 'freebuild' (default) folds in EVERY active row — free workouts always work
   * around everything you've flagged. 'plan' folds in only the rows with `includeInPlans`, so a chosen
   * program keeps its structure unless you opted a given area in. Strictly more expressive than the old
   * global toggle: each row decides for itself.
   */
  surface?: 'freebuild' | 'plan'
}

/** The muscle/pattern contribution of one active avoidance, by kind + (for injuries) severity. */
function contribution(a: Avoidance): { primary: MuscleGroup[]; secondary: MuscleGroup[]; patterns: MovementPattern[] } {
  const meta = avoidanceMeta(a)
  if (a.kind === 'preference') {
    // a plain "skip this muscle" — avoid it only as a primary mover
    return { primary: meta.muscles, secondary: [], patterns: [] }
  }
  if (a.target.type === 'region') {
    // region ladder: patterns at every severity; muscles mild=none, moderate=primary, severe=+secondary
    return {
      patterns: meta.patterns,
      primary: a.severity === 'mild' ? [] : meta.muscles,
      secondary: a.severity === 'severe' ? meta.muscles : [],
    }
  }
  // muscle-anchored injury: no pattern map, so mild already avoids the muscle as primary; worse = +secondary
  return { primary: meta.muscles, secondary: a.severity === 'mild' ? [] : meta.muscles, patterns: [] }
}

/**
 * Fold a profile's active avoidances into the single constraint set EVERY surface reads — the free-build
 * generator, the plan-day filter, the Home preview, and the in-session heads-up — so the app trains
 * around an injury consistently. The injury severity ladder mirrors the sports-med "modify, don't just
 * rest" consensus (docs/research-injury-rehab.md). Output shape is stable; only what FEEDS it changes.
 */
export function injuryConstraints(profile: Profile, opts: InjuryConstraintOptions = {}): InjuryConstraints {
  const surface = opts.surface ?? 'freebuild'
  const avoidPrimary = new Set<MuscleGroup>()
  const avoidSecondary = new Set<MuscleGroup>()
  const avoidPatterns = new Set<MovementPattern>()

  for (const a of activeAvoidances(profile)) {
    // on plan days, only fold rows the user opted into plans (free workouts fold everything)
    if (surface === 'plan' && !a.includeInPlans) continue
    const c = contribution(a)
    for (const m of c.primary) avoidPrimary.add(m)
    for (const m of c.secondary) avoidSecondary.add(m)
    for (const p of c.patterns) avoidPatterns.add(p)
  }

  return {
    avoidPrimary,
    avoidSecondary,
    avoidPatterns,
    hasConstraints: avoidPrimary.size > 0 || avoidSecondary.size > 0 || avoidPatterns.size > 0,
  }
}

/** Whether an exercise is blocked by a constraint set. Pure — shared by the generator and previews. */
export function isBlockedByInjury(ex: Exercise, c: InjuryConstraints): boolean {
  if (ex.primary.some((m) => c.avoidPrimary.has(m))) return true
  if (c.avoidSecondary.size > 0 && ex.secondary.some((m) => c.avoidSecondary.has(m))) return true
  const pattern = PATTERN[ex.id]
  if (pattern && c.avoidPatterns.has(pattern)) return true
  return false
}

/**
 * The labels of the areas an exercise actually conflicts with, given the user's ACTIVE avoidances — for
 * a manual-add confirmation ("Barbell Back Squat loads your Knee, which you're working around"). Empty
 * when it's clear to add. Uses the free-build reading (every active row), since a manual add is the
 * user's own call regardless of the plan opt-in.
 */
export function exerciseConflicts(ex: Exercise, profile: Profile): string[] {
  const labels: string[] = []
  for (const a of activeAvoidances(profile)) {
    const con = contribution(a)
    const pattern = PATTERN[ex.id]
    const hits =
      ex.primary.some((m) => con.primary.includes(m)) ||
      ex.secondary.some((m) => con.secondary.includes(m)) ||
      (pattern != null && con.patterns.includes(pattern))
    if (hits) labels.push(avoidanceLabel(a))
  }
  return [...new Set(labels)]
}

/** The rehab ids recommended for ONE injury row (region catalogue, or the generic strain block). */
export function rehabForAvoidance(a: Avoidance): Exercise[] {
  if (a.kind !== 'injury') return []
  return avoidanceMeta(a)
    .rehab.map((id) => getExercise(id))
    .filter((e): e is Exercise => !!e)
}

/**
 * The therapeutic exercises across a profile's active injuries, de-duplicated and resolved to Exercise
 * objects, tagged with the area label(s) that recommend them. Most-severe injuries first. Returns [] when
 * no injury is active (preferences contribute nothing).
 */
export function rehabForInjuries(profile: Profile): { exercise: Exercise; areas: string[] }[] {
  const order: InjurySeverity[] = ['severe', 'moderate', 'mild']
  const sorted = [...activeInjuries(profile)].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
  const byId = new Map<string, { exercise: Exercise; areas: string[] }>()
  for (const injury of sorted) {
    const label = avoidanceLabel(injury)
    for (const ex of rehabForAvoidance(injury)) {
      const existing = byId.get(ex.id)
      if (existing) {
        if (!existing.areas.includes(label)) existing.areas.push(label)
        continue
      }
      byId.set(ex.id, { exercise: ex, areas: [label] })
    }
  }
  return [...byId.values()]
}

/**
 * Human labels for everything the user is currently working around — every active row (injuries +
 * preferences) — for the in-session heads-up and summaries. De-duplicated, injuries first.
 */
export function avoidedAreaLabels(profile: Profile): string[] {
  const active = activeAvoidances(profile)
  const labels = [
    ...active.filter((a) => a.kind === 'injury').map(avoidanceLabel),
    ...active.filter((a) => a.kind === 'preference').map(avoidanceLabel),
  ]
  return [...new Set(labels)]
}

/**
 * Standing disclaimer shown anywhere injuries/rehab are surfaced. Deliberately kept on the "general
 * wellness" side of the line (no diagnose/treat/cure claims) — it mirrors the defensible wording
 * consumer fitness apps use. The recovery moves are framed as general strengthening & mobility, never
 * as treatment. See docs/research-injury-rehab.md §5.
 */
export const DISCLAIMER =
  'These suggestions are not medical advice and can’t replace professional guidance. Daily Rep adjusts your training around what you tell it — it can’t diagnose or treat an injury. Always consult a qualified healthcare professional before exercising with an injury.'

/**
 * The pain "traffic-light" rule — the most important thing to convey to someone training around an
 * injury. Lifting into a 0–3 is fine; a 4–5 is OK only if it settles by the next morning; 6+ means
 * stop. (Silbernagel pain-monitoring model — docs/research-injury-rehab.md §4.)
 */
export const PAIN_GUIDE: { tone: 'fresh' | 'moderate' | 'rest'; range: string; rule: string }[] = [
  { tone: 'fresh', range: '0–3', rule: 'Mild discomfort is OK — keep going and progress gently.' },
  { tone: 'moderate', range: '4–5', rule: 'Acceptable only if it settles back to normal by next morning.' },
  { tone: 'rest', range: '6+', rule: 'Too much — stop, back off the load, and rest the area.' },
]

/** Red-flag symptoms that warrant stopping and seeking care rather than training around it. */
export const RED_FLAGS: string[] = [
  'Sharp, severe, or rapidly worsening pain',
  'Numbness, tingling, or weakness in a limb',
  'Pain that radiates down an arm or leg',
  'A joint that locks, gives way, or feels unstable',
  'Significant swelling, or pain that wakes you at night',
  'Any loss of bladder or bowel control (seek urgent care)',
]
