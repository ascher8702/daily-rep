'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useStore } from '@/store/useStore'
import {
  summarizeWorkout,
  tonnageComparison,
  computeWeeklyStreak,
  localWeek,
  defaultBodyweight,
  averageRPE,
} from '@/lib/stats'
import { fmtWeight, fmtDuration, fmtDate, fmtNum } from '@/lib/format'
import { getExercise } from '@/data/exercises'
import { muscleLabel } from '@/data/muscles'
import SessionNote from '@/components/SessionNote'
import CompletionCelebration from '@/components/CompletionCelebration'
import { Button } from '@/components/ui/Button'
import { StatTile } from '@/components/ui/StatTile'
import {
  CheckIcon,
  TrophyIcon,
  FlameIcon,
  TimerIcon,
  DumbbellIcon,
  TargetIcon,
  HistoryIcon,
  NoteIcon,
} from '@/components/icons'

function SummaryInner() {
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('w') ?? ''
  const workouts = useStore((s) => s.workouts)
  const profile = useStore((s) => s.profile)
  const setWorkoutNote = useStore((s) => s.setWorkoutNote)

  const workout = workouts.find((w) => w.id === id)

  // celebrate only a FRESH finish (within ~15s of completion), captured once so a re-render / revisit
  // of an older summary doesn't replay the confetti, chime, or haptic.
  const [justCompleted] = useState(
    () => !!workout?.completedAt && Date.now() - workout.completedAt < 15_000,
  )

  // direct nav / stale link with no matching workout → just go home
  useEffect(() => {
    if (id && !workout) router.replace('/')
  }, [id, workout, router])

  const data = useMemo(() => {
    if (!workout) return null
    const bw = workout.bodyweight && workout.bodyweight > 0 ? workout.bodyweight : defaultBodyweight(profile.unit)
    const summary = summarizeWorkout(workout, workouts, bw)
    const ref = workout.completedAt ?? workout.date
    const completionTimes = workouts
      .filter((w) => w.status === 'completed')
      .map((w) => w.completedAt ?? w.date)
    return {
      summary,
      weeklyStreak: computeWeeklyStreak(completionTimes, ref),
      thisWeek: completionTimes.filter((t) => localWeek(t) === localWeek(ref)).length,
      tonnage: tonnageComparison(summary.volume, profile.unit),
      avgRpe: averageRPE(workout),
    }
  }, [workout, workouts, profile.unit])

  if (!workout || !data) return null
  const { summary, weeklyStreak, thisWeek, tonnage, avgRpe } = data
  const unit = profile.unit
  const isBW = (exerciseId: string, weight: number) =>
    weight === 0 && !!getExercise(exerciseId)?.equipment.includes('bodyweight')
  const pct = summary.vsAverage != null ? Math.round((summary.vsAverage - 1) * 100) : null

  return (
    <div className="min-h-screen flex flex-col animate-fade-in pb-28">
      {justCompleted && <CompletionCelebration count={summary.prs.length > 0 ? 120 : 80} />}
      <main className="flex-1 px-5 pt-10 safe-top">
        {/* celebratory hero */}
        <div className="flex flex-col items-center text-center">
          <div className="relative">
            {justCompleted && (
              <span aria-hidden className="absolute inset-0 rounded-full bg-blaze/30 celebrate-ring" />
            )}
            <span
              className={`relative grid place-items-center h-16 w-16 rounded-full bg-gradient-blaze text-on-accent shadow-icon ${
                justCompleted ? 'celebrate-pop' : 'animate-pop'
              }`}
            >
              <CheckIcon size={34} strokeWidth={3} />
            </span>
          </div>
          <div className="mt-4 text-[11px] font-extrabold uppercase tracking-[0.12em] text-blaze-label">Workout Complete</div>
          <h1 className="font-display text-3xl font-black uppercase tracking-[-0.02em] leading-tight mt-1.5">{workout.title}</h1>
          <div className="text-sm text-fg/45 mt-1.5">
            {fmtDate(workout.completedAt ?? workout.date)} · {fmtDuration(summary.durationMin)}
          </div>
        </div>

        {/* PR banner */}
        {summary.prs.length > 0 && (
          <div className="mt-6 rounded-2xl bg-blaze/10 border border-blaze/30 px-4 py-3 flex items-center gap-3">
            <span className="grid place-items-center h-10 w-10 rounded-full bg-blaze/20 text-blaze-label shrink-0">
              <TrophyIcon size={20} />
            </span>
            <div className="min-w-0">
              <div className="font-black text-blaze-label">
                {summary.prs.length} new personal record{summary.prs.length === 1 ? '' : 's'}!
              </div>
              <div className="text-xs text-fg/55">You beat your best est. 1-rep max on these lifts.</div>
            </div>
          </div>
        )}

        {/* headline stats */}
        <div className="grid grid-cols-3 gap-2.5 mt-6">
          <StatTile value={fmtNum(summary.volume)} label={`${unit} volume`} />
          <StatTile value={String(summary.sets)} label={summary.sets === 1 ? 'set' : 'sets'} />
          <StatTile value={String(summary.reps)} label="reps" />
        </div>
        {pct != null && pct !== 0 && (
          <div className="mt-3 text-center text-sm">
            <span className={pct > 0 ? 'text-recovery-fresh font-extrabold' : 'text-fg/55'}>
              {pct > 0 ? '↑' : '↓'} {Math.abs(pct)}%
            </span>{' '}
            <span className="text-fg/45">volume vs your average session</span>
          </div>
        )}
        {avgRpe != null && (
          <div className="mt-2 text-center text-sm">
            <span className="text-fg/45">Avg intensity</span>{' '}
            <span className="font-semibold text-fg tabular-nums">RPE {avgRpe}</span>
          </div>
        )}

        {/* PR detail cards */}
        {summary.prs.length > 0 && (
          <section className="mt-7">
            <SectionTitle icon={<TrophyIcon size={14} />}>Personal records</SectionTitle>
            <div className="space-y-2">
              {summary.prs.map((pr) => (
                <div key={pr.exerciseId} className="bg-card rounded-2xl px-4 py-3 flex items-center justify-between gap-3 border border-blaze/[0.22]">
                  <div className="min-w-0">
                    <div className="font-extrabold uppercase truncate">{getExercise(pr.exerciseId)?.name ?? 'Exercise'}</div>
                    <div className="text-xs text-fg/50">est. 1-rep max</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-black tabular-nums">{fmtWeight(pr.e1rm, unit)}</div>
                    {pr.previous > 0 && (
                      <div className="text-xs font-extrabold text-blaze-label tabular-nums">
                        +{fmtWeight(pr.e1rm - pr.previous, unit)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* muscles trained */}
        {summary.muscles.length > 0 && (
          <section className="mt-7">
            <SectionTitle icon={<TargetIcon size={14} />}>Muscles trained</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {summary.muscles.map(({ muscle, sets }) => (
                <span key={muscle} className="pill bg-raised border border-hairline/10 text-fg/80">
                  {muscleLabel(muscle)}
                  <span className="text-fg/40 tabular-nums"> · {sets}</span>
                </span>
              ))}
            </div>
          </section>
        )}

        {/* per-exercise breakdown */}
        <section className="mt-7">
          <SectionTitle icon={<DumbbellIcon size={14} />}>Top set each lift</SectionTitle>
          <div className="card divide-y divide-hairline/10">
            {summary.topSets.map((t) => {
              const bw = isBW(t.exerciseId, t.weight)
              const gotPR = summary.prs.some((p) => p.exerciseId === t.exerciseId)
              return (
                <div key={t.exerciseId} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="font-medium truncate">{getExercise(t.exerciseId)?.name ?? 'Exercise'}</span>
                    {gotPR && (
                      <span className="shrink-0 grid place-items-center h-5 w-5 rounded-full bg-blaze/20 text-blaze-label">
                        <TrophyIcon size={11} />
                      </span>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold tabular-nums">
                      {bw ? `BW × ${t.reps}` : `${fmtWeight(t.weight, unit)} × ${t.reps}`}
                    </div>
                    <div className="text-[11px] text-fg/40 tabular-nums">~{fmtWeight(t.e1rm, unit)} 1RM</div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* session note — capture how it felt while it's fresh */}
        <section className="mt-7">
          <SectionTitle icon={<NoteIcon size={14} />}>Notes</SectionTitle>
          <SessionNote
            key={workout.id}
            value={workout.note ?? ''}
            onSave={(v) => setWorkoutNote(workout.id, v)}
            placeholder="How did it go? Energy, sleep, what to change next time…"
          />
        </section>

        {/* fun tonnage comparison */}
        {tonnage && (
          <div className="mt-5 rounded-2xl bg-card border border-hairline/10 px-4 py-3.5 text-center">
            <div className="text-sm text-fg/55">
              You moved <span className="font-bold text-fg">{fmtNum(summary.volume)} {unit}</span> of total volume
            </div>
            <div className="text-blaze-label font-black mt-0.5">{tonnage} 🐘</div>
          </div>
        )}

        {/* consistency */}
        <div className="mt-5 flex items-center justify-center gap-4 text-sm">
          {weeklyStreak > 0 && (
            <span className="inline-flex items-center gap-1.5 text-blaze-warm font-semibold">
              <FlameIcon size={15} /> {weeklyStreak}-week streak
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 text-fg/55">
            <TimerIcon size={15} /> {thisWeek} this week
          </span>
        </div>
      </main>

      {/* sticky CTA */}
      <div className="fixed bottom-0 inset-x-0 z-30 mx-auto max-w-md px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-3 bg-gradient-to-t from-bg via-bg/95 to-transparent">
        <Button onClick={() => router.push('/')} fullWidth>
          Done
        </Button>
        <button
          onClick={() => router.push('/history')}
          className="w-full text-center text-sm text-fg/45 mt-2.5 py-1 active:text-fg/70 inline-flex items-center justify-center gap-1.5"
        >
          <HistoryIcon size={14} /> View in history
        </button>
      </div>
    </div>
  )
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[0.1em] text-fg/40 mb-2.5">
      {icon}
      {children}
    </h2>
  )
}

export default function WorkoutSummaryPage() {
  return (
    <Suspense fallback={<div className="px-5 pt-10 text-fg/40">Loading…</div>}>
      <SummaryInner />
    </Suspense>
  )
}
