import { describe, it, expect, beforeEach } from 'vitest'
import type { Avoidance, BodyRegion, MuscleGroup, Profile, Workout } from '../types'
import {
  injuryConstraints,
  isBlockedByInjury,
  exerciseConflicts,
  activeAvoidances,
  activeInjuries,
  hasActiveInjury,
  avoidedAreaLabels,
  rehabForInjuries,
  rehabForAvoidance,
  avoidanceLabel,
  REGIONS,
  ALL_REGIONS,
  GENERIC_STRAIN_REHAB,
} from '../lib/injuries'
import { generateWorkout } from '../lib/generator'
import { computeRecovery } from '../lib/recovery'
import { EXERCISES, EXERCISE_BY_ID, getExercise } from '../data/exercises'
import { REHAB_EXERCISES, REHAB_BY_ID } from '../data/rehab'
import { useStore, mergePersisted, resolveDayLifts, type AppState } from '../store/useStore'
import type { PlanDay } from '../data/plans'
import { fullGymProfile, NOW } from './fixtures'

// ---- builders ----
const regionInjury = (region: BodyRegion, severity: 'mild' | 'moderate' | 'severe', extra: Partial<Avoidance> = {}): Avoidance =>
  ({ id: `a-${region}`, kind: 'injury', target: { type: 'region', region }, severity, createdAt: NOW, includeInPlans: true, ...extra } as Avoidance)
const muscleInjury = (muscle: MuscleGroup, severity: 'mild' | 'moderate' | 'severe', extra: Partial<Avoidance> = {}): Avoidance =>
  ({ id: `a-${muscle}`, kind: 'injury', target: { type: 'muscle', muscle }, severity, createdAt: NOW, includeInPlans: true, ...extra } as Avoidance)
const pref = (muscle: MuscleGroup, extra: Partial<Avoidance> = {}): Avoidance =>
  ({ id: `p-${muscle}`, kind: 'preference', muscle, createdAt: NOW, includeInPlans: false, ...extra } as Avoidance)
const withAvoiding = (avoiding: Avoidance[]): Profile => ({ ...fullGymProfile, avoiding })

describe('injuryConstraints — region injury severity ladder', () => {
  it('mild avoids only the aggravating movement patterns, not the muscle', () => {
    const c = injuryConstraints(withAvoiding([regionInjury('knee', 'mild')]))
    expect([...c.avoidPatterns].sort()).toEqual(['leg-ext', 'squat'])
    expect(c.avoidPrimary.size).toBe(0)
    expect(c.avoidSecondary.size).toBe(0)
  })
  it('moderate also avoids the muscle as a PRIMARY mover', () => {
    const c = injuryConstraints(withAvoiding([regionInjury('knee', 'moderate')]))
    expect(c.avoidPrimary.has('quads')).toBe(true)
    expect(c.avoidSecondary.has('quads')).toBe(false)
  })
  it('severe also avoids it as a SECONDARY mover', () => {
    const c = injuryConstraints(withAvoiding([regionInjury('knee', 'severe')]))
    expect(c.avoidPrimary.has('quads')).toBe(true)
    expect(c.avoidSecondary.has('quads')).toBe(true)
  })
})

describe('injuryConstraints — muscle injury + preference', () => {
  it('a muscle injury has no pattern map: mild already avoids it as primary', () => {
    const c = injuryConstraints(withAvoiding([muscleInjury('chest', 'mild')]))
    expect(c.avoidPrimary.has('chest')).toBe(true)
    expect(c.avoidSecondary.has('chest')).toBe(false)
    expect(c.avoidPatterns.size).toBe(0)
  })
  it('a moderate muscle injury also avoids it as a secondary mover', () => {
    const c = injuryConstraints(withAvoiding([muscleInjury('chest', 'moderate')]))
    expect(c.avoidSecondary.has('chest')).toBe(true)
  })
  it('a preference avoids the muscle only as a primary mover', () => {
    const c = injuryConstraints(withAvoiding([pref('biceps')]))
    expect(c.avoidPrimary.has('biceps')).toBe(true)
    expect(c.avoidSecondary.has('biceps')).toBe(false)
  })
  it('a clean profile has no constraints', () => {
    expect(injuryConstraints(fullGymProfile).hasConstraints).toBe(false)
  })
})

