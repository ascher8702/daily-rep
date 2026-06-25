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
        </section>
      </div>
    </div>
  )
}
