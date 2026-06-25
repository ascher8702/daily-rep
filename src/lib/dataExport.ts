import type { Profile, Workout, ActivePlan } from '@/types'
import type { WorkoutPlan } from '@/data/plans'

/** A portable snapshot of everything the app holds about a user — the GDPR/CCPA "right to
 *  portability" payload. Pure + serializable so it can be unit-tested and downloaded as JSON. */
export interface UserDataExport {
  app: 'Daily Rep'
  schemaVersion: number
  exportedAt: string
  account: string | null
  profile: Profile
  workouts: Workout[]
  customPlans: WorkoutPlan[]
  activePlan: ActivePlan | null
  planProgress: Record<string, number>
}

export function buildUserDataExport(args: {
  profile: Profile
  workouts: Workout[]
  customPlans: WorkoutPlan[]
  activePlan: ActivePlan | null
  planProgress: Record<string, number>
  email: string | null
  when: string
}): UserDataExport {
  return {
    app: 'Daily Rep',
    schemaVersion: 1,
    exportedAt: args.when,
    account: args.email,
    profile: args.profile,
    workouts: args.workouts,
    customPlans: args.customPlans,
    activePlan: args.activePlan,
    planProgress: args.planProgress,
  }
}

/** Trigger a client-side JSON file download (browser only; no-op without a DOM). */
export function downloadJson(filename: string, data: unknown): void {
  if (typeof document === 'undefined') return
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