describe('injuryConstraints — surface (freebuild vs plan)', () => {
  it('freebuild folds EVERY active row regardless of includeInPlans', () => {
    const c = injuryConstraints(withAvoiding([pref('chest'), regionInjury('knee', 'moderate', { includeInPlans: false })]), { surface: 'freebuild' })
    expect(c.avoidPrimary.has('chest')).toBe(true) // preference (includeInPlans false) still applies to free builds
    expect(c.avoidPrimary.has('quads')).toBe(true) // injury opted OUT of plans still applies to free builds
  })
  it("plan folds only rows with includeInPlans", () => {
    const c = injuryConstraints(withAvoiding([pref('chest'), regionInjury('knee', 'moderate', { includeInPlans: false })]), { surface: 'plan' })
    expect(c.avoidPrimary.has('chest')).toBe(false) // preference defaults out of plans
    expect(c.avoidPrimary.has('quads')).toBe(false) // injury opted OUT of plans
  })
  it('a plan respects an injury opted IN, and a preference opted IN', () => {
    const c = injuryConstraints(withAvoiding([pref('chest', { includeInPlans: true }), regionInjury('knee', 'moderate')]), { surface: 'plan' })
    expect(c.avoidPrimary.has('chest')).toBe(true)
    expect(c.avoidPrimary.has('quads')).toBe(true)
  })
})

describe('activeAvoidances / activeInjuries / hasActiveInjury', () => {
  it('keeps un-resolved rows of every kind (region injury, muscle injury, preference)', () => {
    const p = withAvoiding([regionInjury('knee', 'mild'), muscleInjury('chest', 'mild'), pref('abs'), regionInjury('hip', 'mild', { resolvedAt: NOW })])
    expect(activeAvoidances(p)).toHaveLength(3) // resolved hip dropped
    expect(activeInjuries(p)).toHaveLength(2) // both injuries, not the preference
    expect(hasActiveInjury(p)).toBe(true)
  })
  it('a preference-only profile has no active injury (gates the safety surfaces off)', () => {
    expect(hasActiveInjury(withAvoiding([pref('abs')]))).toBe(false)
  })
})

describe('generateWorkout — trains around the unified list', () => {
  it('never programs a lift blocked by the constraints (region, muscle, preference)', () => {
    const profiles = [
      withAvoiding([regionInjury('knee', 'moderate')]),
      withAvoiding([muscleInjury('chest', 'moderate')]),
      withAvoiding([pref('biceps')]),
    ]
    for (const profile of profiles) {
      const c = injuryConstraints(profile)
      for (let s = 0; s < 6; s++) {
        const w = generateWorkout(profile, [], NOW, { shuffle: s })
        expect(w.exercises.length).toBeGreaterThan(0)
        for (const we of w.exercises) {
          expect(isBlockedByInjury(getExercise(we.exerciseId)!, c)).toBe(false)
        }
      }
    }
  })
  it('a mild knee injury drops squat-pattern + leg-extension work', () => {
    const ids = generateWorkout(withAvoiding([regionInjury('knee', 'mild')]), [], NOW).exercises.map((e) => e.exerciseId)
    for (const id of ['back-squat', 'front-squat', 'leg-press', 'goblet-squat', 'lunge', 'leg-extension']) {
      expect(ids).not.toContain(id)
    }
  })
  it('never auto-programs a rehab exercise', () => {
    const w = generateWorkout(withAvoiding([muscleInjury('chest', 'severe'), regionInjury('knee', 'severe')]), [], NOW)
    expect(w.exercises.length).toBeGreaterThan(0)
    for (const we of w.exercises) expect(getExercise(we.exerciseId)!.category).not.toBe('rehab')
  })
  it('the surface option gates the preference (plan-fallback parity)', () => {
    const profile = withAvoiding([pref('chest')]) // includeInPlans false
    const free = generateWorkout(profile, [], NOW, { focusOverride: ['chest', 'triceps', 'shoulders'] })
    for (const we of free.exercises) expect(getExercise(we.exerciseId)!.primary).not.toContain('chest')
    const plan = generateWorkout(profile, [], NOW, { focusOverride: ['chest', 'triceps', 'shoulders'], surface: 'plan' })
    expect(plan.exercises.some((we) => getExercise(we.exerciseId)!.primary.includes('chest'))).toBe(true)
  })
})

