'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Unit, Workout } from '@/types'
import { useStore } from '@/store/useStore'
import { useConfirm } from '@/components/ConfirmProvider'
import { useNow } from '@/lib/useNow'
import { getExercise } from '@/data/exercises'
import { muscleLabel } from '@/data/muscles'
import { fmtRelative, fmtDuration, fmtWeight, estimate1RM } from '@/lib/format'
import { effectiveLoad, defaultBodyweight } from '@/lib/stats'
import { isBodyweightExercise } from '@/lib/weights'
import {
  DumbbellIcon,
  TimerIcon,
  FlameIcon,
  TrashIcon,
  ChevronRight,
  PlayIcon,
  RefreshIcon,
  SearchIcon,
  XIcon,
  TrophyIcon,
  NoteIcon,
} from '@/components/icons'
import Sheet from '@/components/Sheet'
import SessionCalendar from '@/components/SessionCalendar'
import SessionNote from '@/components/SessionNote'
import { Button } from '@/components/ui/Button'
import { ChipTag } from '@/components/ui/Chip'

// ---- per-workout stat derivation -------------------------------------------

interface WorkoutStats {
  workingSets: number
  volume: number
}

function workoutStats(w: Workout, bodyweight: number): WorkoutStats {
  let workingSets = 0
  let volume = 0
  for (const we of w.exercises) {
    for (const s of we.sets) {
      if (s.done && !s.warmup) {
        workingSets += 1
        volume += effectiveLoad(we.exerciseId, s.weight, bodyweight) * s.reps
      }
    }
  }
  return { workingSets, volume }
}

function workoutTime(w: Workout): number {
  return w.completedAt ?? w.date
}

/** The session's standout set: the done working set with the highest estimated 1RM (bodyweight
 *  exercises credited via effectiveLoad). Surfaced as a per-workout headline metric. */
function topSet(w: Workout, bodyweight: number, unit: Unit): { name: string; label: string; orm: number } | null {
  let bestOrm = 0
  let best: { exerciseId: string; weight: number; reps: number } | null = null
  for (const we of w.exercises) {
    for (const s of we.sets) {
      if (!s.done || s.warmup || !s.reps) continue
      const orm = estimate1RM(effectiveLoad(we.exerciseId, s.weight, bodyweight), s.reps)
      if (orm > bestOrm) {
        bestOrm = orm
        best = { exerciseId: we.exerciseId, weight: s.weight, reps: s.reps }
      }
    }
  }
  if (!best || bestOrm <= 0) return null
  const ex = getExercise(best.exerciseId)
  const isBw = ex ? isBodyweightExercise(ex) : false
  const label =
    best.weight > 0 ? `${fmtWeight(best.weight, unit)} × ${best.reps}` : isBw ? `BW × ${best.reps}` : `${best.reps} reps`
  return { name: ex?.name ?? best.exerciseId, label, orm: Math.round(bestOrm) }
}

// ---- relative-date grouping ------------------------------------------------

type Bucket = 'Today' | 'Yesterday' | 'This Week' | 'Earlier'
const BUCKET_ORDER: Bucket[] = ['Today', 'Yesterday', 'This Week', 'Earlier']

