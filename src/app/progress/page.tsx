'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { Unit } from '@/types'
import { useStore } from '@/store/useStore'
import {
  computeWeeklyStreak,
  workoutVolume,
  regionBalance,
  effectiveLoad,
  defaultBodyweight,
} from '@/lib/stats'
import { fmtDuration, estimate1RM, fmtNum } from '@/lib/format'
import { isBodyweightExercise } from '@/lib/weights'
import { getExercise } from '@/data/exercises'
import { Button } from '@/components/ui/Button'
import { ChartIcon, TrophyIcon, TargetIcon, PlayIcon } from '@/components/icons'

const DAY = 1000 * 60 * 60 * 24
type Region = 'push' | 'pull' | 'legs' | 'core'
const REGIONS: Region[] = ['push', 'pull', 'legs', 'core']
const REGION_LABEL: Record<Region, string> = {
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  core: 'Core',
}
// Charge/Blaze muscle-balance palette (token-referenced): push orange, pull sky, legs lime, core amber
const REGION_COLOR: Record<Region, string> = {
  push: 'rgb(var(--color-accent))',
  pull: 'rgb(var(--color-pull))',
  legs: 'rgb(var(--color-recovery-fresh))',
  core: 'rgb(var(--color-core))',
}

export default function ProgressPage() {
  const router = useRouter()
  const workouts = useStore((s) => s.workouts)
  const unit = useStore((s) => s.profile.unit)
  const profileBodyweight = useStore((s) => s.profile.bodyweight)

  const now = Date.now()
  const bodyweight = profileBodyweight && profileBodyweight > 0 ? profileBodyweight : defaultBodyweight(unit)

  const completed = useMemo(() => workouts.filter((w) => w.status === 'completed'), [workouts])

  // ---- top-line stats (all-time) ----
  const totalVolume = useMemo(
    () => completed.reduce((acc, w) => acc + workoutVolume(w, w.bodyweight ?? bodyweight), 0),
    [completed, bodyweight],
  )
  const avgDuration = useMemo(() => {
    const durations = completed
      .map((w) => w.durationMin)
      .filter((d): d is number => typeof d === 'number' && d > 0)
    if (durations.length === 0) return null
    return durations.reduce((a, b) => a + b, 0) / durations.length
  }, [completed])
  const streak = useMemo(
    () => computeWeeklyStreak(completed.map((w) => w.completedAt ?? w.date), now),
    [completed, now],
  )

  // ---- volume trend (last 12, oldest left) ----
  const trend = useMemo(() => {
    const sorted = [...completed].sort((a, b) => (a.completedAt ?? a.date) - (b.completedAt ?? b.date))
    return sorted.slice(-12).map((w) => ({
      v: workoutVolume(w, w.bodyweight ?? bodyweight),
      ts: w.completedAt ?? w.date,
    }))
  }, [completed, bodyweight])

  // ---- muscle balance (last ~14 days) ----
  const balance = useMemo(() => {
    const counts = regionBalance(completed, now - 14 * DAY)
    const total = REGIONS.reduce((a, r) => a + counts[r], 0)
    return { counts, total }
  }, [completed, now])

  // ---- personal records (best est-1RM per lift) ----
  const records = useMemo(() => {
    const best = new Map<string, number>()
    for (const w of completed) {
      for (const we of w.exercises) {
        for (const s of we.sets) {
          if (!s.done || s.warmup || !s.reps) continue
          const load = effectiveLoad(we.exerciseId, s.weight, w.bodyweight ?? bodyweight)
          const orm = estimate1RM(load, s.reps)
          if (orm <= 0) continue
          const prev = best.get(we.exerciseId) ?? 0
          if (orm > prev) best.set(we.exerciseId, orm)
        }
      }
    }
    return Array.from(best.entries())
      .map(([id, orm]) => {
        const ex = getExercise(id)
        return { id, orm, name: ex?.name ?? id, bw: ex ? isBodyweightExercise(ex) : false }
      })
      .sort((a, b) => b.orm - a.orm)
      .slice(0, 6)
  }, [completed, bodyweight])
  const anyBwRecord = records.some((r) => r.bw)

  return (
    <div className="px-5 animate-fade-in">
      <header className="safe-top pt-5 pb-3">
        <h1 className="font-display text-3xl font-black uppercase tracking-[-0.02em] leading-[0.95]">Progress</h1>
        <p className="text-fg/50 text-[13px] mt-1.5">Your training, measured over time.</p>
      </header>

      {completed.length === 0 ? (
        <FirstRunZeroState onStart={() => router.push('/')} />
      ) : (
        <>
          {/* ---- stat cards ---- */}
          <div className="grid grid-cols-2 gap-2.5 mt-1">
            <StatCard label="Total Workouts" value={String(completed.length)} />
            <StatCard label="Total Volume" value={fmtNum(totalVolume)} unit={unit} />
            <StatCard label="Weekly Streak" value={String(streak)} unit={streak === 1 ? 'week' : 'weeks'} accent />
            <StatCard label="Avg Duration" value={avgDuration === null ? '—' : fmtDuration(avgDuration)} />
          </div>

          {/* ---- volume trend ---- */}
          <section className="card p-4 mt-3.5">
            <h2 className="text-lg font-bold">Volume trend</h2>
            <p className="text-fg/45 text-sm -mt-0.5 mb-3">Working volume per session</p>
            {trend.length < 2 ? (
              <EmptyState
                icon={<ChartIcon size={22} />}
                text="Log a couple of workouts and your volume trend will show up here."
              />
            ) : (
              <VolumeChart data={trend} unit={unit} />
            )}
          </section>

          {/* ---- muscle balance ---- */}
          <section className="card p-4 mt-3.5">
            <h2 className="text-lg font-bold">Muscle balance</h2>
            <p className="text-fg/45 text-sm -mt-0.5 mb-3">Working sets by region · last 14 days</p>
            {balance.total === 0 ? (
              <EmptyState
                icon={<TargetIcon size={22} />}
                text="No recent sets yet — train this week to see your push / pull / legs balance."
              />
            ) : (
              <div className="space-y-2.5">
                {REGIONS.map((r) => {
                  const c = balance.counts[r]
                  const pct = balance.total ? (c / balance.total) * 100 : 0
                  return (
                    <div key={r}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="font-medium">{REGION_LABEL[r]}</span>
                        <span className="text-fg/45 tabular-nums">
                          {c} {c === 1 ? 'set' : 'sets'} · {Math.round(pct)}%
                        </span>
                      </div>
                      <div className="h-2.5 rounded-full bg-raised overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${Math.max(pct, 2)}%`, background: REGION_COLOR[r] }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* ---- personal records ---- */}
          <section className="card p-4 mt-3.5 mb-2">
            <div className="flex items-center gap-2">
              <TrophyIcon size={18} className="text-blaze-label" />
              <h2 className="text-lg font-bold">Personal records</h2>
            </div>
            <p className="text-fg/45 text-sm -mt-0.5 mb-3">
              Best estimated 1-rep max per lift{anyBwRecord ? ' · BW includes bodyweight load' : ''}
            </p>
            {records.length === 0 ? (
              <EmptyState
                icon={<TrophyIcon size={22} />}
                text="Log some weighted sets to start tracking your PRs."
              />
            ) : (
              <ol className="space-y-1.5">
                {records.map((r, i) => (
                  <li key={r.id} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
                    <span
                      className={`grid place-items-center h-6 w-6 rounded-full text-xs font-extrabold shrink-0 tabular-nums ${
                        i === 0 ? 'bg-blaze/[0.18] text-blaze-label' : 'bg-raised text-fg/70'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="flex-1 min-w-0 flex items-center gap-1.5">
                      <span className="truncate text-[15px] font-medium">{r.name}</span>
                      {r.bw && (
                        <span
                          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide bg-sky-400/15 text-sky-300 border border-sky-400/25"
                          title="Estimate includes bodyweight load"
                        >
                          BW
                        </span>
                      )}
                    </span>
                    <span className="text-blaze-warm font-black tabular-nums shrink-0">
                      {fmtNum(r.orm)} <span className="text-fg/40 text-xs font-medium">{unit}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  unit,
  accent,
}: {
  label: string
  value: string
  unit?: string
  accent?: boolean
}) {
  return (
    <div className="rounded-[18px] border border-hairline/[0.07] bg-card p-3.5">
      <div className="text-[11px] text-fg/45">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className={`font-display text-[26px] font-black tabular-nums leading-none ${accent ? 'text-blaze-warm' : 'text-fg'}`}>
          {value}
        </span>
        {unit && <span className="text-fg/40 text-[13px] font-medium">{unit}</span>}
      </div>
    </div>
  )
}

function FirstRunZeroState({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-4 mt-16 px-4 animate-fade-in">
      <div className="grid place-items-center h-16 w-16 rounded-2xl bg-blaze/[0.12] text-blaze-warm">
        <ChartIcon size={30} />
      </div>
      <div>
        <h2 className="text-xl font-extrabold">No workouts yet</h2>
        <p className="text-fg/55 text-[15px] mt-1.5 max-w-xs leading-snug">
          Finish your first session and this page fills with your volume trend, muscle balance, and
          personal records.
        </p>
      </div>
      <Button onClick={onStart} className="mt-1">
        <PlayIcon size={18} /> Start your first workout
      </Button>
    </div>
  )
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 py-6">
      <div className="grid place-items-center h-11 w-11 rounded-full bg-raised text-fg/40">{icon}</div>
      <p className="text-sm text-fg/50 max-w-[16rem]">{text}</p>
    </div>
  )
}

function VolumeChart({ data, unit }: { data: { v: number; ts: number }[]; unit: Unit }) {
  const W = 320
  const H = 140
  const padBottom = 18
  const padTop = 8
  const gap = 6
  const n = data.length
  const max = Math.max(...data.map((d) => d.v), 1)
  const barW = (W - gap * (n - 1)) / n
  const chartH = H - padBottom - padTop
  const peak = Math.max(...data.map((d) => d.v), 0)
  const first = data[0]
  const last = data[n - 1]

  const chartLabel = `Working volume per session — last ${n} workout${n === 1 ? '' : 's'} from ${labelDate(
    first.ts,
  )} to ${labelDate(last.ts)}, peaking at ${fmtNum(peak)} ${unit}`

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={chartLabel}>
        <line x1={0} y1={H - padBottom} x2={W} y2={H - padBottom} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
        {data.map((d, i) => {
          const h = max > 0 ? (d.v / max) * chartH : 0
          const x = i * (barW + gap)
          const y = H - padBottom - h
          const isPeak = d.v === peak && d.v > 0
          return (
            <g key={i}>
              <title>{`${labelDate(d.ts)}: ${fmtNum(d.v)} ${unit}${isPeak ? ' · peak' : ''}`}</title>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(h, 2)}
                rx={Math.min(barW / 2, 3)}
                fill={isPeak ? 'rgb(var(--color-accent-warm))' : 'rgb(var(--color-accent) / 0.3)'}
              />
            </g>
          )
        })}
      </svg>
      <div className="flex items-center justify-between text-[11px] text-fg/40 mt-1">
        <span>{labelDate(first.ts)}</span>
        <span className="text-blaze-label font-semibold">
          peak {fmtNum(peak)} {unit}
        </span>
        <span>{labelDate(last.ts)}</span>
      </div>
    </div>
  )
}

function labelDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
