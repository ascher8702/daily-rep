'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Experience, Goal, MuscleGroup } from '@/types'
import { useStore } from '@/store/useStore'
import { getExercise } from '@/data/exercises'
import { planEquipment, type EquipmentContext, type PlanDay, type PlanLift, type WorkoutPlan } from '@/data/plans'
import { scaffoldPlan, EQUIPMENT_CONTEXTS, blankDay, removeScheduleDay } from '@/lib/planBuilder'
import { uid } from '@/lib/format'
import ExercisePicker from '@/components/ExercisePicker'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { useConfirm } from '@/components/ConfirmProvider'
import { ChevronLeft, ChevronUp, ChevronDown, TrashIcon, PlusIcon, LinkIcon } from '@/components/icons'
import { planLiftGroupInfo, toggleGroupWithNext, normalizeGroups } from '@/lib/supersets'

const GOALS: { id: Goal; label: string }[] = [
  { id: 'strength', label: 'Strength' },
  { id: 'hypertrophy', label: 'Hypertrophy' },
  { id: 'general', label: 'General' },
  { id: 'powerlifting', label: 'Powerlifting' },
]
const LEVELS: { id: Experience; label: string }[] = [
  { id: 'beginner', label: 'Beginner' },
  { id: 'intermediate', label: 'Intermediate' },
  { id: 'advanced', label: 'Advanced' },
]
const CONTEXT_LABEL: Record<EquipmentContext, WorkoutPlan['equipment']> = {
  'full-gym': 'Full gym',
  'home-dumbbell': 'Minimal',
  minimal: 'Minimal',
  bodyweight: 'Bodyweight',
}

/** Derive the focus muscle tags for a day from the primary muscles of its lifts. */
function focusFromLifts(lifts: PlanLift[]): MuscleGroup[] {
  const count: Partial<Record<MuscleGroup, number>> = {}
  for (const l of lifts) {
    const ex = getExercise(l.exerciseId)
    for (const m of ex?.primary ?? []) count[m] = (count[m] ?? 0) + 1
  }
  return (Object.keys(count) as MuscleGroup[]).sort((a, b) => count[b]! - count[a]!).slice(0, 4)
}

