'use client'

import { useState } from 'react'
import type { Equipment, Experience, Goal, MuscleGroup, Unit } from '@/types'
import { useStore, restSecondsFor } from '@/store/useStore'
import { ALL_MUSCLES, MUSCLES } from '@/data/muscles'
import { BackHeader, SectionLabel, Tile, Chip } from '@/components/settings/ui'

const GOALS: { id: Goal; label: string; full?: boolean }[] = [
  { id: 'strength', label: 'Get Stronger' },
  { id: 'hypertrophy', label: 'Build Muscle' },
  { id: 'endurance', label: 'Endurance' },
  { id: 'powerlifting', label: 'Powerlifting' },
  { id: 'general', label: 'General Fitness', full: true },
]
const EXPERIENCE: { id: Experience; label: string }[] = [
  { id: 'beginner', label: 'Beginner' },
  { id: 'intermediate', label: 'Intermediate' },
  { id: 'advanced', label: 'Advanced' },
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
const REST_PRESETS = [60, 90, 120, 150, 180]
const fmtRest = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export default function TrainingPreferencesPage() {
  const profile = useStore((s) => s.profile)
  const updateProfile = useStore((s) => s.updateProfile)
  const setGoal = useStore((s) => s.setGoal)
  const setExperience = useStore((s) => s.setExperience)
  const setUnit = useStore((s) => s.setUnit)
  const toggleEquipment = useStore((s) => s.toggleEquipment)
  const toggleFocusMuscle = useStore((s) => s.toggleFocusMuscle)
  const toggleAvoidMuscle = useStore((s) => s.toggleAvoidMuscle)
  const avoidMuscles = profile.avoidMuscles ?? []

  return (
    <div className="bg-bg min-h-[100dvh] text-fg animate-fade-in">
      <BackHeader title="Training" />
      <div className="px-5 pt-2.5 pb-10 space-y-5">
        <section>
          <SectionLabel accent className="mb-2.5">Goal</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            {GOALS.map((g) => (
              <Tile key={g.id} active={profile.goal === g.id} onClick={() => setGoal(g.id)} className={g.full ? 'col-span-2' : ''}>
                {g.label}
              </Tile>
            ))}
          </div>
        </section>

        <section>
          <SectionLabel className="mb-2.5">Experience</SectionLabel>
          <div className="grid grid-cols-3 gap-2">
            {EXPERIENCE.map((e) => (
              <Tile key={e.id} active={profile.experience === e.id} onClick={() => setExperience(e.id)}>{e.label}</Tile>
            ))}
          </div>
        </section>

        <section>
          <SectionLabel className="mb-2.5">Session</SectionLabel>
          <div className="rounded-2xl bg-card border border-hairline/10 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] font-semibold text-fg/55">Target duration</span>
              <span className="text-2xl font-black text-blaze tabular-nums">
                {profile.sessionLength}
                <span className="text-sm font-bold text-fg/50"> min</span>
              </span>
            </div>
            <input
              type="range"
              min={20}
              max={90}
              step={5}
              value={profile.sessionLength}
              onChange={(e) => updateProfile({ sessionLength: Number(e.target.value) })}
              aria-label="Target session length in minutes"
              className="mt-3 w-full accent-blaze"
            />
            <div className="flex justify-between text-[11px] text-fg/35 mt-1.5"><span>20 min</span><span>90 min</span></div>
          </div>
        </section>

        <section>
          <SectionLabel className="mb-2.5">Units</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            {(['lb', 'kg'] as Unit[]).map((u) => (
              <Tile key={u} active={profile.unit === u} onClick={() => setUnit(u)}>{u === 'lb' ? 'Pounds (lb)' : 'Kilograms (kg)'}</Tile>
            ))}
          </div>
        </section>

        <section>
          <SectionLabel className="mb-2.5">Rest between sets</SectionLabel>
          <div className="grid grid-cols-3 gap-2">
            <Tile active={!profile.restSeconds} onClick={() => updateProfile({ restSeconds: undefined })}>Auto</Tile>
            {REST_PRESETS.map((sec) => (
              <Tile key={sec} active={profile.restSeconds === sec} onClick={() => updateProfile({ restSeconds: sec })}>
                <span className="tabular-nums">{fmtRest(sec)}</span>
              </Tile>
            ))}
          </div>
          <p className="text-[11px] text-fg/40 mt-2">
            {profile.restSeconds ? `Rests ${fmtRest(profile.restSeconds)} after every working set.` : `Auto matches your goal (${fmtRest(restSecondsFor(profile))}).`}
          </p>
        </section>

        <section>
          <SectionLabel className="mb-2.5">Equipment</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            {EQUIPMENT.map((e) => (
              <Tile key={e.id} active={profile.equipment.includes(e.id)} onClick={() => toggleEquipment(e.id)} className="!py-3 !px-3.5 text-left">{e.label}</Tile>
            ))}
          </div>
        </section>

        <section>
          <SectionLabel className="mb-2.5">Focus muscles</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {ALL_MUSCLES.map((m: MuscleGroup) => (
              <Chip key={m} active={profile.focusMuscles.includes(m)} onClick={() => toggleFocusMuscle(m)}>{MUSCLES[m].label}</Chip>
            ))}
          </div>
          <p className="text-[11px] text-fg/40 mt-2">We’ll give these muscles a little extra priority.</p>
        </section>

        <section>
          <SectionLabel className="mb-2.5">Working around</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {ALL_MUSCLES.map((m: MuscleGroup) => {
              const active = avoidMuscles.includes(m)
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggleAvoidMuscle(m)}
                  aria-pressed={active}
                  className={`text-[13px] rounded-full px-3.5 py-2.5 border transition ${
                    active
                      ? 'font-extrabold text-rose-300 bg-rose-400/[0.12] border-rose-400/50'
                      : 'font-semibold text-fg/65 bg-raised border-hairline/[0.06]'
                  }`}
                >
                  {MUSCLES[m].label}
                </button>
              )
            })}
          </div>
          <p className="text-[11px] text-fg/40 mt-2">
            Injured or sore? Auto-built workouts skip exercises that mainly target these. Not medical advice — train safely.
          </p>

          <div className="mt-3.5 flex items-center justify-between gap-3 rounded-2xl bg-card border border-hairline/10 p-4">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-fg/80">Apply to plan workouts</div>
              <div className="text-[11px] text-fg/40 mt-0.5">
                Also drop these from structured plan days. Off keeps a program intact; you’ll still get a heads-up when a session targets them.
              </div>
            </div>
            {(() => {
              const on = profile.avoidInPlans ?? false
              return (
                <button
                  role="switch"
                  aria-checked={on}
                  aria-label="Apply working-around muscles to plan workouts"
                  onClick={() => updateProfile({ avoidInPlans: !on })}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? 'bg-rose-400' : 'bg-raised border border-hairline/15'}`}
                >
                  <span
                    className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[1.375rem]' : 'translate-x-0.5'}`}
                  />
                </button>
              )
            })()}
          </div>
        </section>
      </div>
    </div>
  )
}
