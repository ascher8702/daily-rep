'use client'

import { useState } from 'react'
import type { Theme, Unit } from '@/types'
import { useStore } from '@/store/useStore'
import { ACCENTS, DEFAULT_ACCENT } from '@/lib/theme'
import { BackHeader, SectionLabel, Tile } from '@/components/settings/ui'
import { Toggle } from '@/components/ui/Toggle'

function BodyweightField({ value, unit, onChange }: { value?: number; unit: Unit; onChange: (bw: number | undefined) => void }) {
  const [text, setText] = useState<string | null>(null)
  const display = text ?? (value ? String(value) : '')
  return (
    <input
      type="text"
      inputMode="decimal"
      value={display}
      placeholder={unit === 'kg' ? 'e.g. 70' : 'e.g. 155'}
      onChange={(e) => {
        const raw = e.target.value
        if (raw !== '' && !/^\d*\.?\d*$/.test(raw)) return
        setText(raw)
        const n = raw === '' || raw === '.' ? undefined : Math.min(Number(raw), 1000)
        onChange(n && Number.isFinite(n) ? n : undefined)
      }}
      onBlur={() => setText(null)}
      className="w-full rounded-xl bg-card border border-hairline/10 px-3.5 py-3.5 text-[15px] font-semibold outline-none focus:border-blaze/60"
    />
  )
}

export default function ProfileAppearancePage() {
  const profile = useStore((s) => s.profile)
  const updateProfile = useStore((s) => s.updateProfile)
  const initial = (profile.name.trim()[0] || 'A').toUpperCase()

  return (
    <div className="bg-bg min-h-[100dvh] text-fg animate-fade-in">
      <BackHeader title="Profile" />
      <div className="px-5 pt-3.5 pb-10">
        <div className="flex flex-col items-center">
          <span className="grid place-items-center h-[74px] w-[74px] rounded-[22px] bg-gradient-blaze text-on-accent text-[32px] font-black">{initial}</span>
        </div>

        <label className="block text-xs font-semibold text-fg/55 mt-[18px] mb-1.5">Name</label>
        <input
          value={profile.name}
          onChange={(e) => updateProfile({ name: e.target.value })}
          placeholder="Your name"
          maxLength={30}
          className="w-full rounded-xl bg-card border border-hairline/10 px-3.5 py-3.5 text-[15px] font-semibold outline-none focus:border-blaze/60"
        />

        <label className="block text-xs font-semibold text-fg/55 mt-3.5 mb-1.5">Bodyweight ({profile.unit})</label>
        <BodyweightField value={profile.bodyweight} unit={profile.unit} onChange={(bw) => updateProfile({ bodyweight: bw })} />
        <p className="text-[11px] text-fg/40 mt-1.5">Counts bodyweight exercises toward volume and PRs.</p>

        <div className="text-xs font-semibold text-fg/55 mt-4 mb-1.5">Gender</div>
        <div className="grid grid-cols-2 gap-2">
          {(['female', 'male'] as const).map((g) => (
            <Tile key={g} active={profile.gender === g} onClick={() => updateProfile({ gender: profile.gender === g ? undefined : g })} className="!py-3 capitalize">{g}</Tile>
          ))}
        </div>

        <SectionLabel className="mt-6 mb-2.5">Appearance</SectionLabel>
        <div className="rounded-2xl bg-card border border-hairline/10 p-4">
          <div className="text-xs font-semibold text-fg/55 mb-2.5">Theme</div>
          <div className="grid grid-cols-3 gap-2">
            {(['system', 'light', 'dark'] as Theme[]).map((t) => (
              <Tile key={t} active={(profile.theme ?? 'system') === t} onClick={() => updateProfile({ theme: t })} className="capitalize">{t}</Tile>
            ))}
          </div>
          <div className="text-xs font-semibold text-fg/55 mt-4 mb-3">Accent</div>
          <div className="flex flex-wrap gap-3.5">
            {ACCENTS.map((a) => {
              const active = (profile.accent ?? DEFAULT_ACCENT) === a.id
              const rgb = (t: string) => `rgb(${t.replace(/ /g, ',')})`
              return (
                <button
                  key={a.id}
                  onClick={() => updateProfile({ accent: a.id })}
                  aria-label={a.label}
                  aria-pressed={active}
                  className={`h-8 w-8 rounded-full transition ${active ? 'ring-2 ring-fg ring-offset-2 ring-offset-bg' : ''}`}
                  // swatch previews the accent's two-stop gradient
                  style={{ backgroundImage: `linear-gradient(135deg, ${rgb(a.hotDark)}, ${rgb(a.warmDark)})` }}
                />
              )
            })}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-fg/55">Sound &amp; haptics</div>
              <div className="text-[11px] text-fg/40 mt-0.5">Chime and buzz when you finish a workout.</div>
            </div>
            <Toggle
              on={profile.effects ?? true}
              onChange={() => updateProfile({ effects: !(profile.effects ?? true) })}
              ariaLabel="Sound and haptics"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
