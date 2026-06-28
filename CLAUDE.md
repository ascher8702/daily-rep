# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Daily Rep** — a mobile-first, personalized strength-training PWA inspired by Fitbod. It generates each
workout around a per-muscle recovery model, logs sets with an auto rest timer, and tracks progress.
Offline-first with local persistence; optional Supabase cloud sync + auth, and a paid subscription
(Stripe) behind a 30-day card-free trial.

## Commands

Package manager is **pnpm** (`packageManager` is pinned; Node ≥ 20). Some deps come from a private
CodeArtifact registry whose token frequently 401s — add **public** deps with `pnpm add <pkg> --registry https://registry.npmjs.org`.

```bash
pnpm dev            # next dev → http://localhost:3000
pnpm build          # next build (production)
pnpm start          # serve a production build
pnpm lint           # next lint (eslint). NOT run during `build` (ignoreDuringBuilds)
pnpm typecheck      # tsc --noEmit — the real type gate; run this, not build, to check types
pnpm test           # vitest run (all src/__tests__/*.test.ts)
pnpm test:watch     # vitest watch
pnpm check:legal    # fail if legal pages still contain [placeholder]/TODO(legal) tokens
```

Run a **single test**: `pnpm exec vitest run src/__tests__/progression.test.ts` (or `-t "<name>"` to
filter by test name). There is no `vitest.config` — tests run in vitest's default **node** environment;
they do **not** use jsdom, so DOM-touching tests hand-mock the small surface they need (see
`a11y.test.ts`). Keep new tests node-friendly or mock the DOM explicitly.

Vercel build command is `pnpm check:legal && pnpm build` (see [vercel.json](vercel.json)).

## Big-picture architecture

Next.js 14 **App Router** + TypeScript (strict) + Tailwind + **antd v6** (Ant Design components, via
`@ant-design/nextjs-registry`). State is **Zustand** with `persist`. No chart/icon libs beyond
`lucide-react` (icons re-exported through `@/components/icons`); the body heatmap and charts are
hand-rolled inline SVG. Import alias `@/* → src/*`.

### The gate (`src/app/AppShell.tsx`)
Every non-public route renders through a single client-side gate, evaluated in this order: hydration +
auth bootstrap → password-recovery → **sign-in** (Supabase) → checkout-return passthrough → **entitlement**
(active subscription or live trial, else Paywall) → onboarding → one-time trial-welcome → the app with
chrome (bottom nav + global rest-timer bar). `PUBLIC_ROUTES` (privacy/terms/reset-password) bypass it.
A build with **no Supabase env** falls back to open `localOnly` mode (dev convenience only) — production
builds **fail fast** at startup if Supabase env is missing (`src/lib/supabase.ts`).

### Flagship: the generation pipeline (must stay bug-free)
The personalization core is `recovery → generator → progression`, and weight progression has been
critically broken before — treat changes here with extra care and tests.
- `src/lib/recovery.ts` — each completed working set deposits **fatigue** on its muscles (primary full,
  secondary partial, scaled by reps/RPE); fatigue **decays** on a per-muscle half-life. Freshness = 100 − fatigue.
- `src/lib/generator.ts` — scores muscles by freshness (+ user focus), picks targets, greedily selects
  exercises that fit equipment/experience/time, prescribes sets/reps/rest by goal.
- `src/lib/progression.ts` — evidence-based double-progression: experience/body/type-scaled load
  increments, plate snapping, stall→deload. Living spec: `docs/research-progressive-overload.md`
  (historical audit: `docs/archived/progression-audit-2026-06-23.md`).

### Domain model & store
`src/types.ts` is the domain model. `src/store/useStore.ts` is the main store (profile, history
`workouts[]`, the planned/active `current` session, rest timer, structured plans). Data lives:
`src/data/exercises.ts` (~50-exercise library), `muscles.ts` (metadata), `plans.ts` (built-in programs),
`rehab.ts` (therapeutic exercises).

