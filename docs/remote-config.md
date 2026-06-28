# Remote config — DB-managed bundled settings

A small, resource-agnostic layer (`src/lib/remoteConfig.ts`) for backing a **bundled** config resource
with a **DB-managed** overlay that is **cached locally** so it survives reload and works offline. The
consumers today are the **plan catalogue** (`src/lib/plansRemote.ts`) and the **exercise + rehab
catalogue** (`src/lib/exercisesRemote.ts`); equipment and other bundled settings can adopt the same
pattern without re-implementing the fetch/cache plumbing.

## The contract

`createRemoteConfig(resource, deps?)` returns a handle with two methods, neither of which ever throws:

- **`hydrateFromCache()`** — read + re-validate the locally cached items and merge them over the seed.
  Returns `{ value, fromCache }`. On a miss/corruption/empty cache it returns the bundled `seed` with
  `fromCache:false`. Use this for the **first paint** so the last DB catalogue shows instantly/offline.
- **`refresh()`** — fetch live rows from the table, validate (dropping bad rows), merge, and — on a
  successful **non-empty** fetch — overwrite the cache. Returns a `RefreshResult`:
  - `applied` — ≥1 valid row; `value` is the merged catalogue, cache updated.
  - `empty` — query ok but 0 valid rows; `value` is the seed (`merge([])`); **cache left intact**.
  - `unavailable` — no client / offline / query error; `value` is the seed; **cache left intact**.

The cache is written under `daily-rep-remote-config:<key>` in the shared `idbStorage` (IndexedDB →
localStorage → in-memory), independent of the main app blob (`daily-rep-v1`). It is wrapped in a
versioned envelope (`{ v, key, updatedAt, items }`); a mismatched `v`/`key`, non-JSON, or a payload that
fails re-validation is treated as **no cache** (→ seed), so a schema change can't ship a stale shape.

### Resolution precedence (preserved)

`user-custom > DB catalogue (cache → live) > bundled seed`. The bundled `seed` is always the merge
baseline, so the app is fully usable offline and degrades to bundled-only. The cache is **retained**
across an `empty`/`unavailable` refresh — a successful non-empty fetch is the only thing that overwrites
it — so the last-known DB catalogue is kept offline rather than reverting to the thinner bundled set.

### Why the cache is re-validated on read

The cache is **untrusted**: it may have been written by an older app whose schema (or whose bundled
exercise catalogue) has since changed. `parseCache` re-runs the **full** validation — including
referential integrity — on every read, so a stale entry that now references a removed exercise id is
dropped, exactly as a bad DB row would be.

## The plans wiring (reference implementation)

`src/lib/plansRemote.ts` defines the `plans` resource and exposes the same public surface as before —
`usePlansStore` (`catalogue`, `loaded`), `loadRemotePlans()` (called once by `AppShell`), and
`fetchRemotePlans()` — so callers (`plans/page.tsx`, `Onboarding.tsx`, `AppShell.tsx`) are untouched.

`loadRemotePlans()`:

1. `hydrateFromCache()` → if `fromCache`, paint the cached catalogue immediately (`source:'cache'`).
2. `refresh()` → on `applied`, replace with the live catalogue (`source:'remote'`, cache updated);
   on `empty`/`unavailable`, keep what's shown and just flip `loaded`.

Validation lives in `src/lib/planSchema.ts` (`validatePlanRow` / `parsePlanRows` / `parseCachedPlans`):
the hardened successor to the old thin `sanitizeRemotePlan`. It validates the full `WorkoutPlan` shape
**and** referential integrity (every `PlanLift.exerciseId` must resolve via `getExercise`, which covers
rehab ids), rejecting a whole plan on a structural / referential / enum violation while **clamping**
recoverable numeric noise (set/rep counts). A typed reject `reason` is returned so telemetry can record
*why* a row dropped (via the `onReject` hook on `parsePlanRows`).

## The exercises wiring (second consumer)

`src/lib/exercisesRemote.ts` defines the `exercises` resource and exposes `useExercisesStore`
(`pool`, `rehab`, `loaded`, `source`), `loadRemoteExercises()`, and `fetchRemoteExercises()`. It backs
the bundled exercise library (`src/data/exercises.ts → EXERCISES`) **and** the therapeutic/rehab
catalogue (`src/data/rehab.ts → REHAB_EXERCISES`) from one public-read `public.exercises` table: a row
whose `data.category` is `'rehab'` routes to the rehab pool, everything else to the generator/library
pool — the same split as the bundled arrays.

Two things make it differ from plans:

- **The merge `Value` is a `{ pool, rehab }` pair**, not a plain array (this is why the layer keeps
  `Item`/`Value` separate). Validation lives in `src/lib/exerciseSchema.ts`
  (`validateExerciseRow` / `parseExerciseRows` / `parseCachedExercises`): it rejects (never clamps) a
  structural / referential / enum violation — an unknown `category`, `equipment`, or muscle, a bad
  `difficulty`/`instructions` — while dropping a malformed descriptive optional. A rehab exercise may
  have an empty `primary` (the bundled `rehab-strain-*` entries do); a non-rehab one may not.
- **The overlay drives the iteration pool, not just a by-id lookup.** Plans are only ever read by id
  (`getPlan`), but exercises are *iterated* by the generator, substitution, the library, and the
  add-exercise picker. So `src/data/exercises.ts` exposes runtime pool accessors —
  `getExercisePool()` (never includes rehab) and `getRehabPool()` — plus a DB-aware `getExercise(id)`,
  all backed by runtime registries that `setRuntimeExercises` overlays. The exported `EXERCISES` /
  `REHAB_EXERCISES` arrays stay the **immutable** bundled arrays (an analytics test pins their length);
  only the iterating consumers switch to `getExercisePool()`. The library/picker subscribe to
  `useExercisesStore.source` so a late DB apply repaints.

**Load order:** `AppShell` calls `loadRemoteExercises()` **before** `loadRemotePlans()`, because
`validatePlanRow` enforces referential integrity through `getExercise`. A plan that references a
DB-only exercise id must see that exercise already in the runtime registry, or it would be wrongly
dropped as `unknown-exercise`. Both loaders are independent of mount data and never throw, so awaiting
them in series is safe.

## To add a resource (e.g. equipment)

No change to `remoteConfig.ts` is needed — define a new `RemoteConfigResource` and a tiny store:

1. **Validator** — a `parseRows(rows) → { items, dropped }` and a `parseCache(raw) → Item[] | null`
   (model on `planSchema.ts`; reject on structural/referential violations, clamp recoverable noise).
2. **Resource descriptor** —
   ```ts
   const equipmentRemote = createRemoteConfig({
     key: 'equipment',            // cache key → daily-rep-remote-config:equipment
     table: 'equipment',          // a public-read table mirroring public.plans
     select: 'data',
     activeColumn: 'active',
     orderColumn: 'sort',
     parseRows,
     merge: (items) => mergeEquipment(items),  // your override-by-id-over-seed merge
     seed: BUNDLED_EQUIPMENT,
     parseCache,
   })
   ```
3. **Store + load** — a small zustand store with `setCatalogue`, and a `loadRemoteEquipment()` that does
   `hydrateFromCache()` then `refresh()` exactly like `loadRemotePlans()`; call it once on app start.
4. **Seed script** — model on `scripts/seed-plans.ts` (validate the bundled set, then `--emit-sql` an
   idempotent `insert … on conflict do update`, or push with a service-role client).

The DB table only needs `(id text PK, data jsonb, sort int, active bool)` + public-read RLS — the same
shape as `public.plans`, so no new column design is required for the common "add / override / disable /
order" overlay.

## Seeding `public.plans`

`scripts/seed-plans.ts` compiles the bundled `PLANS` into rows, **validating each through `planSchema`
first** (a dangling exercise id or bad enum fails the script loud — a CI guard for the catalogue):

```
# emit an idempotent seed migration (preferred — schema-as-code)
node --experimental-strip-types scripts/seed-plans.ts --emit-sql

# or push directly with a service-role client
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node --experimental-strip-types scripts/seed-plans.ts
```

`--emit-sql` is deterministic: re-running on the same catalogue produces identical SQL. The table
already exists (see the baseline migration), so seeding is the only step. The app ships the bundled seed
regardless, so committing the generated migration is optional.

## Seeding `public.exercises`

`scripts/seed-exercises.ts` is the exercise analogue: it unions the bundled `EXERCISES` +
`REHAB_EXERCISES`, **validating each through `exerciseSchema` first** (an unknown muscle / equipment /
category, or a bad difficulty / instructions, fails the script loud — a CI guard for the catalogue):

```
# emit an idempotent seed migration (preferred — schema-as-code)
node --experimental-strip-types scripts/seed-exercises.ts --emit-sql

# or push directly with a service-role client
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node --experimental-strip-types scripts/seed-exercises.ts
```

The `public.exercises` table (mirroring `public.plans`) ships in its own migration
(`*_create_exercises_table.sql`). The app ships the bundled catalogues regardless, so committing the
generated seed migration is optional — an empty table simply means "bundled only".