function BuilderInner() {
  const router = useRouter()
  const confirm = useConfirm()
  const params = useSearchParams()
  const editId = params.get('edit')
  const profile = useStore((s) => s.profile)
  const customPlans = useStore((s) => s.customPlans)
  const addCustomPlan = useStore((s) => s.addCustomPlan)
  const updateCustomPlan = useStore((s) => s.updateCustomPlan)

  const editing = editId ? customPlans.find((p) => p.id === editId) : undefined

  const [name, setName] = useState(editing?.name ?? '')
  const [level, setLevel] = useState<Experience>(
    (editing?.level && editing.level !== 'all' ? editing.level : profile.experience) as Experience,
  )
  // A forked/edited plan (or profile) may carry a goal that isn't a builder chip (e.g. 'endurance'),
  // which would leave the Goal row with no active selection. Fall back to a listed goal so one is
  // always shown as selected.
  const initialGoal = editing?.goalFit?.[0] ?? profile.goal
  const [goal, setGoal] = useState<Goal>(
    GOALS.some((g) => g.id === initialGoal) ? initialGoal : 'general',
  )
  const [ctx, setCtx] = useState<EquipmentContext>(editing?.equipmentContext ?? 'full-gym')
  const [days, setDays] = useState<number>(editing?.daysPerWeek ?? 3)
  const [schedule, setSchedule] = useState<PlanDay[]>(editing?.schedule ?? [])
  const [pickerDay, setPickerDay] = useState<number | null>(null)

  // baseline for the unsaved-changes guard: snapshot the content that would be LOST on exit
  // (the plan name + the day/lift schedule). Settings chips alone aren't guarded — cheap to redo.
  const baseline = useRef({ name: editing?.name ?? '', schedule: JSON.stringify(editing?.schedule ?? []) })
  const dirty =
    name.trim() !== baseline.current.name.trim() || JSON.stringify(schedule) !== baseline.current.schedule

  // warn on tab close / refresh while there are unsaved edits
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const goBack = async () => {
    if (
      dirty &&
      !(await confirm({
        title: 'Discard changes?',
        body: editing
          ? 'Your unsaved edits to this plan will be lost.'
          : "Your unsaved plan will be lost — it hasn't been saved yet.",
        confirmLabel: 'Discard',
        tone: 'danger',
      }))
    )
      return
    router.push('/plans')
  }

  const pickerEquip = useMemo(() => planEquipment({ equipmentContext: ctx } as WorkoutPlan), [ctx])
  // don't offer lifts already on the day being edited (no accidental duplicates within a day)
  const pickerExclude = pickerDay !== null ? (schedule[pickerDay]?.lifts ?? []).map((l) => l.exerciseId) : []

  const repsForGoal = (): [number, number] =>
    goal === 'strength' || goal === 'powerlifting' ? [3, 5] : goal === 'general' ? [8, 12] : [8, 12]

  const generate = async () => {
    if (
      schedule.length > 0 &&
      !(await confirm({
        title: 'Regenerate plan?',
        body: 'The current days will be replaced with a freshly generated plan.',
        confirmLabel: 'Regenerate',
        tone: 'danger',
      }))
    )
      return
    const plan = scaffoldPlan({ name: name || 'My Plan', level, goal, equipmentContext: ctx, daysPerWeek: days }, profile)
    setSchedule(plan.schedule)
  }

  const patchDay = (i: number, patch: Partial<PlanDay>) =>
    setSchedule((s) => s.map((d, idx) => (idx === i ? { ...d, ...patch } : d)))
  const moveDay = (i: number, dir: -1 | 1) =>
    setSchedule((s) => {
      const j = i + dir
      if (j < 0 || j >= s.length) return s
      const next = [...s]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  const removeDay = (i: number) => setSchedule((s) => removeScheduleDay(s, i))
  const addDay = () => setSchedule((s) => [...s, blankDay(s.length)])

  const patchLift = (di: number, li: number, patch: Partial<PlanLift>) =>
    setSchedule((s) =>
      s.map((d, idx) =>
        idx === di ? { ...d, lifts: (d.lifts ?? []).map((l, lj) => (lj === li ? { ...l, ...patch } : l)) } : d,
      ),
    )
  const removeLift = (di: number, li: number) =>
    setSchedule((s) =>
      s.map((d, idx) =>
        // re-normalize so a partner left alone by the removal stops claiming a superset
        idx === di ? { ...d, lifts: normalizeGroups((d.lifts ?? []).filter((_, lj) => lj !== li)) } : d,
      ),
    )
  const moveLift = (di: number, li: number, dir: -1 | 1) =>
    setSchedule((s) =>
      s.map((d, idx) => {
        if (idx !== di) return d
        const lifts = [...(d.lifts ?? [])]
        const j = li + dir
        if (j < 0 || j >= lifts.length) return d
        ;[lifts[li], lifts[j]] = [lifts[j], lifts[li]]
        // a lift moved out of (or into the middle of) a group dissolves that bond; keep ids honest
        return { ...d, lifts: normalizeGroups(lifts) }
      }),
    )
  // toggle the superset bond between a lift and the one after it (authoring supersets in the builder)
  const toggleLiftGroup = (di: number, li: number) =>
    setSchedule((s) =>
      s.map((d, idx) => (idx === di ? { ...d, lifts: toggleGroupWithNext(d.lifts ?? [], li) } : d)),
    )
  const addLift = (di: number, exerciseId: string) => {
    const [repMin, repMax] = repsForGoal()
    const lift: PlanLift = { exerciseId, sets: 3, repMin, repMax }
    setSchedule((s) => s.map((d, idx) => (idx === di ? { ...d, lifts: [...(d.lifts ?? []), lift] } : d)))
  }

  const totalLifts = schedule.reduce((n, d) => n + (d.lifts?.length ?? 0), 0)
  const canSave = name.trim().length > 0 && schedule.length > 0 && totalLifts > 0

  const save = () => {
    if (!canSave) return
    const cleaned = schedule
      .map((d) => ({ ...d, lifts: d.lifts ?? [] }))
      .filter((d) => d.lifts.length > 0)
      // keep a day's own goal (e.g. a forked PHUL's power vs hypertrophy days); only fall back
      // to the builder-level goal when the day has none
      .map((d) => ({ ...d, focus: focusFromLifts(d.lifts), goal: d.goal ?? goal }))
    const plan: WorkoutPlan = {
      id: editing?.id ?? uid('plan'),
      name: name.trim(),
      tagline: `${cleaned.length}-day custom plan`,
      description: `A custom ${level} ${goal} program, ${cleaned.length} days a week.`,
      daysPerWeek: cleaned.length,
      daysPerWeekOptions: [cleaned.length],
      goalFit: [goal],
      level,
      equipment: CONTEXT_LABEL[ctx],
      equipmentContext: ctx,
      custom: true,
      schedule: cleaned,
    }
    if (editing) updateCustomPlan(editing.id, plan)
    else addCustomPlan(plan)
    router.push('/plans')
  }

  return (
    <div className="animate-fade-in pb-28">
      <header className="px-5 pt-5 safe-top">
        <button
          onClick={goBack}
          className="inline-flex items-center gap-1 text-sm text-fg/50 active:text-fg/80 -ml-1"
        >
          <ChevronLeft size={18} /> Plans
        </button>
        <h1 className="font-display text-[26px] font-black uppercase tracking-[-0.02em] leading-[0.95] mt-2">
          {editing ? 'Edit plan' : 'Create a plan'}
        </h1>
      </header>

      <div className="px-5 mt-4 space-y-5">
        {/* Settings */}
        <div className="card p-4 space-y-4">
          <div>
            <label htmlFor="plan-name" className="block text-sm font-medium text-fg/60 mb-1.5">
              Plan name
            </label>
            <input
              id="plan-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My Upper/Lower"
              maxLength={40}
              className="w-full rounded-xl bg-raised border border-hairline/[0.08] px-4 py-3 text-[15px] outline-none focus:border-blaze"
            />
          </div>
          <div>
            <div className="text-sm font-medium text-fg/60 mb-1.5">Goal</div>
            <div className="flex flex-wrap gap-1.5">
              {GOALS.map((g) => (
                <Chip key={g.id} selected={goal === g.id} label={g.label} onClick={() => setGoal(g.id)}>
                  {g.label}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="text-sm font-medium text-fg/60 mb-1.5">Experience</div>
            <div className="flex flex-wrap gap-1.5">
              {LEVELS.map((l) => (
                <Chip key={l.id} selected={level === l.id} label={l.label} onClick={() => setLevel(l.id)}>
                  {l.label}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="text-sm font-medium text-fg/60 mb-1.5">Equipment</div>
            <div className="flex flex-wrap gap-1.5">
              {EQUIPMENT_CONTEXTS.map((e) => (
                <Chip key={e.id} selected={ctx === e.id} label={e.label} onClick={() => setCtx(e.id)}>
                  {e.label}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="text-sm font-medium text-fg/60 mb-1.5">Days per week (for the guided builder)</div>
            <div className="flex flex-wrap gap-1.5">
              {[2, 3, 4, 5, 6].map((d) => (
                <Chip key={d} selected={days === d} label={`${d} days`} onClick={() => setDays(d)}>
                  {d}
                </Chip>
              ))}
            </div>
          </div>
          <Button onClick={generate} variant="secondary" fullWidth>
            {schedule.length ? 'Regenerate starting plan' : 'Generate starting plan'}
          </Button>
          <p className="text-xs text-fg/40 -mt-1">
            Fills each day with sensible lifts for your goal &amp; equipment — then edit anything below.
          </p>
        </div>

        {/* Schedule editor */}
        {schedule.length === 0 ? (
          <p className="text-sm text-fg/45 text-center py-6">
            Generate a starting plan above, or add days manually.
          </p>
        ) : (
          schedule.map((day, di) => (
            <div key={di} className="card p-4">
              <div className="flex items-center gap-2">
                <input
                  value={day.title}
                  onChange={(e) => patchDay(di, { title: e.target.value, label: e.target.value })}
                  className="flex-1 min-w-0 bg-transparent font-extrabold uppercase text-base outline-none border-b border-transparent focus:border-hairline/40"
                  aria-label={`Day ${di + 1} title`}
                />
                <button onClick={() => moveDay(di, -1)} disabled={di === 0} className="grid place-items-center min-w-[40px] tap-min-h-44 text-fg/40 disabled:opacity-30" aria-label="Move day up">
                  <ChevronUp size={16} />
                </button>
                <button onClick={() => moveDay(di, 1)} disabled={di === schedule.length - 1} className="grid place-items-center min-w-[40px] tap-min-h-44 text-fg/40 disabled:opacity-30" aria-label="Move day down">
                  <ChevronDown size={16} />
                </button>
                <button
                  onClick={() => removeDay(di)}
                  disabled={schedule.length === 1}
                  className="grid place-items-center min-w-[40px] tap-min-h-44 text-red-300/80 disabled:opacity-30"
                  aria-label="Remove day"
                  title={schedule.length === 1 ? 'A plan needs at least one day' : undefined}
                >
                  <TrashIcon size={16} />
                </button>
              </div>

              <div className="mt-3 space-y-2">
                {(() => {
                  const lifts = day.lifts ?? []
                  const info = planLiftGroupInfo(lifts)
                  return lifts.map((lift, li) => {
                    const ex = getExercise(lift.exerciseId)
                    const g = info[li]
                    const grouped = g.letter !== ''
                    // bonded with the lift below = it shares this lift's superset letter
                    const bonded = li < lifts.length - 1 && grouped && info[li + 1]?.letter === g.letter
                    return (
                      <div key={li}>
                        <div
                          className={`flex items-center gap-2 rounded-xl bg-raised border px-3 py-2 ${
                            grouped ? 'border-blaze/45' : 'border-hairline/[0.08]'
                          }`}
                        >
                          {grouped && (
                            <span
                              className="shrink-0 grid place-items-center w-6 h-6 rounded-md bg-blaze/[0.18] text-blaze-label text-[11px] font-bold tabular-nums"
                              aria-label={`Superset ${g.letter}, exercise ${g.pos + 1} of ${g.size}`}
                            >
                              {g.letter}
                              {g.pos + 1}
                            </span>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{ex?.name ?? lift.exerciseId}</div>
                            <div className="flex items-center gap-1.5 mt-1 text-xs text-fg/50">
                              <NumBox value={lift.sets} min={1} max={10} onChange={(v) => patchLift(di, li, { sets: v })} /> sets ×
                              <NumBox value={lift.repMin} min={1} max={50} onChange={(v) => patchLift(di, li, { repMin: v, repMax: Math.max(lift.repMax, v) })} />–
                              <NumBox value={lift.repMax} min={lift.repMin} max={50} onChange={(v) => patchLift(di, li, { repMax: Math.max(v, lift.repMin) })} /> reps
                            </div>
                          </div>
                          <button onClick={() => moveLift(di, li, -1)} disabled={li === 0} className="grid place-items-center px-1.5 tap-min-h-44 text-fg/35 disabled:opacity-30" aria-label="Move lift up">
                            <ChevronUp size={14} />
                          </button>
                          <button onClick={() => moveLift(di, li, 1)} disabled={li === lifts.length - 1} className="grid place-items-center px-1.5 tap-min-h-44 text-fg/35 disabled:opacity-30" aria-label="Move lift down">
                            <ChevronDown size={14} />
                          </button>
                          <button onClick={() => removeLift(di, li)} className="grid place-items-center px-1.5 tap-min-h-44 text-red-300/70" aria-label="Remove lift">
                            <TrashIcon size={14} />
                          </button>
                        </div>
                        {li < lifts.length - 1 && (
                          <div className="flex justify-center my-1">
                            <button
                              type="button"
                              onClick={() => toggleLiftGroup(di, li)}
                              aria-pressed={bonded}
                              aria-label={
                                bonded
                                  ? `Ungroup ${ex?.name ?? 'this lift'} from the next lift`
                                  : `Superset ${ex?.name ?? 'this lift'} with the next lift`
                              }
                              className={`inline-flex items-center gap-1 rounded-full px-3 min-h-[40px] text-[11px] font-medium transition ${
                                bonded
                                  ? 'bg-blaze/[0.12] text-blaze-label border border-blaze/50'
                                  : 'text-fg/40 border border-dashed border-hairline/20 active:text-fg/70'
                              }`}
                            >
                              <LinkIcon size={12} strokeWidth={1.5} />
                              {bonded ? 'Supersetted' : 'Group with next'}
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })
                })()}
              </div>

              <button
                onClick={() => setPickerDay(di)}
                className="mt-2 inline-flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-blaze-label active:opacity-80"
              >
                <PlusIcon size={16} /> Add lift
              </button>
            </div>
          ))
        )}

        <button
          onClick={addDay}
          className="w-full rounded-[13px] border border-dashed border-hairline/20 py-3 text-sm font-bold text-fg/55 hover:text-fg hover:border-hairline/40 active:scale-[0.99] transition inline-flex items-center justify-center gap-2"
        >
          <PlusIcon size={18} /> Add a day
        </button>
      </div>

      {/* Save bar */}
      <div className="fixed bottom-0 inset-x-0 px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-3 bg-gradient-to-t from-bg via-bg/95 to-transparent">
        <Button onClick={save} disabled={!canSave} fullWidth>
          {editing ? 'Save changes' : 'Save plan'}
        </Button>
      </div>

      <ExercisePicker
        open={pickerDay !== null}
        onClose={() => setPickerDay(null)}
        onPick={(id) => {
          if (pickerDay !== null) addLift(pickerDay, id)
          setPickerDay(null)
        }}
        exclude={pickerExclude}
        equipment={pickerEquip}
        title="Add a lift"
      />
    </div>
  )
}

function NumBox({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  // hold the in-progress text so a two-digit value (e.g. "12") isn't min-clamped mid-keystroke
  const [text, setText] = useState<string | null>(null)
  const display = text ?? String(value)
  return (
    <input
      type="number"
      inputMode="numeric"
      value={display}
      min={min}
      max={max}
      onChange={(e) => {
        const raw = e.target.value
        setText(raw)
        const n = Math.round(Number(raw))
        // while typing, only cap the upper bound + reject negatives; defer the min-clamp to blur
        if (raw !== '' && Number.isFinite(n)) onChange(Math.max(0, Math.min(max, n)))
      }}
      onBlur={() => {
        const n = Math.round(Number(text ?? value))
        onChange(Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min)
        setText(null)
      }}
      className="w-10 text-center rounded-md bg-card border border-hairline/10 text-fg text-xs py-0.5 outline-none focus:border-blaze tabular-nums"
      aria-label="number"
    />
  )
}

export default function PlanBuilderPage() {
  return (
    <Suspense fallback={<div className="px-5 pt-8 text-fg/40">Loading…</div>}>
      <BuilderInner />
    </Suspense>
  )
}
