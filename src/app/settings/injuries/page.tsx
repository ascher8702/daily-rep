'use client'

import { useMemo, useState } from 'react'
import type { Avoidance, AvoidanceTarget, BodyRegion, Exercise, InjurySeverity, MuscleGroup } from '@/types'
import { useStore } from '@/store/useStore'
import { useConfirm } from '@/components/ConfirmProvider'
import { ALL_MUSCLES, MUSCLES } from '@/data/muscles'
import {
  ALL_REGIONS,
  ALL_SEVERITIES,
  REGIONS,
  activeAvoidances,
  avoidanceLabel,
  avoidanceMeta,
  hasActiveInjury,
  rehabForAvoidance,
  regionLabel,
  severityLabel,
  severityDetail,
  DISCLAIMER,
  PAIN_GUIDE,
  RED_FLAGS,
} from '@/lib/injuries'
import { BackHeader, SectionLabel, Tile } from '@/components/settings/ui'
import { Toggle } from '@/components/ui/Toggle'
import {
  PlusIcon,
  TrashIcon,
  CheckIcon,
  ChevronDown,
  ChevronRight,
  HeartPulseIcon,
  AlertTriangleIcon,
  XIcon,
} from '@/components/icons'

/** severity → pill/segment tone classes (lime → blaze → rose, matching the recovery palette) */
const SEV_TONE: Record<InjurySeverity, { on: string; dot: string }> = {
  mild: { on: 'text-[#C6F24E] bg-[#C6F24E]/[0.12] border-[#C6F24E]/40', dot: 'bg-[#C6F24E]' },
  moderate: { on: 'text-blaze-label bg-blaze/[0.12] border-blaze/40', dot: 'bg-blaze' },
  severe: { on: 'text-[#fb7185] bg-[#fb7185]/[0.12] border-[#fb7185]/40', dot: 'bg-[#fb7185]' },
}
const PAIN_TONE: Record<string, string> = {
  fresh: 'text-[#C6F24E] bg-[#C6F24E]/[0.12]',
  moderate: 'text-blaze-label bg-blaze/[0.12]',
  rest: 'text-[#fb7185] bg-[#fb7185]/[0.12]',
}
const SEV_RANK: Record<InjurySeverity, number> = { severe: 0, moderate: 1, mild: 2 }

type AddMode = null | 'fork' | 'injury' | 'preference'