describe('resolveDayLifts — plans respect includeInPlans', () => {
  const day = (): PlanDay => ({
    label: 'Day 1',
    title: 'Squat + Bench',
    focus: ['quads', 'chest'],
    lifts: [
      { exerciseId: 'back-squat', sets: 3, repMin: 5, repMax: 5 },
      { exerciseId: 'barbell-bench-press', sets: 3, repMin: 8, repMax: 12 },
    ],
  })
  const ids = (p: Profile) => resolveDayLifts(day(), p).resolved.map((r) => r.exerciseId)

  it('an injury defaults to applying on plan days (includeInPlans ON)', () => {
    const got = ids(withAvoiding([regionInjury('knee', 'moderate')]))
    expect(got).not.toContain('back-squat')
    expect(got).toContain('barbell-bench-press')
  })
  it('a preference stays out of plans unless opted in', () => {
    expect(ids(withAvoiding([pref('chest')]))).toContain('barbell-bench-press')
    expect(ids(withAvoiding([pref('chest', { includeInPlans: true })]))).not.toContain('barbell-bench-press')
  })
  it('an injury opted OUT of plans keeps its lift in a program', () => {
    expect(ids(withAvoiding([regionInjury('knee', 'moderate', { includeInPlans: false })]))).toContain('back-squat')
  })
})

describe('rehab', () => {
  it('a region injury surfaces its region rehab', () => {
    const r = rehabForInjuries(withAvoiding([regionInjury('shoulder', 'mild')]))
    expect(r.map((x) => x.exercise.id)).toContain('rehab-band-external-rotation')
  })
  it('a muscle injury surfaces the generic strain block', () => {
    const r = rehabForAvoidance(muscleInjury('chest', 'moderate'))
    expect(r.map((e) => e.id)).toEqual(GENERIC_STRAIN_REHAB)
  })
  it('a preference contributes no rehab', () => {
    expect(rehabForAvoidance(pref('abs'))).toEqual([])
    expect(rehabForInjuries(withAvoiding([pref('abs')]))).toEqual([])
  })
  it('every rehab id (region + generic strain) resolves to a rehab exercise', () => {
    const ids = [...ALL_REGIONS.flatMap((r) => REGIONS[r].rehab), ...GENERIC_STRAIN_REHAB]
    for (const id of ids) {
      const ex = getExercise(id)
      expect(ex, `${id} missing`).toBeDefined()
      expect(ex!.category).toBe('rehab')
    }
  })
  it('rehab exercises never leak into the generator pool', () => {
    for (const ex of REHAB_EXERCISES) {
      expect(EXERCISE_BY_ID[ex.id]).toBeUndefined()
      expect(EXERCISES.find((e) => e.id === ex.id)).toBeUndefined()
    }
  })
})

describe('recovery — rehab work is zero-fatigue', () => {
  const sessionOf = (exerciseId: string): Workout => ({
    id: 'w', date: NOW, status: 'completed', title: 't', focus: [], completedAt: NOW, startedAt: NOW,
    exercises: [{ exerciseId, targetReps: [10, 15], sets: [{ id: 'a', weight: 0, reps: 12, done: true }, { id: 'b', weight: 0, reps: 12, done: true }] }],
  })
  it('a logged rehab exercise deposits no fatigue', () => {
    expect(computeRecovery([sessionOf('rehab-wall-sit')], NOW + 1000).quads).toBe(0)
  })
  it('a normal exercise on the same muscle does (control)', () => {
    expect(computeRecovery([sessionOf('leg-extension')], NOW + 1000).quads).toBeGreaterThan(0)
  })
})

describe('exerciseConflicts (manual-add confirmation)', () => {
  it('names the areas a manually-added exercise loads', () => {
    const profile = withAvoiding([regionInjury('knee', 'moderate'), pref('chest')])
    expect(exerciseConflicts(getExercise('back-squat')!, profile)).toContain('Knee') // squat pattern / quads
    expect(exerciseConflicts(getExercise('barbell-bench-press')!, profile)).toContain('Chest') // chest primary
  })
  it('is empty for an exercise that conflicts with nothing (or a clean profile)', () => {
    expect(exerciseConflicts(getExercise('lat-pulldown')!, withAvoiding([regionInjury('knee', 'moderate')]))).toEqual([])
    expect(exerciseConflicts(getExercise('back-squat')!, fullGymProfile)).toEqual([])
  })
  it('a MILD knee (patterns only) still flags a squat but not a quad-primary isolation', () => {
    const profile = withAvoiding([regionInjury('knee', 'mild')])
    expect(exerciseConflicts(getExercise('back-squat')!, profile)).toContain('Knee') // squat pattern
    expect(exerciseConflicts(getExercise('leg-extension')!, profile)).toContain('Knee') // leg-ext pattern
  })
})

