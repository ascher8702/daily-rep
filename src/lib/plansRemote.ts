import { create } from 'zustand'
import { PLANS, mergeCatalogue, setRuntimePlans, type WorkoutPlan } from '../data/plans'
import { createRemoteConfig, type RemoteConfigHandle } from './remoteConfig'
import { parseCachedPlans, parsePlanRows } from './planSchema'

/**
 * The live plan catalogue: the bundled defaults, overlaid by any DB-managed plans (table public.plans),
 * with the latest DB catalogue CACHED locally (IndexedDB via idbStorage) so it survives reload and goes
 * offline. Built on the reusable remote-config layer (lib/remoteConfig) so equipment and other bundled
 * settings can adopt the same fetch→validate→merge→cache pattern next — see docs/remote-config.md.
 *
 * Precedence (unchanged): user-custom plans (resolvePlan, in the main store) > DB catalogue (cache →
 * live) > bundled seed. Bundled is always the merge baseline, so the app is fully usable offline and
 * every existing flow/test is unchanged.
 */

/** The plans resource on the reusable layer. Exported so tests can build a handle with fakes. */
export const plansRemoteConfig: RemoteConfigHandle<WorkoutPlan, WorkoutPlan[]> = createRemoteConfig(
  {
    key: 'plans',
    table: 'plans',
    select: 'data',
    activeColumn: 'active',
    orderColumn: 'sort',
    // each row is `{ data: <WorkoutPlan> }`; pull the `data` column out, then validate the batch.
    parseRows: (rows) => parsePlanRows(rows.map((r) => (r as { data: unknown }).data)),
    merge: (items) => mergeCatalogue(items),
    seed: PLANS,
    parseCache: parseCachedPlans,
  },
  // defaults: client = supabase, storage = idbStorage
)

interface PlansState {
  catalogue: WorkoutPlan[]
  /** true once a hydrate+refresh cycle has resolved (success, empty, or failure) */
  loaded: boolean
  /** source of the current catalogue, for debugging/telemetry: bundled until cache/remote applies */
  source: 'bundled' | 'cache' | 'remote'
  setCatalogue: (catalogue: WorkoutPlan[], source: 'cache' | 'remote') => void
}

export const usePlansStore = create<PlansState>((set) => ({
  catalogue: PLANS,
  loaded: false,
  source: 'bundled',
  setCatalogue: (catalogue, source) => {
    setRuntimePlans(catalogue) // keep getPlan()/resolvePlan() (generator + session) DB-aware too
    set({ catalogue, loaded: true, source })
  },
}))

/**
 * Back-compat: a live fetch+validate of the DB plans (no cache read/write involved). Kept for callers
 * and tests that want just the remote rows; delegates to the layer's refresh(). Returns [] when cloud
 * is unconfigured, offline, the query errors, or the DB is empty — the caller then keeps the bundled
 * catalogue, exactly as before.
 */
export async function fetchRemotePlans(): Promise<WorkoutPlan[]> {
  const res = await plansRemoteConfig.refresh()
  if (res.status !== 'applied') return []
  // res.value is the MERGED catalogue; recover just the remote-overlaid plans (those that differ from /
  // extend the bundled set) so the return shape matches the old "remote rows" contract.
  const bundledById = new Map(PLANS.map((p) => [p.id, p]))
  return res.value.filter((p) => bundledById.get(p.id) !== p)
}

/**
 * Load DB plans into the catalogue: hydrate from the local cache FIRST (so the last DB catalogue is
 * shown offline/instantly), then background-refresh from the DB and overwrite cache+store when newer
 * rows arrive. Safe to call once on app start; degrades to bundled-only and NEVER throws.
 */
export async function loadRemotePlans(): Promise<void> {
  // 1. cache-first paint: if we have a valid cached catalogue, show it immediately.
  const { value, fromCache } = await plansRemoteConfig.hydrateFromCache()
  if (fromCache) usePlansStore.getState().setCatalogue(value, 'cache')

  // 2. background refresh from the DB.
  const res = await plansRemoteConfig.refresh()
  if (res.status === 'applied') {
    // newest DB catalogue replaces cache-or-bundled (and the cache is now updated by refresh()).
    usePlansStore.getState().setCatalogue(res.value, 'remote')
  } else {
    // empty / unavailable: keep whatever is currently shown (cache or bundled); just flip `loaded`.
    if (!usePlansStore.getState().loaded) usePlansStore.setState({ loaded: true })
  }
}