Key conventions, all non-obvious and load-bearing:
- **Weights are stored in the user's display unit**, not a canonical unit. Switching unit converts +
  rounds all history in place (deliberate trade-off, not a bug).
- **`mergePersisted`** (exported, heavily tested) defensively hydrates persisted/cloud blobs over
  defaults — coerces enums back in range, clamps numerics, and repairs/drops malformed workouts rather
  than crashing the app. Touch hydration → update/add tests here.
- **Injuries & muscle avoidance** are unified into one `Profile.avoiding: Avoidance[]` list (kind
  `'injury'` with severity+rehab, or `'preference'`). Legacy `injuries[]`/`avoidMuscles[]`/`avoidInPlans`
  are migrated on hydrate and never written again. Logic in `src/lib/injuries.ts` + `data/rehab.ts`.
- **Structured plans** build "hybrid": keep a plan day's explicit lifts, equipment-substitute what the
  user can't equip, drive load through `prescribe()`. User customizations are stored as overlays that
  **never mutate the shared plan definition** — `planOverrides` (per-day "replace in my plan" swaps) and
  `planDayEdits` (per-day add/remove going forward). `instanceId`/`planSlot` keep repeated lifts distinct.

### Cloud sync (`src/lib/sync.ts`)
Offline-first, last-write-wins. localStorage (`daily-rep-v1`) is the instant source of truth; this layer
reconciles it with the user's `daily_rep_state` JSONB row in Supabase: pull-or-push on sign-in, debounced
push on local change, re-pull on tab focus. Uses a **strictly-increasing logical clock** (`nextClock`)
that must never move backward, paired with a server-side monotonic-write guard — otherwise a device can't
sync its own latest data forward. RLS denials (`42501`, e.g. a lapsed user) are terminal: no retry, no
error report.

### Auth & billing
- `src/store/useAuth.ts` + `src/store/authBootstrap.ts` — Supabase Auth. The bootstrap's race semantics
  (an `onAuthStateChange` event is authoritative over a slow `getSession()`) are extracted for unit
  testing; don't reintroduce the cross-account-mix race it guards against.
- `src/store/useEntitlement.ts` + `src/lib/billing.ts` — subscription/trial state from the read-only
  per-user `subscriptions` row. Paid product: $7.99/mo · $59.99/yr after a 30-day card-free trial. The
  **browser never loads Stripe.js**; checkout/portal are Stripe-hosted redirects created by Edge
  Functions. Real write-enforcement is server-side via RLS (`is_active_subscriber()`); the client gate is
  UX only. See the injuries/billing memory notes and `docs/STRIPE_SETUP.md`.

### Supabase backend (`supabase/`)
Schema is **schema-as-code** under `supabase/migrations/` — apply with `supabase db push`, replay with
`supabase db reset`; do **not** apply ad-hoc DDL via the dashboard (see `supabase/migrations/README.md`).
Edge Functions in `supabase/functions/` with per-function JWT gating version-controlled in
`config.toml`: `stripe-webhook` and `reconcile-subscriptions` are public (verified by signature / shared
secret), the rest require a JWT. All Stripe secrets live in Edge Function secrets, never in this repo.

## Conventions & guardrails

- **Coding standards** — follow [docs/coding-standards.md](docs/coding-standards.md) (think before
  coding, simplicity first, surgical changes, goal-driven execution).
- **UX bar is high and convention-grounded** — match Strong/Hevy/Fitbod patterns; set edits cascade to
  following sets. There's a current design system ("Blaze") — build screens to match the mockups rather
  than inventing or retaining elements not in the design.
- Error tracking is Sentry (prod only, opt-in via DSN), routed through a `reportError`/`reportEvent` seam
  in `src/lib/telemetry.ts` — use it rather than calling Sentry directly. CSP/security headers are set in
  `next.config.mjs` (prod only).
- `docs/` holds the real specs and runbooks (deploy, backup/restore, dedicated-project provisioning,
  research notes, the analytics spec). Check there before reworking progression, plans, or analytics.