describe('avoidedAreaLabels', () => {
  it('lists every active area (regions + muscles), injuries first, de-duplicated', () => {
    const labels = avoidedAreaLabels(withAvoiding([regionInjury('knee', 'mild'), pref('chest')]))
    expect(labels).toContain('Knee')
    expect(labels).toContain('Chest')
  })
  it('is empty when nothing is flagged', () => {
    expect(avoidedAreaLabels(fullGymProfile)).toEqual([])
  })
})

describe('store actions — the unified avoiding[] list', () => {
  beforeEach(() => {
    useStore.setState({ profile: { ...fullGymProfile, avoiding: [], focusMuscles: [] } })
  })

  it('adds an injury (region) and a muscle preference', () => {
    const id1 = useStore.getState().addInjuryAvoidance({ type: 'region', region: 'knee' }, 'moderate', '  left  ')
    const id2 = useStore.getState().addMusclePreference('abs')
    const av = useStore.getState().profile.avoiding
    expect(av).toHaveLength(2)
    const inj = av.find((a) => a.id === id1)!
    expect(inj).toMatchObject({ kind: 'injury', severity: 'moderate', note: 'left', includeInPlans: true })
    expect(av.find((a) => a.id === id2)).toMatchObject({ kind: 'preference', muscle: 'abs', includeInPlans: false })
  })

  it('edits severity / note / includeInPlans, and toggles plans/resolve', () => {
    const id = useStore.getState().addInjuryAvoidance({ type: 'muscle', muscle: 'chest' }, 'mild')
    useStore.getState().updateAvoidance(id, { severity: 'severe', includeInPlans: false })
    const a = () => useStore.getState().profile.avoiding[0]
    expect(a()).toMatchObject({ severity: 'severe', includeInPlans: false })
    useStore.getState().toggleAvoidanceResolved(id)
    expect(a().resolvedAt).toBeGreaterThan(0)
    useStore.getState().toggleAvoidanceResolved(id)
    expect(a().resolvedAt).toBeUndefined()
  })

  it('a preference cannot be resolved (only removed)', () => {
    const id = useStore.getState().addMusclePreference('calves')
    useStore.getState().toggleAvoidanceResolved(id)
    expect(useStore.getState().profile.avoiding[0].resolvedAt).toBeUndefined()
    useStore.getState().removeAvoidance(id)
    expect(useStore.getState().profile.avoiding).toHaveLength(0)
  })

  it('plans default follows severity, and escalating to moderate/severe auto-enables it', () => {
    // a mild injury stays out of structured plans by default
    const id = useStore.getState().addInjuryAvoidance({ type: 'region', region: 'knee' }, 'mild')
    expect(useStore.getState().profile.avoiding[0].includeInPlans).toBe(false)
    // bumping it to moderate (no explicit includeInPlans) auto-turns plans on
    useStore.getState().updateAvoidance(id, { severity: 'moderate' })
    expect(useStore.getState().profile.avoiding[0].includeInPlans).toBe(true)
    // an explicit toggle still wins over the severity rule
    useStore.getState().updateAvoidance(id, { severity: 'severe', includeInPlans: false })
    expect(useStore.getState().profile.avoiding[0]).toMatchObject({ severity: 'severe', includeInPlans: false })
    // a brand-new severe injury defaults plans on
    useStore.getState().addInjuryAvoidance({ type: 'muscle', muscle: 'chest' }, 'severe')
    expect(useStore.getState().profile.avoiding[0].includeInPlans).toBe(true)
  })

  it('converts a preference into a muscle injury (keeps note, gains severity + rehab)', () => {
    const id = useStore.getState().addMusclePreference('chest', 'tweaked benching')
    useStore.getState().convertPreferenceToInjury(id, 'moderate')
    const a = useStore.getState().profile.avoiding[0]
    expect(a).toMatchObject({ kind: 'injury', severity: 'moderate', note: 'tweaked benching', includeInPlans: true })
    expect((a as Extract<Avoidance, { kind: 'injury' }>).target).toEqual({ type: 'muscle', muscle: 'chest' })
  })

  it('emphasis and preference are mutually exclusive', () => {
    useStore.setState({ profile: { ...fullGymProfile, avoiding: [], focusMuscles: ['chest'] } })
    useStore.getState().addMusclePreference('chest')
    expect(useStore.getState().profile.focusMuscles).not.toContain('chest') // adding a preference clears the emphasis
    useStore.getState().toggleFocusMuscle('chest')
    expect(useStore.getState().profile.avoiding.some((a) => a.kind === 'preference' && a.muscle === 'chest')).toBe(false)
  })
})

