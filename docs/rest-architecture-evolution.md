# REST architecture evolution — Daily Rep

> Planning doc, 2026-06-28. Question: "how do we improve our architecture toward a RESTful API,
> with the workout generator staying client-side?" Produced from a grounded multi-agent audit +
> adversarial critic. **Read the sequencing note first — the honest answer is "narrow, and probably
> after iOS."**

## Headline

Two things are already true and shouldn't change:

1. **You already have a RESTful API — it's Supabase, not the web app.** PostgREST auto-exposes Postgres
   over REST, plus your Edge Functions, all behind JWT + RLS. `supabase-swift` and `supabase-js` consume
   it natively. **Do not add a Next.js API layer** — the web app is a pure client SPA/PWA with no routes
   today; adding a server you'd have to host/secure/keep-in-sync with iOS's direct-PostgREST path buys
   nothing.
2. **The generator stays client-side** (web TS / iOS JavaScriptCore), reading **full in-memory
   `workouts[]`** — it's small (tens-to-low-hundreds of KB even at 100+ sessions). Don't build a windowed
   history cache; it solves a non-problem at current scale.

The architecture has exactly **one** real weakness worth fixing: the whole-blob last-write-wins sync
(`sync.ts` upserts the entire partialized store as one `data` JSONB, replace-not-merge) **silently
clobbers concurrent cross-device edits**. Of the 9 synced keys, 8 are single-owner / low-stakes
(you don't edit your profile or run two live sessions on two phones at once). The **only** append-mostly,
unbounded, cross-device-colliding key is `workouts[]`.

## Sequencing (the most important finding)

**The data-loss bug needs a second concurrently-editing client to manifest — and that client (iOS)
doesn't exist yet.** So:

- **Ship iOS against the existing blob first.** It already round-trips the blob; the fix is not a
  prerequisite.
- **Do the `workouts`-table fix when concurrent two-device editing actually loses data** (or fold it into
  the iOS data-layer work, since iOS is precisely what makes it bite). Building a normalized write path
  *before* the second client exists is speculative.
- This whole effort should rank **below the iOS launch** unless you can name a current, single-client
  data-loss incident.

## The fix (minimal version — recommended)

Promote completed workouts out of the blob into one REST resource. Skip the ceremony.

**Schema — `public.workouts`:**
- `id` PK = the existing client-minted `Workout.id` (it's the idempotency key — replayed inserts upsert
  the same row as a no-op)
- `user_id uuid default auth.uid()` (RLS scope)
- `data jsonb` — the whole Workout (exercises/sets/durationMin/bodyweight/performed_on/tzOffsetMin/status).
  **Start coarse: one JSONB-per-workout row already gives full per-row isolation.** Add a `workout_sets`
  child table only if you later need server-side set-grain queries (`analytics_session_sets` already
  exists if so).
- `client_updated_at timestamptz` + a **per-row BEFORE-UPDATE monotonic guard** cloned from
  `daily_rep_guard_monotonic`
- `deleted_at timestamptz` — tombstone (workouts are NOT truly immutable; see below)
- `schema_version int`

**Access:** pure PostgREST, no new endpoints — `GET/POST/PATCH /rest/v1/workouts` with
`Prefer: resolution=merge-duplicates` for idempotent upsert. RLS `user_id = auth.uid()`, INSERT/UPDATE
additionally gated by `is_active_subscriber()` (verbatim, same predicate the blob uses).

**Offline writes — a tiny insert-outbox, not a general mutation queue:** on `finishWorkout`, enqueue
`{id, data, client_updated_at}`; a flush loop drains it when online. Idempotency is free (client id);
two devices finishing different sessions → different ids → both land, nothing to merge. Persist the
outbox across restarts (localStorage web / small file/SQLite queue iOS).

**Everything else stays the document blob** (`daily_rep_state`, unchanged): profile (+`avoiding[]`
inline), `current`, and the five plan keys, synced with today's `nextClock` LWW. **Accept the LWW
trade-off there as documented** — don't build per-key clocks or detect-and-warn until it actually loses
data.

**The one fiddly seam — promote it to a first-class deliverable:** `setUnit` (`useStore.ts:806`) rewrites
the weight of *every set in every completed workout* in place. With workouts as rows that's an N-row
rewrite → build a `convert_workout_units(from, to)` SECURITY DEFINER RPC doing one atomic bulk UPDATE.
Without it, the very first thing a user does (toggle kg/lb) desyncs server rows from local.

**Rollout (merge the phases):** add the table + RLS + guard + RPC → **idempotent** one-time backfill from
`data->'workouts'` (or `analytics_sessions`) with a parity check → in the **same release**, client writes
rows via the outbox AND stops carrying `workouts[]` in the partialized blob; hydrate the in-memory
`Workout[]` from rows (reusing `mergePersisted`'s coercion/repair). Because inserts can't conflict, the
multi-release dual-write soak the conservative plan proposes is over-insurance.

## Explicitly NOT doing (critic's cuts)

- **No Phase-0 "adopt the analytics projection as a read model."** The client computes every stat locally
  from in-memory `workouts[]` — instantly, offline. Switching reads to the eventually-consistent (~1 min
  drain), lossy server projection is a UX downgrade plus a permanent byte-parity tax against `stats.ts`.
- **No windowed local history cache.** Keep full history in memory; it's tiny.
- **No managed sync engine (PowerSync/Electric/Zero) and no full normalization with two hand-rolled
  outboxes.** Both are wrong-sized for a one-entity problem owned by a solo dev. (Zero/WatermelonDB can't
  even serve native SwiftUI.)

## Architecture options scored (5 = best)

| Option | offline | concurrency | REST | migration(5=easy) | iOS simple | ops(5=simple) | web PWA |
|---|---|---|---|---|---|---|---|
| **Hybrid strangler (workouts only)** ✅ | 5 | 4 | 4 | 4 | 4 | 4 | 5 |
| PostgREST full normalize + outboxes | 4 | 5 | 5 | 2 | 3 | 4 | 3 |
| Managed local-first (PowerSync/Electric) | 5 | 4 | 2 | 2 | 3 | 2 | 3 |

## How this helps iOS

Strictly *less* distributed-systems surface to get wrong on the second platform: the big, complex,
append-only key (`workouts`) leaves the opaque blob and becomes typed PostgREST rows iOS models cleanly
with Codable — shrinking the scariest iOS risk (Swift Codable silently dropping unmodeled blob keys on
re-push). iOS gets workouts CRUD for free over the same JWT/RLS/`is_active_subscriber()`, feeds the same
in-memory `Workout[]` to the JSContext engine, and keeps a small insert-outbox. **Caveat:** "free CRUD"
is true for *transport* — `mergePersisted`'s healing (enum coercion, numeric clamps, malformed-row
repair, DISPLAY-UNIT weights, never re-writing legacy `injuries/avoidMuscles`) is NOT free and must be
reproduced at row-rehydration on both clients; Swift Codable throws/drops rather than heals.

## Gotchas

- Workouts are **not** immutable: `setUnit` (806), `setWorkoutNote` (1635), `deleteWorkout` (1650) all
  mutate finished workouts → need the bulk-convert RPC, a mutable note (LWW), and delete-as-tombstone
  (so a re-push from another device's cache can't resurrect a deleted workout).
- Keep `finishWorkout`'s single atomic local `set()` (current+workouts+activePlan+planProgress). The
  row-upsert and doc push are independent idempotent **background** syncs — never make the local finish
  block on either landing.
- Backfill must be **idempotent** (re-running is a no-op); keep the blob authoritative until cutover so
  rollback is "read from blob again."
- Preserve the strictly-increasing clock per row (`nextClock = max(prev+1, now)`) or you re-introduce the
  historical "device can't sync its own latest forward" bug.
- If you keep `reconcile_user`/`analytics_*` after cutover, re-point it at the `workouts` table; the SQL
  math must stay byte-parity with `stats.ts`/`format.ts` (`analytics-facts.test.ts` guards this).
