import { create } from 'zustand'
import type { Exercise } from '../types'
import {
  EXERCISES,
  REHAB_EXERCISES,
  mergeExerciseCatalogue,
  setRuntimeExercises,
} from '../data/exercises'
import { createRemoteConfig, type RemoteConfigHandle } from './remoteConfig'
import { parseCachedExercises, parseExerciseRows } from './exerciseSchema'

/**
 * The live exercise catalogue: the bundled library + rehab catalogue, overlaid by any DB-managed
 * exercises (table public.exercises), with the latest DB catalogue CACHED locally (IndexedDB via
 * idbStorage) so it survives reload and goes offline. Built on the reusable remote-config layer
 * (lib/remoteConfig) — the same fetch→validate→merge→cache pattern as plans — see docs/remote-config.md.
 *
 * Precedence: DB catalogue (cache → live) > bundled seed. Bundled is always the merge baseline, so the
 * app is fully usable offline and every existing flow/test is unchanged. The merge `Value` is a
 * `{ pool, rehab }` pair (not a plain array): a DB row with category:'rehab' routes to the rehab pool
 * (and never into the generator), exactly like the bundled EXERCISES/REHAB split.
 */

/** The exercises resource on the reusable layer. Exported so tests can build a handle with fakes. */
export const exercisesRemoteConfig: RemoteConfigHandle<
  Exercise,
  { pool: Exercise[]; rehab: Exercise[] }
> = createRemoteConfig(
  {
    key: 'exercises',
    table: 'exercises',
    select: 'data',
    activeColumn: 'active',
    orderColumn: 'sort',
    // each row is `{ data: <Exercise> }`; pull the `data` column out, then validate the batch.
    parseRows: (rows) => parseExerciseRows(rows.map((r) => (r as { data: unknown }).data)),
    merge: (items) => mergeExerciseCatalogue(items),
    seed: { pool: EXERCISES, rehab: REHAB_EXERCISES },
    parseCache: parseCachedExercises,
  },
  // defaults: client = supabase, storage = idbStorage
)

interface ExercisesState {
  /** the live generator/library pool (bundled, overlaid by DB once loaded); never includes rehab */
  pool: Exercise[]
  /** the live rehab pool (bundled, overlaid by DB once loaded) */
  rehab: Exercise[]
  /** true once a hydrate+refresh cycle has resolved (success, empty, or failure) */
  loaded: boolean
  /** source of the current catalogue, for debugging/telemetry: bundled until cache/remote applies */
  source: 'bundled' | 'cache' | 'remote'
  setCatalogue: (
    merged: { pool: Exercise[]; rehab: Exercise[] },
    source: 'cache' | 'remote',
  ) => void
}

export const useExercisesStore = create<ExercisesState>((set) => ({
  pool: EXERCISES,
  rehab: REHAB_EXERCISES,
  loaded: false,
  source: 'bundled',
  setCatalogue: (merged, source) => {
    setRuntimeExercises(merged) // keep getExercise()/the pools (generator + session + library) DB-aware
    set({ pool: merged.pool, rehab: merged.rehab, loaded: true, source })
  },
}))

/**
 * Back-compat: a live fetch+validate of the DB exercises (no cache read/write involved). Kept for
 * callers/tests that want just the remote rows; delegates to the layer's refresh(). Returns [] when
 * cloud is unconfigured, offline, the query errors, or the DB is empty — the caller then keeps the
 * bundled catalogue, exactly as before.
 */
export async function fetchRemoteExercises(): Promise<Exercise[]> {
  const res = await exercisesRemoteConfig.refresh()
  if (res.status !== 'applied') return []
  // res.value is the MERGED { pool, rehab }; recover just the remote-overlaid exercises (those that
  // differ from / extend the bundled set) so the return shape matches the old "remote rows" contract.
  const bundledById = new Map([...EXERCISES, ...REHAB_EXERCISES].map((e) => [e.id, e]))
  return [...res.value.pool, ...res.value.rehab].filter((e) => bundledById.get(e.id) !== e)
}

/**
 * Load DB exercises into the catalogue: hydrate from the local cache FIRST (so the last DB catalogue is
 * shown offline/instantly), then background-refresh from the DB and overwrite cache+store when newer
 * rows arrive. Called by AppShell BEFORE loadRemotePlans() so plan referential validation (which
 * resolves exercise ids via getExercise) sees any DB-only exercise. Degrades to bundled; NEVER throws.
 */
export async function loadRemoteExercises(): Promise<void> {
  // 1. cache-first paint: if we have a valid cached catalogue, overlay it immediately.
  const { value, fromCache } = await exercisesRemoteConfig.hydrateFromCache()
  if (fromCache) useExercisesStore.getState().setCatalogue(value, 'cache')

  // 2. background refresh from the DB.
  const res = await exercisesRemoteConfig.refresh()
  if (res.status === 'applied') {
    // newest DB catalogue replaces cache-or-bundled (and the cache is now updated by refresh()).
    useExercisesStore.getState().setCatalogue(res.value, 'remote')
  } else {
    // empty / unavailable: keep whatever is currently shown (cache or bundled); just flip `loaded`.
    if (!useExercisesStore.getState().loaded) useExercisesStore.setState({ loaded: true })
  }
}
