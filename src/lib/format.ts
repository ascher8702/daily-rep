import type { Exercise, Unit } from '../types'

export function uid(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

const LEG_MUSCLES = ['quads', 'hamstrings', 'glutes', 'calves']

/** "per leg" / "per arm" for a unilateral lift (reps are per side), else null. */
export function perSideLabel(ex: Exercise | undefined): string | null {
  if (!ex?.unilateral) return null
  return ex.primary.some((m) => LEG_MUSCLES.includes(m)) ? 'per leg' : 'per arm'
}

const LB_PER_KG = 2.20462

/** Convert a stored weight between units, rounding to a sensible gym increment. */
export function convertWeight(weight: number, from: Unit, to: Unit): number {
  if (from === to || !weight) return weight
  const lbs = from === 'kg' ? weight * LB_PER_KG : weight
  const out = to === 'kg' ? lbs / LB_PER_KG : lbs
  const step = to === 'kg' ? 0.5 : 1
  return Math.round(out / step) * step
}

export function fmtWeight(weight: number, unit: Unit): string {
  if (!weight) return '—'
  const rounded = Math.round(weight * 10) / 10
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded} ${unit}`
}

export function fmtDate(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export function fmtRelative(ts: number, now: number): string {
  const diff = now - ts
  const day = 1000 * 60 * 60 * 24
  const days = Math.floor(diff / day)
  if (days <= 0) {
    const hrs = Math.floor(diff / (1000 * 60 * 60))
    if (hrs <= 0) return 'Just now'
    if (hrs === 1) return '1 hour ago'
    return `${hrs} hours ago`
  }
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  const weeks = Math.floor(days / 7)
  if (weeks === 1) return '1 week ago'
  if (weeks < 5) return `${weeks} weeks ago`
  return fmtDate(ts)
}

export function fmtDuration(min: number): string {
  if (min < 60) return `${Math.round(min)} min`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m ? `${h}h ${m}m` : `${h}h`
}

export function fmtClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = Math.floor(totalSeconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** estimated 1-rep max via Epley formula */
export function estimate1RM(weight: number, reps: number): number {
  if (!weight || !reps) return 0
  if (reps === 1) return weight
  return Math.round(weight * (1 + reps / 30))
}

/** Whole number with thousands separators, e.g. 15830 → "15,830". */
export function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}
