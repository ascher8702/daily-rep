'use client'

import { useMemo, useState } from 'react'
import type { Equipment, Experience, Goal, MuscleGroup, Profile, Unit } from '../types'
import { useStore } from '../store/useStore'
import { useAuth } from '../store/useAuth'
import { nameFromEmail } from '../lib/auth'
import { recommendPlans } from '../lib/planMatch'
import { usePlansStore } from '../lib/plansRemote'
import { radioKeyDown } from '../lib/a11y'
import { ALL_MUSCLES, MUSCLES } from '../data/muscles'
import { BrandLogo } from '../components/BrandLogo'
import { Button } from '../components/ui/Button'
import { ChipTag } from '../components/ui/Chip'
import { CheckIcon, ChevronRight, ChevronLeft, TargetIcon, PlayIcon } from '../components/icons'

const GOALS: { id: Goal; label: string; desc: string }[] = [
  { id: 'strength', label: 'Get Stronger', desc: 'Heavy compound lifts, low reps' },
  { id: 'hypertrophy', label: 'Build Muscle', desc: 'Moderate reps, higher volume' },
  { id: 'endurance', label: 'Muscle Endurance', desc: 'Light loads, high reps' },
  { id: 'powerlifting', label: 'Powerlifting', desc: 'Max strength on the big 3' },
  { id: 'general', label: 'General Fitness', desc: 'Balanced, sustainable training' },
]

const EXPERIENCE: { id: Experience; label: string; desc: string }[] = [
  { id: 'beginner', label: 'Beginner', desc: 'New to lifting (0–1 yr)' },
  { id: 'intermediate', label: 'Intermediate', desc: 'Comfortable with the basics (1–3 yr)' },
  { id: 'advanced', label: 'Advanced', desc: 'Experienced lifter (3+ yr)' },
]

const EQUIPMENT: { id: Equipment; label: string }[] = [
  { id: 'barbell', label: 'Barbell' },
  { id: 'dumbbell', label: 'Dumbbells' },
  { id: 'bench', label: 'Bench' },
  { id: 'cable', label: 'Cable Machine' },
  { id: 'machine', label: 'Machines' },
  { id: 'kettlebell', label: 'Kettlebell' },
  { id: 'pullupbar', label: 'Pull-up Bar' },
  { id: 'bands', label: 'Resistance Bands' },
  { id: 'ezbar', label: 'EZ Bar' },
  { id: 'bodyweight', label: 'Bodyweight' },
]

const GYM_PRESETS: { label: string; items: Equipment[] }[] = [
  { label: 'Full Gym', items: ['barbell', 'dumbbell', 'bench', 'cable', 'machine', 'kettlebell', 'pullupbar', 'bands', 'ezbar', 'bodyweight'] },
  { label: 'Home — Dumbbells', items: ['dumbbell', 'bench', 'bodyweight'] },
  { label: 'Home — Barbell', items: ['barbell', 'dumbbell', 'bench', 'pullupbar', 'bodyweight'] },
  { label: 'Bodyweight Only', items: ['bodyweight', 'pullupbar'] },
]

const STEPS = ['Welcome', 'Goal', 'Experience', 'Schedule', 'Equipment', 'Muscles', 'Review'] as const
// steps the user can skip with no input (everything has a sensible default)
const OPTIONAL_STEPS = new Set([0, 5])

function Choice({
  active,
  onClick,
  title,
  sub,
}: {
  active: boolean
  onClick: () => void
  title: string
  sub?: string
}) {
  return (
    <button
      onClick={onClick}
      role="radio"
      aria-checked={active}
      tabIndex={active ? 0 : -1}
      className={`w-full text-left rounded-2xl border px-4 py-3.5 transition flex items-center gap-3 ${
        active ? 'border-blaze/40 bg-blaze/10' : 'border-hairline/[0.08] bg-card'
      }`}
    >
      <div className="flex-1">
        <div className={`font-semibold ${active ? 'text-blaze-label font-extrabold' : ''}`}>{title}</div>
        {sub && <div className="text-sm text-fg/50">{sub}</div>}
      </div>
      <span
        className={`grid place-items-center h-6 w-6 rounded-full border shrink-0 ${
          active ? 'bg-gradient-blaze border-transparent text-on-accent' : 'border-hairline/20 text-transparent'
        }`}
      >
        <CheckIcon size={14} strokeWidth={3} />
      </span>
    </button>
  )
}