export default function WorkingAroundPage() {
  const profile = useStore((s) => s.profile)
  const addInjuryAvoidance = useStore((s) => s.addInjuryAvoidance)
  const addMusclePreference = useStore((s) => s.addMusclePreference)
  const updateAvoidance = useStore((s) => s.updateAvoidance)
  const toggleAvoidanceResolved = useStore((s) => s.toggleAvoidanceResolved)
  const removeAvoidance = useStore((s) => s.removeAvoidance)
  const convertPreferenceToInjury = useStore((s) => s.convertPreferenceToInjury)
  const confirm = useConfirm()

  const active = useMemo(() => activeAvoidances(profile), [profile])
  // only injuries can be "recovered" (preferences are add/remove only) — matches the section below
  const resolved = useMemo(() => (profile.avoiding ?? []).filter((a) => a.resolvedAt && a.kind === 'injury'), [profile.avoiding])
  const showSafety = hasActiveInjury(profile)

  // sorted list: injuries first (severe → mild), preferences last; newest-first within each band
  const sortedActive = useMemo(() => {
    const rank = (a: Avoidance) => (a.kind === 'injury' ? SEV_RANK[a.severity] : 3)
    return [...active].sort((x, y) => rank(x) - rank(y) || y.createdAt - x.createdAt)
  }, [active])

  // what's already spoken for, so the Add pickers don't offer a duplicate
  const usedRegions = useMemo(
    () => new Set(active.filter((a) => a.kind === 'injury' && a.target.type === 'region').map((a) => (a as { target: { region: BodyRegion } }).target.region)),
    [active],
  )
  const usedMuscles = useMemo(() => {
    const s = new Set<MuscleGroup>()
    for (const a of active) {
      if (a.kind === 'preference') s.add(a.muscle)
      else if (a.target.type === 'muscle') s.add(a.target.muscle)
    }
    return s
  }, [active])

  const [mode, setMode] = useState<AddMode>(null)
  const [draftTarget, setDraftTarget] = useState<AvoidanceTarget | null>(null)
  const [draftSeverity, setDraftSeverity] = useState<InjurySeverity>('mild')
  const [draftNote, setDraftNote] = useState('')
  const [prefMuscles, setPrefMuscles] = useState<MuscleGroup[]>([])

  const resetAdd = () => {
    setMode(null)
    setDraftTarget(null)
    setDraftSeverity('mild')
    setDraftNote('')
    setPrefMuscles([])
  }
  const saveInjury = () => {
    if (!draftTarget) return
    addInjuryAvoidance(draftTarget, draftSeverity, draftNote)
    resetAdd()
  }
  const savePreferences = () => {
    if (prefMuscles.length === 0) return
    for (const m of prefMuscles) addMusclePreference(m)
    resetAdd()
  }

  const onRemove = async (a: Avoidance) => {
    const label = avoidanceLabel(a)
    const ok =
      a.kind === 'injury'
        ? await confirm({
            title: `Remove ${label} injury?`,
            body: 'This deletes it for good. Your sessions will go back to programming this area normally.',
            confirmLabel: 'Remove',
            tone: 'danger',
          })
        : await confirm({
            title: `Stop skipping ${label}?`,
            body: 'Daily Rep will program this muscle normally again.',
            confirmLabel: 'Stop skipping',
            tone: 'danger',
          })
    if (ok) removeAvoidance(a.id)
  }

  return (
    <div className="bg-bg min-h-[100dvh] text-fg animate-fade-in">
      <BackHeader title="Injuries" />
      <div className="px-5 pt-2.5 pb-12 space-y-6">
        <p className="text-[13.5px] leading-relaxed text-fg/55">
          Tell Daily Rep about an injury and it builds your training around it, with recovery work. You can
          also skip a muscle you’d rather not train.
        </p>

        {/* ---- The one unified list ---- */}
        <section>
          <div className="flex items-center justify-between mb-2.5">
            <SectionLabel accent>Injuries</SectionLabel>
            {!mode && (
              <button
                onClick={() => setMode('fork')}
                className="inline-flex items-center gap-1 text-[12px] font-extrabold text-blaze-label active:text-blaze-warm"
              >
                <PlusIcon size={14} strokeWidth={2.2} /> Add
              </button>
            )}
          </div>

          {active.length === 0 && !mode && (
            <button
              onClick={() => setMode('fork')}
              className="w-full rounded-2xl border border-dashed border-hairline/20 bg-card/40 px-4 py-6 text-center active:scale-[0.99] transition"
            >
              <span className="grid place-items-center h-11 w-11 mx-auto rounded-2xl bg-blaze/[0.12] text-blaze-label mb-2.5">
                <HeartPulseIcon size={22} />
              </span>
              <div className="text-[14px] font-bold">No injuries yet</div>
              <p className="text-[12.5px] text-fg/50 mt-0.5">
                Add an injury to rehab — or a muscle you’d rather skip — and we’ll build around it.
              </p>
            </button>
          )}

          <div className="space-y-3">
            {sortedActive.map((a) =>
              a.kind === 'injury' ? (
                <InjuryCard
                  key={a.id}
                  a={a}
                  onSeverity={(severity) => updateAvoidance(a.id, { severity })}
                  onTogglePlans={() => updateAvoidance(a.id, { includeInPlans: !a.includeInPlans })}
                  onResolve={() => toggleAvoidanceResolved(a.id)}
                  onRemove={() => onRemove(a)}
                />
              ) : (
                <PreferenceCard
                  key={a.id}
                  a={a}
                  onTogglePlans={() => updateAvoidance(a.id, { includeInPlans: !a.includeInPlans })}
                  onConvert={() => convertPreferenceToInjury(a.id, 'mild')}
                  onRemove={() => onRemove(a)}
                />
              ),
            )}
          </div>

          {/* ---- Add flow: fork → injury / preference ---- */}
          {mode && (
            <div className="mt-3 rounded-2xl bg-card border border-hairline/10 p-4 animate-fade-in">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[13px] font-extrabold">
                  {mode === 'fork' ? 'What’s going on?' : mode === 'injury' ? 'Add an injury' : 'Skip a muscle'}
                </div>
                <button onClick={resetAdd} aria-label="Cancel" className="text-fg/40 active:text-fg/70">
                  <XIcon size={18} />
                </button>
              </div>

              {mode === 'fork' && (
                <div className="grid grid-cols-1 gap-2.5">
                  <ForkTile
                    icon={<HeartPulseIcon size={18} />}
                    title="An injury or pain"
                    sub="We’ll train around it and suggest recovery work."
                    onClick={() => setMode('injury')}
                  />
                  <ForkTile
                    icon={<XIcon size={18} />}
                    title="Just skip a muscle"
                    sub="No pain, no rehab — we’ll just leave it out."
                    onClick={() => setMode('preference')}
                  />
                </div>
              )}

              {mode === 'injury' && (
                <>
                  <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-fg/40 mb-2">
                    Joints &amp; common injuries
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {ALL_REGIONS.filter((r) => !usedRegions.has(r)).map((r) => (
                      <Tile
                        key={r}
                        active={draftTarget?.type === 'region' && draftTarget.region === r}
                        onClick={() => setDraftTarget({ type: 'region', region: r })}
                      >
                        {regionLabel(r)}
                      </Tile>
                    ))}
                  </div>

                  <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-fg/40 mt-4 mb-2">
                    A specific muscle
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {ALL_MUSCLES.filter((m) => !usedMuscles.has(m)).map((m) => {
                      const on = draftTarget?.type === 'muscle' && draftTarget.muscle === m
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setDraftTarget({ type: 'muscle', muscle: m })}
                          aria-pressed={on}
                          className={`text-[13px] rounded-full px-3.5 py-2.5 border transition ${
                            on ? 'font-extrabold text-blaze-label bg-blaze/[0.12] border-blaze/40' : 'font-semibold text-fg/65 bg-raised border-hairline/[0.06]'
                          }`}
                        >
                          {MUSCLES[m].label}
                        </button>
                      )
                    })}
                  </div>

                  {draftTarget && (
                    <>
                      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-fg/40 mt-4 mb-2">
                        How bad is it?
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {ALL_SEVERITIES.map((sev) => (
                          <button
                            key={sev}
                            type="button"
                            onClick={() => setDraftSeverity(sev)}
                            aria-pressed={draftSeverity === sev}
                            className={`text-center text-[13px] rounded-[11px] px-2 py-3 border transition font-extrabold ${
                              draftSeverity === sev ? SEV_TONE[sev].on : 'font-semibold text-fg/60 bg-raised border-hairline/[0.06]'
                            }`}
                          >
                            {severityLabel(sev)}
                          </button>
                        ))}
                      </div>
                      <p className="text-[12px] text-fg/55 mt-2 leading-relaxed">{severityDetail(draftSeverity)}</p>

                      <NoteInput value={draftNote} onChange={setDraftNote} />
                      <SaveButton label="Save injury" onClick={saveInjury} />
                    </>
                  )}
                </>
              )}

              {mode === 'preference' && (
                <>
                  <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-fg/40 mb-2">
                    Which muscles would you rather skip?
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {ALL_MUSCLES.filter((m) => !usedMuscles.has(m)).map((m) => {
                      const on = prefMuscles.includes(m)
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setPrefMuscles((p) => (on ? p.filter((x) => x !== m) : [...p, m]))}
                          aria-pressed={on}
                          className={`text-[13px] rounded-full px-3.5 py-2.5 border transition ${
                            on ? 'font-extrabold text-rose-300 bg-rose-400/[0.12] border-rose-400/50' : 'font-semibold text-fg/65 bg-raised border-hairline/[0.06]'
                          }`}
                        >
                          {MUSCLES[m].label}
                        </button>
                      )
                    })}
                  </div>
                  <NoteInput value={draftNote} onChange={setDraftNote} />
                  <SaveButton label={prefMuscles.length > 1 ? `Skip ${prefMuscles.length} muscles` : 'Skip muscle'} onClick={savePreferences} disabled={prefMuscles.length === 0} />
                </>
              )}
            </div>
          )}
        </section>

        {/* ---- Recovered (injuries only) ---- */}
        {resolved.length > 0 && (
          <section>
            <SectionLabel className="mb-2.5">Recovered</SectionLabel>
            <div className="rounded-2xl bg-card border border-hairline/10 divide-y divide-hairline/[0.06]">
              {resolved.map((a) => (
                <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-bold">{avoidanceLabel(a)}</div>
                    <div className="text-[11.5px] text-fg/45">Marked recovered</div>
                  </div>
                  <button onClick={() => toggleAvoidanceResolved(a.id)} className="text-[12px] font-bold text-blaze-label active:text-blaze-warm">
                    Reactivate
                  </button>
                  <button onClick={() => onRemove(a)} aria-label="Remove" className="text-fg/35 active:text-[#fb7185]">
                    <TrashIcon size={16} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ---- Training-around-pain guidance + safety — only when a real injury is active ---- */}
        {showSafety && (
          <>
            <section>
              <SectionLabel className="mb-2.5">Training around pain</SectionLabel>
              <div className="rounded-2xl bg-card border border-hairline/10 p-4 space-y-2.5">
                {PAIN_GUIDE.map((g) => (
                  <div key={g.range} className="flex items-start gap-3">
                    <span className={`shrink-0 grid place-items-center min-w-[34px] h-[26px] rounded-md text-[12px] font-extrabold tabular-nums ${PAIN_TONE[g.tone]}`}>
                      {g.range}
                    </span>
                    <p className="text-[12.5px] text-fg/60 leading-relaxed">{g.rule}</p>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="rounded-2xl border border-[#fb7185]/25 bg-[#fb7185]/[0.05] p-4">
                <div className="flex items-center gap-2 text-[#fb7185] mb-2">
                  <AlertTriangleIcon size={16} />
                  <span className="text-[12.5px] font-extrabold uppercase tracking-[0.06em]">Stop &amp; see a pro</span>
                </div>
                <ul className="space-y-1.5">
                  {RED_FLAGS.map((f) => (
                    <li key={f} className="flex gap-2 text-[12.5px] text-fg/65">
                      <span className="text-[#fb7185]/70 mt-[3px]">•</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </>
        )}

        {(active.length > 0 || resolved.length > 0) && <p className="text-[11px] leading-relaxed text-fg/35">{DISCLAIMER}</p>}
      </div>
    </div>
  )
}

function ForkTile({ icon, title, sub, onClick }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 rounded-xl bg-raised border border-hairline/[0.08] p-3.5 text-left active:scale-[0.99] transition">
      <span className="grid place-items-center h-9 w-9 rounded-[10px] bg-blaze/[0.12] text-blaze-label shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-bold">{title}</div>
        <div className="text-[11.5px] text-fg/50">{sub}</div>
      </div>
      <ChevronRight size={16} className="text-fg/35 shrink-0" />
    </button>
  )
}

function NoteInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <>
      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-fg/40 mt-4 mb-2">
        Note <span className="text-fg/30">(optional)</span>
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. left side, from deadlifts"
        maxLength={80}
        className="w-full rounded-xl bg-raised border border-hairline/10 px-3.5 py-3 text-[14px] outline-none focus:border-blaze"
      />
    </>
  )
}

function SaveButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="mt-4 w-full rounded-xl bg-gradient-blaze text-on-accent font-extrabold py-3.5 active:scale-[0.99] transition disabled:opacity-40"
    >
      {label}
    </button>
  )
}

function PlansSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-raised/60 border border-hairline/[0.06] px-3.5 py-3">
      <div className="min-w-0">
        <div className="text-[12.5px] font-semibold text-fg/80">Avoid in my structured plans</div>
        <div className="text-[11px] text-fg/40 mt-0.5">Off, only free workouts skip it. On, your plans drop it too.</div>
      </div>
      <Toggle on={on} onChange={onToggle} ariaLabel="Avoid in my structured plans" />
    </div>
  )
}

function InjuryCard({
  a,
  onSeverity,
  onTogglePlans,
  onResolve,
  onRemove,
}: {
  a: Extract<Avoidance, { kind: 'injury' }>
  onSeverity: (s: InjurySeverity) => void
  onTogglePlans: () => void
  onResolve: () => void
  onRemove: () => void
}) {
  const meta = avoidanceMeta(a)
  const [showRehab, setShowRehab] = useState(false)
  const rehab = useMemo(() => rehabForAvoidance(a), [a])

  return (
    <div className="rounded-2xl bg-card border border-hairline/10 overflow-hidden">
      <div className="p-4">
        <div className="flex items-center gap-2.5">
          <span className={`h-2 w-2 rounded-full ${SEV_TONE[a.severity].dot}`} />
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-black leading-tight">{meta.label}</div>
            {a.note && <div className="text-[12px] text-fg/45 truncate">{a.note}</div>}
          </div>
          <button
            onClick={onResolve}
            className="inline-flex items-center gap-1 text-[11.5px] font-bold text-fg/55 active:text-[#C6F24E] rounded-lg border border-hairline/10 px-2.5 py-1.5"
          >
            <CheckIcon size={13} strokeWidth={2.4} /> Recovered
          </button>
          <button onClick={onRemove} aria-label="Remove" className="text-fg/30 active:text-[#fb7185] p-1">
            <TrashIcon size={16} />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-3">
          {ALL_SEVERITIES.map((sev) => (
            <button
              key={sev}
              type="button"
              onClick={() => onSeverity(sev)}
              aria-pressed={a.severity === sev}
              className={`text-center text-[12.5px] rounded-[10px] px-2 py-2 border transition ${
                a.severity === sev ? `font-extrabold ${SEV_TONE[sev].on}` : 'font-semibold text-fg/55 bg-raised border-hairline/[0.06]'
              }`}
            >
              {severityLabel(sev)}
            </button>
          ))}
        </div>

        <p className="text-[12.5px] text-fg/60 leading-relaxed mt-3">{meta.guidance}</p>
        {meta.stillTrain && (
          <p className="text-[12px] text-fg/40 leading-relaxed mt-1.5">
            <span className="text-[#C6F24E]/80 font-bold">Still training:</span> {meta.stillTrain}
          </p>
        )}

        <PlansSwitch on={!!a.includeInPlans} onToggle={onTogglePlans} />
      </div>

      {rehab.length > 0 && (
        <div className="border-t border-hairline/[0.06]">
          <button onClick={() => setShowRehab((v) => !v)} className="w-full flex items-center gap-2 px-4 py-3 text-left active:bg-raised/40">
            <HeartPulseIcon size={15} className="text-blaze-label shrink-0" />
            <span className="flex-1 text-[13px] font-bold">Recovery work</span>
            <span className="text-[11.5px] text-fg/40 tabular-nums">{rehab.length}</span>
            <ChevronDown size={16} className={`text-fg/35 shrink-0 transition ${showRehab ? 'rotate-180' : ''}`} />
          </button>
          {showRehab && (
            <div className="px-4 pb-4 space-y-2">
              {rehab.map((ex) => (
                <RehabRow key={ex.id} ex={ex} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PreferenceCard({
  a,
  onTogglePlans,
  onConvert,
  onRemove,
}: {
  a: Extract<Avoidance, { kind: 'preference' }>
  onTogglePlans: () => void
  onConvert: () => void
  onRemove: () => void
}) {
  return (
    <div className="rounded-2xl bg-card/70 border border-hairline/[0.08] p-4">
      <div className="flex items-center gap-2.5">
        <span className="h-2 w-2 rounded-full bg-rose-400/70" />
        <div className="flex-1 min-w-0">
          <div className="text-[14.5px] font-bold leading-tight">{MUSCLES[a.muscle].label}</div>
          <div className="text-[11.5px] text-fg/40">Preference · not an injury{a.note ? ` · ${a.note}` : ''}</div>
        </div>
        <button onClick={onRemove} aria-label="Remove" className="text-fg/30 active:text-[#fb7185] p-1">
          <TrashIcon size={16} />
        </button>
      </div>
      <PlansSwitch on={!!a.includeInPlans} onToggle={onTogglePlans} />
      <button onClick={onConvert} className="mt-2.5 text-[12px] font-semibold text-fg/50 active:text-blaze-label inline-flex items-center gap-1">
        Bothering you? Make it an injury <ChevronRight size={13} />
      </button>
    </div>
  )
}

function RehabRow({ ex }: { ex: Exercise }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl bg-raised/60 border border-hairline/[0.06]">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left">
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-bold truncate">{ex.name}</div>
          {ex.dosage && <div className="text-[11.5px] text-fg/45 tabular-nums">{ex.dosage}</div>}
        </div>
        <ChevronDown size={15} className={`text-fg/35 shrink-0 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-3.5 pb-3.5 space-y-2">
          {ex.rationale && <p className="text-[12px] text-fg/55 leading-relaxed">{ex.rationale}</p>}
          <ol className="space-y-1.5">
            {ex.instructions.map((step, i) => (
              <li key={i} className="flex gap-2 text-[12px] text-fg/65 leading-relaxed">
                <span className="text-blaze-label/70 font-extrabold tabular-nums shrink-0">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
