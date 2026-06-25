import { create } from 'zustand'
import { supabase } from './supabase'
import { PLANS, mergeCatalogue, setRuntimePlans, type WorkoutPlan } from '../data/plans'

/**
 * The live plan catalogue: the bundled defaults, overlaid by any DB-managed plans (table public.plans).
 * Kept in its own tiny store (not the big app store) so DB plans are reactive in the UI without touching
 * user state. Offline-first: until/unless a remote fetch succeeds, the catalogue is exactly the bundled
 * set, so the app is fully usable offline and every existing flow/test is unchanged.
 */
interface PlansState {
  catalogue: WorkoutPlan[]
  /** true once a remote fetch has resolved (success, empty, or failure) */
  loaded: boolean
  setRemote: (remote: WorkoutPlan[]) => void
}

export const usePlansStore = create<PlansState>((set) => ({
  catalogue: PLANS,
  loaded: false,
  setRemote: (remote) => {
    const merged = mergeCatalogue(remote)
    setRuntimePlans(merged) // keep getPlan()/resolvePlan() (generator + session) DB-aware too
    set({ catalogue: merged, loaded: true })
  },
}))

/** Light validation so a single malformed DB row can never crash the catalogue. */
function sanitizeRemotePlan(raw: unknown): WorkoutPlan | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Partial<WorkoutPlan>
  if (typeof p.id !== 'string' || !p.id) return null
  if (typeof p.name !== 'string' || !p.name) return null
  if (!Array.isArray(p.schedule) || p.schedule.length === 0) return null
  // a DB plan belongs to the built-in catalogue, never a user "custom" plan
  return { ...(p as WorkoutPlan), custom: false }
}

/**
 * Fetch DB-managed plans (public-read). Null-safe + resilient: returns [] when cloud is unconfigured,
 * offline, or the query errors — the caller then keeps the bundled catalogue.
 */
export async function fetchRemotePlans(): Promise<WorkoutPlan[]> {
  if (!supabase) return []
  try {
    const { data, error } = await supabase.from('plans').select('data').eq('active', true).order('sort')
    if (error || !data) return []
    return data
      .map((row) => sanitizeRemotePlan((row as { data: unknown }).data))
      .filter((p): p is WorkoutPlan => p !== null)
  } catch {
    return []
  }
}

/** Load DB plans into the catalogue store. Safe to call once on app start; degrades to bundled-only. */
export async function loadRemotePlans(): Promise<void> {
  const remote = await fetchRemotePlans()
  if (remote.length > 0) usePlansStore.getState().setRemote(remote)
  else usePlansStore.setState({ loaded: true })
}