export default function Onboarding() {
  const complete = useStore((s) => s.completeOnboarding)
  const generate = useStore((s) => s.generate)
  const startPlan = useStore((s) => s.startPlan)
  const email = useAuth((s) => s.email)

  const [step, setStep] = useState(0)
  // prefill the name from the email they just signed up with (editable); '' when nothing usable
  const [name, setName] = useState(() => (email ? nameFromEmail(email) : ''))
  const [gender, setGender] = useState<'male' | 'female' | undefined>(undefined)
  const [goal, setGoal] = useState<Goal>('hypertrophy')
  // default to the safest answer: 'beginner' caps volume/difficulty in the generator, so a brand-new
  // user who skips past this step isn't silently over-programmed
  const [experience, setExperience] = useState<Experience>('beginner')
  const [unit, setUnit] = useState<Unit>('lb')
  const [bodyweightText, setBodyweightText] = useState('')
  const [daysPerWeek, setDaysPerWeek] = useState(3)
  const [equipment, setEquipment] = useState<Equipment[]>(GYM_PRESETS[0].items)
  const [focus, setFocus] = useState<MuscleGroup[]>([])
  const [avoid, setAvoid] = useState<MuscleGroup[]>([])
  const [sessionLength, setSessionLength] = useState(50)

  const toggleEquip = (e: Equipment) =>
    setEquipment((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]))

  // tri-state muscle chip: neutral → emphasize → avoid → neutral
  const cycleMuscle = (m: MuscleGroup) => {
    if (focus.includes(m)) {
      setFocus((p) => p.filter((x) => x !== m))
      setAvoid((p) => [...p, m])
    } else if (avoid.includes(m)) {
      setAvoid((p) => p.filter((x) => x !== m))
    } else {
      setFocus((p) => [...p, m])
    }
  }

  const bodyweight = useMemo(() => {
    const n = Number(bodyweightText)
    return bodyweightText.trim() !== '' && Number.isFinite(n) && n > 0 ? Math.round(n) : undefined
  }, [bodyweightText])

  const displayName = name.trim() || 'athlete'
  const canNext = step !== 4 || equipment.length > 0

  // a profile snapshot for matching plans (uses the in-progress answers, not yet committed)
  const draftProfile = useMemo<Profile>(
    () => ({
      name: name.trim(),
      goal,
      experience,
      unit,
      equipment,
      focusMuscles: focus,
      avoidMuscles: avoid,
      bodyweight,
      gender,
      daysPerWeek,
      sessionLength,
      onboarded: false,
    }),
    [name, gender, goal, experience, unit, equipment, focus, avoid, bodyweight, daysPerWeek, sessionLength],
  )
  const catalogue = usePlansStore((s) => s.catalogue)
  const recommended = useMemo(() => recommendPlans(catalogue, draftProfile, { limit: 1 })[0], [catalogue, draftProfile])

  const commit = () =>
    complete({
      name: name.trim(),
      goal,
      experience,
      unit,
      equipment,
      focusMuscles: focus.filter((m) => !avoid.includes(m)),
      avoidMuscles: avoid,
      daysPerWeek,
      sessionLength,
      ...(gender ? { gender } : {}),
      ...(bodyweight != null ? { bodyweight } : {}),
    })
  const finishWithPlan = (planId: string) => {
    commit()
    startPlan(planId) // Home will lead with this plan's day
  }
  const finishFree = () => {
    commit()
    generate() // a fresh recovery-aware session waiting on Home
  }

  return (
    <div className="min-h-full flex flex-col safe-top">
      {/* progress dots + step counter */}
      <div className="px-5 pt-5">
        <div className="flex items-center gap-1.5">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition ${i <= step ? 'bg-gradient-blaze' : 'bg-raised'}`}
            />
          ))}
        </div>
        <div className="mt-2.5 flex items-center justify-between text-[11px] font-semibold text-fg/40">
          <span>Step {step + 1} of {STEPS.length}</span>
          {OPTIONAL_STEPS.has(step) && step < STEPS.length - 1 && (
            <button onClick={() => setStep((s) => s + 1)} className="text-fg/45 active:text-fg/70">
              Skip
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 px-5 pt-6 pb-4 animate-fade-in" key={step}>
        {step === 0 && (
          <div className="flex flex-col">
            <BrandLogo tile="gradient" size={60} className="self-start mb-5" />
            <h1 className="font-display text-[26px] font-black uppercase tracking-[-0.02em] leading-[0.95]">
              Welcome to Daily Rep{name.trim() ? `, ${name.trim()}` : ''}
            </h1>
            <p className="text-fg/55 mt-2.5 text-[15px]">
              Your training plan, rebuilt every session around how recovered your muscles are. Let's set
              you up — it takes a minute.
            </p>
            <label htmlFor="onboarding-name" className="block mt-7 text-xs font-semibold text-fg/60">
              What should we call you?
            </label>
            <input
              id="onboarding-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name (optional)"
              maxLength={30}
              className="mt-2 w-full rounded-xl bg-card border border-hairline/10 px-4 py-3.5 text-[15px] outline-none focus:border-blaze"
            />
            {email && (
              <p className="mt-2 text-xs text-fg/40">
                Signed in as <span className="text-fg/60">{email}</span>
              </p>
            )}

            <div className="mt-6">
              <div className="text-xs font-semibold text-fg/60 mb-2">
                Gender <span className="text-fg/40">(optional)</span>
              </div>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Gender">
                {(['female', 'male'] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => setGender((cur) => (cur === g ? undefined : g))}
                    role="radio"
                    aria-checked={gender === g}
                    className={`rounded-xl py-3 font-bold border capitalize transition ${
                      gender === g
                        ? 'border-blaze/40 bg-blaze/10 text-blaze-label'
                        : 'border-hairline/[0.08] bg-card text-fg/80'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-fg/40">Helps us recommend programs that fit your goals.</p>
            </div>
          </div>
        )}

        {step === 1 && (
          <Section title="What's your main goal?" sub="We'll tune sets, reps and rest to match.">
            <div className="space-y-2.5" role="radiogroup" aria-label="Training goal" onKeyDown={radioKeyDown}>
              {GOALS.map((g) => (
                <Choice key={g.id} active={goal === g.id} onClick={() => setGoal(g.id)} title={g.label} sub={g.desc} />
              ))}
            </div>
          </Section>
        )}

        {step === 2 && (
          <Section title="How experienced are you?" sub="Sets your exercise difficulty and volume.">
            <div className="space-y-2.5" role="radiogroup" aria-label="Experience level" onKeyDown={radioKeyDown}>
              {EXPERIENCE.map((e) => (
                <Choice
                  key={e.id}
                  active={experience === e.id}
                  onClick={() => setExperience(e.id)}
                  title={e.label}
                  sub={e.desc}
                />
              ))}
            </div>
            <div className="mt-6">
              <div className="text-xs font-semibold text-fg/60 mb-2">Preferred units</div>
              <div
                className="grid grid-cols-2 gap-2"
                role="radiogroup"
                aria-label="Preferred units"
                onKeyDown={radioKeyDown}
              >
                {(['lb', 'kg'] as Unit[]).map((u) => (
                  <button
                    key={u}
                    onClick={() => setUnit(u)}
                    role="radio"
                    aria-checked={unit === u}
                    tabIndex={unit === u ? 0 : -1}
                    className={`rounded-xl py-3 font-bold border transition ${
                      unit === u
                        ? 'border-blaze/40 bg-blaze/10 text-blaze-label'
                        : 'border-hairline/[0.08] bg-card text-fg/80'
                    }`}
                  >
                    {u === 'lb' ? 'Pounds (lb)' : 'Kilograms (kg)'}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-6">
              <label htmlFor="onboarding-bw" className="block text-xs font-semibold text-fg/60 mb-2">
                Your bodyweight <span className="text-fg/40">(optional)</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="onboarding-bw"
                  type="text"
                  inputMode="decimal"
                  value={bodyweightText}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === '' || /^\d*\.?\d*$/.test(v)) setBodyweightText(v)
                  }}
                  placeholder="e.g. 175"
                  className="flex-1 min-w-0 rounded-xl bg-card border border-hairline/10 px-4 py-3.5 text-[15px] outline-none focus:border-blaze"
                />
                <span className="text-sm font-medium text-fg/50 w-8">{unit}</span>
              </div>
              <p className="mt-1.5 text-xs text-fg/40">Used to estimate load on bodyweight exercises.</p>
            </div>
          </Section>
        )}

        {step === 3 && (
          <Section title="How often can you train?" sub="We'll recommend a program that fits your week.">
            <div className="text-xs font-semibold text-fg/60 mb-2">Days per week</div>
            <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Days per week" onKeyDown={radioKeyDown}>
              {[2, 3, 4, 5, 6].map((d) => (
                <button
                  key={d}
                  onClick={() => setDaysPerWeek(d)}
                  role="radio"
                  aria-checked={daysPerWeek === d}
                  tabIndex={daysPerWeek === d ? 0 : -1}
                  className={`rounded-xl py-3 font-bold tabular-nums border transition ${
                    daysPerWeek === d
                      ? 'border-blaze/40 bg-blaze/10 text-blaze-label'
                      : 'border-hairline/[0.08] bg-card text-fg/80'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
            <div className="mt-7">
              <div className="flex items-baseline justify-between">
                <div className="text-xs font-semibold text-fg/60">Session length</div>
                <div className="text-blaze-warm font-black tabular-nums">
                  {sessionLength} <span className="text-fg/40 font-medium text-xs">min</span>
                </div>
              </div>
              <input
                type="range"
                min={20}
                max={90}
                step={5}
                value={sessionLength}
                onChange={(e) => setSessionLength(Number(e.target.value))}
                aria-label="Session length in minutes"
                aria-valuetext={`${sessionLength} minutes`}
                className="w-full accent-blaze mt-3"
              />
              <div className="flex justify-between text-xs text-fg/40 mt-1">
                <span>20 min</span>
                <span>90 min</span>
              </div>
            </div>
          </Section>
        )}

        {step === 4 && (
          <Section title="What equipment do you have?" sub="We only program exercises you can actually do.">
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1 mb-3">
              {GYM_PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => setEquipment(p.items)}
                  className={`pill whitespace-nowrap border ${
                    p.items.length === equipment.length && p.items.every((i) => equipment.includes(i))
                      ? 'bg-blaze/10 border-blaze/40 text-blaze-label'
                      : 'bg-raised border-hairline/[0.08] text-fg/70'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {EQUIPMENT.map((e) => {
                const active = equipment.includes(e.id)
                return (
                  <button
                    key={e.id}
                    onClick={() => toggleEquip(e.id)}
                    aria-pressed={active}
                    className={`rounded-xl py-3 px-3 text-sm font-bold border text-left transition ${
                      active
                        ? 'border-blaze/40 bg-blaze/10 text-blaze-label'
                        : 'border-hairline/[0.08] bg-card text-fg/80'
                    }`}
                  >
                    {e.label}
                  </button>
                )
              })}
            </div>
          </Section>
        )}

        {step === 5 && (
          <Section title="Emphasize or avoid any muscles?" sub="Optional. Tap once to emphasize, again to avoid.">
            {/* Spell out the tri-state taps so the hidden 'avoid' step is discoverable before a
                second tap reveals it. The arrow reinforces the neutral → emphasize → avoid cycle. */}
            <div className="flex items-center gap-3 mb-3 text-xs text-fg/50">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-blaze" /> 1 tap · Emphasize
              </span>
              <ChevronRight size={12} className="text-fg/30 shrink-0" />
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-400" /> 2 taps · Avoid
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {ALL_MUSCLES.map((m) => {
                const emphasized = focus.includes(m)
                const avoided = avoid.includes(m)
                return (
                  <button
                    key={m}
                    onClick={() => cycleMuscle(m)}
                    aria-pressed={emphasized || avoided}
                    className={`rounded-xl py-3 px-3 text-sm font-bold border text-left transition ${
                      emphasized
                        ? 'border-blaze/40 bg-blaze/10 text-blaze-label'
                        : avoided
                          ? 'border-rose-400/60 bg-rose-400/10 text-rose-300 line-through decoration-rose-400/50'
                          : 'border-hairline/[0.08] bg-card text-fg/80'
                    }`}
                  >
                    {MUSCLES[m].label}
                  </button>
                )
              })}
            </div>
          </Section>
        )}

        {step === 6 && (
          <div>
            <h1 className="font-display text-[26px] font-black uppercase tracking-[-0.02em] leading-[0.95]">
              You're all set, {displayName}.
            </h1>
            <p className="text-fg/50 mt-2 text-[15px]">Review your setup, then pick how to start.</p>

            {/* editable summary — tap a row to jump back and change it */}
            <div className="mt-5 card divide-y divide-hairline/[0.08]">
              <SummaryRow label="Goal" value={GOALS.find((g) => g.id === goal)!.label} onEdit={() => setStep(1)} />
              <SummaryRow label="Experience" value={EXPERIENCE.find((e) => e.id === experience)!.label} onEdit={() => setStep(2)} />
              {gender && (
                <SummaryRow label="Gender" value={gender[0].toUpperCase() + gender.slice(1)} onEdit={() => setStep(0)} />
              )}
              <SummaryRow label="Schedule" value={`${daysPerWeek} days/wk · ${sessionLength} min`} onEdit={() => setStep(3)} />
              <SummaryRow label="Equipment" value={equipment.length === EQUIPMENT.length ? 'Full gym' : `${equipment.length} selected`} onEdit={() => setStep(4)} />
              {bodyweight != null && (
                <SummaryRow label="Bodyweight" value={`${bodyweight} ${unit}`} onEdit={() => setStep(2)} />
              )}
              {(focus.length > 0 || avoid.length > 0) && (
                <SummaryRow
                  label="Muscles"
                  value={[focus.length ? `↑ ${focus.length}` : '', avoid.length ? `✕ ${avoid.length}` : ''].filter(Boolean).join(' · ')}
                  onEdit={() => setStep(5)}
                />
              )}
            </div>

            {/* recommended starter plan */}
            {recommended && (
              <div className="mt-6">
                <div className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[0.1em] text-blaze-label mb-2">
                  <TargetIcon size={13} /> Recommended for you
                </div>
                <div className="card p-4 border border-blaze/30">
                  <div className="font-display font-black uppercase tracking-[-0.01em] text-lg leading-tight">{recommended.plan.name}</div>
                  <div className="text-sm text-fg/55 mt-1">{recommended.plan.tagline}</div>
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    <ChipTag variant="neutral">{recommended.plan.daysPerWeek} days/week</ChipTag>
                    {recommended.reasons.slice(0, 2).map((r) => (
                      <ChipTag key={r} variant="accent">{r}</ChipTag>
                    ))}
                  </div>
                  <Button onClick={() => finishWithPlan(recommended.plan.id)} variant="primary" fullWidth className="mt-4">
                    <PlayIcon size={18} /> Start {recommended.plan.name}
                  </Button>
                </div>
              </div>
            )}

            <Button onClick={finishFree} variant="ghost" fullWidth className="mt-3">
              Just build single workouts
            </Button>
          </div>
        )}
      </div>

      {/* nav buttons (hidden on the final review step, which has its own CTAs) */}
      {step < STEPS.length - 1 && (
        <div className="px-5 py-4 safe-bottom flex items-center gap-3 bg-bg/[0.92] backdrop-blur-md border-t border-hairline/[0.08]">
          {step > 0 && (
            <Button onClick={() => setStep((s) => s - 1)} variant="secondary" aria-label="Back">
              <ChevronLeft size={18} />
            </Button>
          )}
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext} variant="primary" fullWidth>
            Continue <ChevronRight size={18} />
          </Button>
        </div>
      )}
    </div>
  )
}

function SummaryRow({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <button onClick={onEdit} className="w-full flex items-center justify-between px-4 py-3 text-left active:bg-raised/40 transition">
      <span className="text-sm text-fg/50">{label}</span>
      <span className="flex items-center gap-1.5 text-sm font-medium text-fg/85">
        {value}
        <ChevronRight size={14} className="text-fg/30" />
      </span>
    </button>
  )
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div>
      <h1 className="font-display text-[26px] font-black uppercase tracking-[-0.02em] leading-[0.95]">{title}</h1>
      {sub && <p className="text-fg/50 mt-2.5 text-[15px]">{sub}</p>}
      <div className="mt-6">{children}</div>
    </div>
  )
}