function bucketFor(ts: number, now: number): Bucket {
  const startOfDay = (t: number) => {
    const d = new Date(t)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  const day = 1000 * 60 * 60 * 24
  // round, not floor: across a DST spring-forward the gap between two local midnights is 23h,
  // and 23/24 floors to 0 (mis-bucketing "Yesterday" as "Today"); the delta is always k·24h∓1h
  const daysAgo = Math.round((startOfDay(now) - startOfDay(ts)) / day)
  if (daysAgo <= 0) return 'Today'
  if (daysAgo === 1) return 'Yesterday'
  if (daysAgo < 7) return 'This Week'
  return 'Earlier'
}

// ---- small presentational helpers ------------------------------------------

function StatPill({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-fg/60 tabular-nums">
      <span className="text-fg/40">{icon}</span>
      {children}
    </span>
  )
}

function fmtVolume(volume: number, unit: Unit): string {
  const rounded = Math.round(volume)
  return `${rounded.toLocaleString()} ${unit}`
}

// ---- workout card ----------------------------------------------------------

function WorkoutCard({
  workout,
  now,
  unit,
  bodyweight,
  onOpen,
}: {
  workout: Workout
  now: number
  unit: Unit
  bodyweight: number
  onOpen: () => void
}) {
  const effBodyweight = workout.bodyweight ?? bodyweight
  const { workingSets, volume } = workoutStats(workout, effBodyweight)
  const top = topSet(workout, effBodyweight, unit)
  const allFocus = workout.focus ?? []
  const focus = allFocus.slice(0, 3)
  const extra = allFocus.length - focus.length

  return (
    <button
      onClick={onOpen}
      className="card w-full text-left p-4 transition active:scale-[0.99]"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-extrabold uppercase truncate">{workout.title}</div>
          <div className="text-[12.5px] text-fg/45 mt-0.5">
            {fmtRelative(workoutTime(workout), now)}
          </div>
        </div>
        <ChevronRight size={18} className="text-fg/30 mt-0.5 shrink-0" />
      </div>

      {/* headline metric — the session's best estimated 1-rep max */}
      {top && (
        <div className="mt-2.5 flex items-center gap-1.5 text-xs">
          <TrophyIcon size={13} className="text-blaze-label shrink-0" />
          <span className="font-medium truncate">{top.name}</span>
          <span className="text-fg/30 shrink-0">·</span>
          <span className="text-fg/55 tabular-nums shrink-0">{top.label}</span>
          <span className="text-fg/30 shrink-0">·</span>
          <span className="text-blaze-label tabular-nums shrink-0">~{top.orm} {unit} 1RM</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3">
        {workout.durationMin != null && (
          <StatPill icon={<TimerIcon size={14} />}>
            {fmtDuration(workout.durationMin)}
          </StatPill>
        )}
        <StatPill icon={<DumbbellIcon size={14} />}>
          {workingSets} {workingSets === 1 ? 'set' : 'sets'}
        </StatPill>
        {volume > 0 && (
          <StatPill icon={<FlameIcon size={14} />}>{fmtVolume(volume, unit)}</StatPill>
        )}
      </div>

      {focus.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {focus.map((m) => (
            <ChipTag key={m} variant="neutral">
              {muscleLabel(m)}
            </ChipTag>
          ))}
          {extra > 0 && <ChipTag variant="neutral">+{extra}</ChipTag>}
        </div>
      )}

      {/* note preview — scan history for how sessions felt without opening each */}
      {workout.note && (
        <div className="flex items-start gap-1.5 mt-3 text-xs text-fg/45">
          <NoteIcon size={12} className="shrink-0 mt-0.5 text-fg/30" />
          <span className="line-clamp-2 leading-snug">{workout.note}</span>
        </div>
      )}
    </button>
  )
}

// ---- detail sheet ----------------------------------------------------------

function WorkoutDetail({
  workout,
  now,
  unit,
  bodyweight,
  onClose,
  onDelete,
}: {
  workout: Workout
  now: number
  unit: Unit
  bodyweight: number
  onClose: () => void
  onDelete: () => void
}) {
  const confirm = useConfirm()
  const router = useRouter()
  const repeatWorkout = useStore((s) => s.repeatWorkout)
  const setWorkoutNote = useStore((s) => s.setWorkoutNote)
  const current = useStore((s) => s.current)
  const { workingSets, volume } = workoutStats(workout, workout.bodyweight ?? bodyweight)

  const onRepeat = async () => {
    const currentHasLogged =
      !!current &&
      (current.status === 'active' || current.exercises.some((we) => we.sets.some((s) => s.done)))
    if (
      currentHasLogged &&
      !(await confirm({
        title: 'Replace current workout?',
        body: 'Repeating this session replaces your in-progress workout. Logged sets will be lost.',
        confirmLabel: 'Replace',
        tone: 'danger',
      }))
    )
      return
    repeatWorkout(workout.id)
    onClose()
    router.push('/session')
  }

  return (
    <div className="pt-1">
      <div className="text-sm text-fg/45">{fmtRelative(workoutTime(workout), now)}</div>

      <div className="grid grid-cols-3 gap-2 mt-4">
        {workout.durationMin != null && (
          <div className="card p-3 text-center">
            <div className="text-lg font-bold tabular-nums">
              {fmtDuration(workout.durationMin)}
            </div>
            <div className="text-xs text-fg/40 mt-0.5">Duration</div>
          </div>
        )}
        <div className="card p-3 text-center">
          <div className="text-lg font-bold tabular-nums">{workingSets}</div>
          <div className="text-xs text-fg/40 mt-0.5">Working sets</div>
        </div>
        {volume > 0 && (
          <div className="card p-3 text-center">
            <div className="text-lg font-bold tabular-nums">{fmtVolume(volume, unit)}</div>
            <div className="text-xs text-fg/40 mt-0.5">Volume</div>
          </div>
        )}
      </div>

      {/* session note — add/edit a reflection on how it went */}
      <div className="mt-4">
        <div className="text-xs font-bold uppercase tracking-wide text-fg/40 mb-1.5">Notes</div>
        <SessionNote
          key={workout.id}
          value={workout.note ?? ''}
          onSave={(v) => setWorkoutNote(workout.id, v)}
          placeholder="How did this session feel? Energy, sleep, aches…"
        />
      </div>

      <div className="mt-5 space-y-3">
        {workout.exercises.map((we, i) => {
          const ex = getExercise(we.exerciseId)
          // any bodyweight movement logs no external load — show "BW" instead of "—"
          const isBodyweight = !!ex && isBodyweightExercise(ex)
          return (
            <div key={`${we.exerciseId}-${i}`} className="card p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold">{ex?.name ?? 'Unknown exercise'}</div>
                {we.rpe != null && (
                  <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-blaze-label bg-blaze/[0.12] border border-blaze/30 tabular-nums">
                    RPE {we.rpe}
                  </span>
                )}
              </div>
              <div className="mt-2.5 space-y-1.5">
                {we.sets.map((s, si) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between text-sm tabular-nums"
                  >
                    <span className="text-fg/35 w-6 shrink-0">{si + 1}</span>
                    <span className="flex-1 text-fg/80">
                      {isBodyweight
                        ? s.weight > 0
                          ? `BW + ${fmtWeight(s.weight, unit)}`
                          : 'BW'
                        : fmtWeight(s.weight, unit)}{' '}
                      × {s.reps}
                    </span>
                    {s.warmup && (
                      <ChipTag variant="neutral" className="text-fg/45">
                        Warmup
                      </ChipTag>
                    )}
                  </div>
                ))}
                {we.sets.length === 0 && (
                  <div className="text-sm text-fg/35">No sets logged</div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <Button onClick={onRepeat} fullWidth className="mt-5">
        <RefreshIcon size={18} /> Repeat workout
      </Button>
      <button
        onClick={async () => {
          if (
            await confirm({
              title: 'Delete workout?',
              body: 'This removes the session from your history. You can undo it right after.',
              confirmLabel: 'Delete',
              tone: 'danger',
            })
          ) {
            onDelete()
            onClose()
          }
        }}
        className="w-full mt-2 py-2.5 text-sm text-fg/45 active:text-red-400 inline-flex items-center justify-center gap-2 transition"
      >
        <TrashIcon size={16} /> Delete workout
      </button>
    </div>
  )
}

// ---- empty state -----------------------------------------------------------

function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <div className="px-5 mt-16 flex flex-col items-center text-center animate-fade-in">
      <div className="grid place-items-center h-16 w-16 rounded-2xl bg-card border border-hairline/10 text-blaze-warm">
        <DumbbellIcon size={30} />
      </div>
      <h2 className="text-xl font-bold mt-5">No workouts yet</h2>
      <p className="text-fg/50 mt-2 text-[15px] max-w-[18rem]">
        Finish your first session and it'll show up here with your sets, volume and trends.
      </p>
      <Button onClick={onStart} className="mt-7">
        <PlayIcon size={16} /> Start a workout
      </Button>
    </div>
  )
}

// ---- screen ----------------------------------------------------------------

export default function HistoryPage() {
  const router = useRouter()
  const workouts = useStore((s) => s.workouts)
  const unit = useStore((s) => s.profile.unit)
  const profileBodyweight = useStore((s) => s.profile.bodyweight)
  const bodyweight = profileBodyweight && profileBodyweight > 0 ? profileBodyweight : defaultBodyweight(unit)
  const deleteWorkout = useStore((s) => s.deleteWorkout)
  const daysPerWeek = useStore((s) => s.profile.daysPerWeek)
  const weeklyTarget = Math.max(1, daysPerWeek ?? 3)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'list' | 'calendar'>('list')
  // refresh once a minute so "Today"/"Yesterday" buckets and relative times stay live
  const now = useNow(60_000)

  const sorted = useMemo(
    () => [...workouts].sort((a, b) => workoutTime(b) - workoutTime(a)),
    [workouts],
  )

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return sorted
    // match the session title + its (resolved) exercise names
    return sorted.filter((w) => {
      const hay = (w.title + ' ' + w.exercises.map((e) => getExercise(e.exerciseId)?.name ?? '').join(' ')).toLowerCase()
      return hay.includes(q)
    })
  }, [sorted, q])

  const groups = useMemo(() => {
    const map = new Map<Bucket, Workout[]>()
    for (const w of filtered) {
      const b = bucketFor(workoutTime(w), now)
      const list = map.get(b) ?? []
      list.push(w)
      map.set(b, list)
    }
    return BUCKET_ORDER.map((b) => ({ bucket: b, items: map.get(b) ?? [] })).filter(
      (g) => g.items.length > 0,
    )
  }, [filtered, now])

  const selected = selectedId
    ? workouts.find((w) => w.id === selectedId) ?? null
    : null

  return (
    <div className="animate-fade-in">
      <header className="px-5 pt-5 safe-top">
        <h1 className="font-display text-3xl font-black uppercase tracking-[-0.02em] leading-[0.95]">History</h1>
        <p className="text-fg/45 mt-1.5 text-[13px]">
          {workouts.length === 0
            ? 'Your completed sessions'
            : `${workouts.length} workout${workouts.length === 1 ? '' : 's'} logged`}
        </p>
      </header>

      {workouts.length === 0 ? (
        <EmptyState onStart={() => router.push('/')} />
      ) : (
        <div className="px-5 mt-5 space-y-5">
          {/* List / Calendar toggle (roundtable verdict: a 2nd lens on History, not a new nav tab) */}
          <div
            className="grid grid-cols-2 gap-1 p-1 rounded-[13px] bg-card border border-hairline/[0.08]"
            role="tablist"
            aria-label="History view"
          >
            {(['list', 'calendar'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                role="tab"
                aria-selected={view === v}
                className={`py-2 rounded-[9px] text-sm font-bold transition ${
                  view === v ? 'bg-gradient-blaze text-on-accent' : 'text-fg/55 active:text-fg/80'
                }`}
              >
                {v === 'list' ? 'List' : 'Calendar'}
              </button>
            ))}
          </div>

          {view === 'calendar' ? (
            <SessionCalendar
              workouts={workouts}
              weeklyTarget={weeklyTarget}
              unit={unit}
              bodyweight={bodyweight}
              now={now}
              onOpenWorkout={(id) => setSelectedId(id)}
            />
          ) : (
            <div className="space-y-6">
          {/* Search */}
          <div className="relative">
            <SearchIcon size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg/35 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search workouts or exercises…"
              aria-label="Search workouts"
              className="w-full rounded-[13px] bg-card border border-hairline/[0.08] pl-10 pr-9 py-2.5 text-[15px] outline-none focus:border-blaze placeholder:text-fg/35"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 grid place-items-center h-7 w-7 rounded-full text-fg/40 active:text-fg/70"
              >
                <XIcon size={15} />
              </button>
            )}
          </div>

          {groups.length === 0 ? (
            <p className="text-sm text-fg/45 py-4 text-center">
              No workouts match “{query.trim()}”.
            </p>
          ) : (
            groups.map((g) => (
            <section key={g.bucket}>
              <div className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-fg/35 mb-2.5">
                {g.bucket}
              </div>
              <div className="space-y-3">
                {g.items.map((w) => (
                  <WorkoutCard
                    key={w.id}
                    workout={w}
                    now={now}
                    unit={unit}
                    bodyweight={bodyweight}
                    onOpen={() => setSelectedId(w.id)}
                  />
                ))}
              </div>
            </section>
            ))
          )}
            </div>
          )}
        </div>
      )}

      <Sheet
        open={selected !== null}
        onClose={() => setSelectedId(null)}
        title={selected?.title}
      >
        {selected && (
          <WorkoutDetail
            workout={selected}
            now={now}
            unit={unit}
            bodyweight={bodyweight}
            onClose={() => setSelectedId(null)}
            onDelete={() => deleteWorkout(selected.id)}
          />
        )}
      </Sheet>
    </div>
  )
}