describe('migration — legacy injuries[] + avoidMuscles[] + avoidInPlans → avoiding[]', () => {
  const base = useStore.getState() as AppState

  it('folds all three legacy fields losslessly', () => {
    const { avoiding: _omit, ...legacy } = fullGymProfile
    const persisted = {
      profile: {
        ...legacy,
        injuries: [{ id: 'i1', region: 'knee', severity: 'moderate', createdAt: NOW }],
        avoidMuscles: ['biceps', 'quads'], // quads is covered by the knee region → deduped
        avoidInPlans: true,
      },
    }
    const av = mergePersisted(persisted, base).profile.avoiding
    const injury = av.find((a) => a.kind === 'injury')!
    expect(injury).toMatchObject({ kind: 'injury', severity: 'moderate', includeInPlans: true })
    const prefs = av.filter((a) => a.kind === 'preference') as Extract<Avoidance, { kind: 'preference' }>[]
    expect(prefs.map((p) => p.muscle)).toEqual(['biceps']) // quads deduped (covered by knee)
    expect(prefs[0].includeInPlans).toBe(true) // old global avoidInPlans mapped onto the per-item flag
  })

  it('clears the legacy fields and is idempotent', () => {
    const { avoiding: _omit, ...legacy } = fullGymProfile
    const merged = mergePersisted({ profile: { ...legacy, avoidMuscles: ['abs'], avoidInPlans: false } }, base)
    expect(merged.profile.avoidMuscles).toBeUndefined()
    expect(merged.profile.injuries).toBeUndefined()
    // feed it back: an already-migrated blob keeps its avoiding untouched
    const again = mergePersisted({ profile: merged.profile }, base)
    expect(again.profile.avoiding).toHaveLength(1)
    expect((again.profile.avoiding[0] as Extract<Avoidance, { kind: 'preference' }>).muscle).toBe('abs')
  })

  it('a MILD region injury does NOT swallow a muscle preference (severity-aware dedup)', () => {
    const { avoiding: _omit, ...legacy } = fullGymProfile
    // mild knee avoids only PATTERNS (not quads as primary), so a quads preference must survive
    const persisted = { profile: { ...legacy, injuries: [{ id: 'i', region: 'knee', severity: 'mild', createdAt: NOW }], avoidMuscles: ['quads'] } }
    const prefs = (mergePersisted(persisted, base).profile.avoiding.filter((a) => a.kind === 'preference') as Extract<Avoidance, { kind: 'preference' }>[]).map((p) => p.muscle)
    expect(prefs).toContain('quads')
  })

  it('still folds legacy data when a corrupt blob carries avoiding:[] alongside it', () => {
    const { avoiding: _omit, ...legacy } = fullGymProfile
    const persisted = { profile: { ...legacy, avoiding: [], injuries: [{ id: 'i', region: 'shoulder', severity: 'moderate', createdAt: NOW }], avoidMuscles: ['biceps'], avoidInPlans: true } }
    const av = mergePersisted(persisted, base).profile.avoiding
    expect(av.some((a) => a.kind === 'injury')).toBe(true) // injury folded, not dropped
    expect(av.some((a) => a.kind === 'preference' && a.muscle === 'biceps')).toBe(true)
  })

  it('keeps an empty avoiding[] when there is genuinely no legacy data', () => {
    const { avoiding: _omit, ...legacy } = fullGymProfile
    expect(mergePersisted({ profile: { ...legacy, avoiding: [] } }, base).profile.avoiding).toEqual([])
  })

  it('sanitizes a corrupt avoiding[] — drops garbage, keeps every well-formed kind', () => {
    const { avoiding: _omit, ...legacy } = fullGymProfile
    const persisted = {
      profile: {
        ...legacy,
        avoiding: [
          { id: 'a', kind: 'injury', target: { type: 'region', region: 'knee' }, severity: 'moderate', createdAt: NOW },
          { id: 'b', kind: 'injury', target: { type: 'muscle', muscle: 'chest' }, severity: 'mild', createdAt: NOW },
          { id: 'c', kind: 'preference', muscle: 'abs', createdAt: NOW },
          { id: 'd', kind: 'injury', target: { type: 'region', region: 'bogus' }, severity: 'mild', createdAt: NOW }, // bad region
          { id: 'e', kind: 'preference', muscle: 'nope', createdAt: NOW }, // bad muscle
          null,
          'garbage',
        ],
      },
    }
    const av = mergePersisted(persisted, base).profile.avoiding
    expect(av.map((a) => a.id).sort()).toEqual(['a', 'b', 'c'])
  })
})
