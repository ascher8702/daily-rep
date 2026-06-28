# iOS (native SwiftUI) build plan — Daily Rep

> Planning doc, 2026-06-28. Architecture **decided**: native SwiftUI app mirroring the web PWA.
> Apple account: **Individual**. Produced from a grounded multi-agent audit of this repo.

## TL;DR decisions

- **Engine: run the existing compiled core JS on-device via JavaScriptCore (JSContext).** Do **not**
  reimplement `recovery`/`generator`/`progression` in Swift for v1. SwiftUI is a native UI over the
  same JS engine that runs on web → zero algorithm drift, full offline, ~2–4 days to stand up the
  bridge vs 4–7 weeks for a trustworthy Swift port.
- **One engine, conformance-tested.** Capture golden `{input,output}` JSON vectors from the vitest
  suite; replay them through the JSContext bridge in XCTest. The vectors guard the **marshalling seam +
  bundle freshness** (under JSC the algorithm can't diverge).
- **State: one `@Observable AppStore`** mirroring the Zustand store's 9 partialize keys as a single
  Codable blob — do NOT shred into SwiftData. Persist the blob to a file in Application Support; tokens
  in Keychain (supabase-swift default).
- **Backend unchanged** (supabase-swift). The sync contract (monotonic `nextClock`, whole-blob LWW,
  display-unit weights, `mergePersisted` coercion) must be honored exactly or sync corrupts.
- **Billing: RevenueCat (StoreKit 2)**, `appUserID = auth.uid`; generalize `deriveEntitlement` +
  `is_active_subscriber()` to "Stripe OR StoreKit OR live trial"; Small Business Program (15%).
- **Sign in with Apple is mandatory** (Guideline 4.8) because Google OAuth already ships.

## The core-logic decision (why JavaScriptCore)

Scores (5 = best; engineRisk 5 = lowest risk of divergence):

| Strategy | engineRisk | offline | uxPurity | effort | maint | driftVsWeb |
|---|---|---|---|---|---|---|
| **JavaScriptCore (B)** ✅ | 5 | 5 | 4 | 4 | 3 | 5 |
| Full Swift reimpl (A) | 2 | 5 | 5 | 2 | 2 | 2 |
| Edge Function (C) | 5 | **1** | 3 | 3 | 4 | 5 |

- `progression.ts` was critically broken once and fixed 2026-06-23. A from-scratch Swift port re-opens
  exactly that risk, and the **existing vitest suite is too loose to catch a numerically-different-but-
  spec-valid port** (mostly `toBeGreaterThan`/ordering, not exact values).
- Confirmed divergence hazards a Swift port would hit: `generator.ts:223/294` use `Math.sin(...)` as a
  pseudo-RNG seeded by `ALL_MUSCLES = Object.keys(MUSCLES)` index order; `hashString` does
  `h=(h*31+c)%1000` (per-step modulo — a Swift port deferring it traps on Int overflow). JSContext
  neutralizes all of this (same JS, negligible IEEE-754 deltas).
- Offline-first is non-negotiable: `generate/prescribe/computeRecovery/scaffold` fire synchronously in
  the gym with no signal → rules out the Edge Function path for the request path (it's a CI oracle only).
- The 12 lib files are clean: grep for `react/next/window/document/localStorage/process/fetch` across
  them hit only one comment line (`recovery.ts:68`). No polyfills needed.

**When to prefer Swift port (A):** only post-launch, if JS bundle size / warmup is a real problem (it
won't be). Then migrate module-by-module behind the conformance vectors, easiest first
(`equipment.ts` 17 LOC → `supersets` → `substitution` → `injuries`), leaving `generator`/`progression`/
`weights`/`stats` on JS longest. **Never start with `generator.ts`.**

## Things to decide / accept BEFORE writing Swift (critic's P0)

1. **Scope freeze.** 55 commits landed in the last 30 days; web will move faster than you build (4–7
   months solo, new-to-Swift). Pin "iOS v1 = web as of commit X" and write an explicit **omit-list**
   (what v1 deliberately doesn't ship). This is the single most important missing decision.
2. **Honest timeline.** The bridge is ~10% of the work; the **view layer is ~80%** — ~26 screens + the
   Blaze design system + Canvas heatmap + 109 store actions + auth deep-linking + sync port + StoreKit +
   review cycles ≈ **4–7 months**, first month mostly learning SwiftUI/Xcode.
3. **`mergePersisted` extraction.** It runs on every hydrate AND cloud-adopt and is subtle (enum
   coercion, numeric clamps, workout repair/drop, legacy-injury migration). It lives in `useStore.ts:679`
   tangled with store internals and is **NOT** in the engine entrypoint set. Confirm it can be cleanly
   lifted into the IIFE (then run hydration through JSContext too) — else you must Swift-port it.
4. **Swift Charts for series charts, Canvas only for the heatmap.** Don't hand-roll what's free —
   e1RM/volume/tonnage lines via Swift Charts (iOS 16+); Canvas/Path only for the anatomical body
   heatmap and maybe the calendar.
5. **App Store compliance up front, not later:** native in-app account-deletion screen (backend
   `delete-account` exists), App Privacy nutrition labels (health-adjacent data), HealthKit yes/no
   decision, StoreKit sandbox test plan.

## App architecture

- **Store:** one `@Observable final class AppStore` (iOS 17+ Observation) exposing the same intent
  methods as the ~109 Zustand actions over a single blob. `AuthViewModel` (replaces `useAuth`),
  `EntitlementViewModel` (replaces `useEntitlement`).
- **Gate:** mirror `AppShell.tsx` order exactly as a `switch` on a root `@Observable`: hydration+auth
  bootstrap → password-recovery → sign-in → checkout-return → entitlement (active sub OR live trial else
  Paywall) → onboarding → trial-welcome → app. Reproduce the `authBootstrap.ts:55-91` race guard
  (`onAuthStateChange` authoritative over a slow `getSession`) or the cross-account data-mix returns.
- **Navigation:** `TabView` (Home, History, Progress, Plans [, Library]), each a `NavigationStack(path:)`;
  session / plan-builder / settings subpages are full-screen pushes; gated screens are root-level
  `fullScreenCover` outside the TabView.
- **Engine bridge:** a `JSEngine` **actor** owning ONE long-lived `JSContext` loaded with the IIFE at
  launch (keep it warm; never per-call). `JSContext` is not thread-safe — funnel every call through the
  actor. Wrap `evaluateScript` with exception capture and a try/catch→JSON error envelope *inside* the
  IIFE so failures cross as structured data, not silent `nil`.
- **Persistence:** two files in Application Support, written atomically: the bare 9-key partialized blob
  (no `{state,version}` envelope — keeps the sync push trivial) + a `{clientUpdatedAt}` clock. Session
  in Keychain.

## Apple Watch companion (in scope — the reason we chose native Swift)

The Watch app is the product justification for native Swift over React Native (log sets at the rack +
rest timer on the wrist; essentially Swift-only). Keep it a **thin companion**, sequenced as a
**fast-follow after the iPhone app — not v1**.

- **The Watch does NOT run the engine.** Generation/progression/recovery stay on the phone (JSContext).
  The Watch consumes the already-generated active `current` session and writes back logged sets. This
  dodges running JS on a constrained device and keeps the Watch lean.
- **Phone ↔ Watch sync via `WatchConnectivity`** (`WCSession`): the phone pushes the active session +
  rest-timer state to the Watch; the Watch sends logged sets back. The phone remains the only Supabase
  writer (the Watch is a peer of the phone's local store, not a direct cloud client). This avoids a
  third writer to the sync blob.
- **Shared Swift code:** the `Model` SwiftPM module (Codable `Workout`/`LoggedSet`/active-session types)
  is consumed by BOTH the iOS app and the watchOS target — define it once.
- **HealthKit naturally enters scope:** an `HKWorkoutSession` on the Watch keeps the app alive during a
  lift and unlocks heart rate — strong for a gym app. Make HealthKit a deliberate yes (Watch) rather
  than the "v1 decides" footnote it was under the phone-only plan.
- **Complementary phone win:** a Live Activity / Dynamic Island rest timer on the iPhone pairs well with
  the Watch timer.
- **Scope honesty:** a Watch app + WatchConnectivity + an `HKWorkoutSession` is real additional surface
  on top of the 4–7 month iPhone build. Ship the iPhone app (engine + logging + sync) first; the Watch
  companion is its own milestone.

## Data model & sync contract (a second writer must honor)

- Model the blob as ONE Codable `AppState` with the EXACT 9 partialize keys (`useStore.ts:1709-1721`):
  `profile, workouts[], current, activePlan, customPlans[], planProgress, planOverrides, planDayEdits,
  avoidNoticeDismissedId`. Push as `daily_rep_state.data` raw (the envelope is stripped at
  `sync.ts:87`; the DB CHECK rejects non-objects).
- **Decode defensively** (mirror `mergePersisted`): optionals default, enums decode leniently (unknown →
  default, never throw), clamp on read (sessionLength 10–240/45, bodyweight 20–1000, restSeconds 5–900,
  daysPerWeek 1–7), repair/drop malformed workouts. A strict throwing Codable wipes state web tolerates.
- **Preserve unknown keys** — Swift Codable drops unmodeled keys, so a newer-web blob round-tripped
  through iOS silently deletes fields. Either raw `[String:JSONValue]` passthrough or route hydration
  through the JS `mergePersisted`.
- **Never write** `profile.injuries/avoidMuscles/avoidInPlans` (web strips them every hydrate,
  `useStore.ts:772-774`; re-emitting duplicates avoidance rows). Read/write only `profile.avoiding`.
- **Weights are in DISPLAY UNIT**, not canonical — on unit switch convert+round in place (1 lb / 0.5 kg)
  across all history incl. frozen per-workout bodyweight and `coaching.incWeight`.
- `finishWorkout`: keep only done sets, stamp `performed_on` (local YYYY-MM-DD) + `tzOffsetMin` (minutes
  BEHIND UTC) + bodyweight, or server analytics fall back to UTC bucketing. Mint unique `instanceId` +
  0-based `planSlot` per plan occurrence.
- iOS writes **only** `daily_rep_state`. Never `analytics_*` / `v_my_*` / `subscriptions` (read-only).

### Sync failure modes
- **Clock:** persist a strictly-increasing `clientUpdatedAt`, advance `max(prev+1, now)` (`sync.ts:79`),
  reset to any adopted cloud value. DB guard is `<=` (equal also rejected) → two edits in the same ms
  lose the second. A non-monotonic iOS clock silently reverts the lower-clock device's pushes.
- **Whole-blob LWW, no field merge** (`sync.ts:187`). iOS edits a workout offline in the gym while web
  edited the profile → higher clock wins, the other edit is silently lost. **Always pull-and-adopt
  before mutating when online.** Accept (as a product decision) that concurrent cross-device edits can
  lose data; ideally detect a stale base and warn.
- **42501 on push is EXPECTED** (entitlement RLS denial for a lapsed user) — terminal: no retry, no
  telemetry (`isTerminalPushError`, `sync.ts:109`).

## Billing

- RevenueCat (`appUserID = auth.uid`), Small Business Program (15%). Keep Stripe on web unchanged.
- Generalize TS `deriveEntitlement` (`billing.ts:69-116`) and SQL `is_active_subscriber()`
  (`baseline_schema.sql:927-958`) to OR-in an App Store branch. **Preserve the no-row FAIL-OPEN** on
  both sides (new user not locked out mid-provisioning). Add the cases to `entitlement-parity.test.ts`.
- Add Apple columns to `subscriptions` (`store`, `apple_original_transaction_id` unique, …) — keep the
  table client-read-only.
- Add a RevenueCat webhook Edge Function (`verify_jwt=false` + signature check, mirroring
  `stripe-webhook`) that upserts the same `subscriptions` row → the existing RLS write-gate just works.
- **Trial double-grant guard:** the 30-day trial is a DB-only `trial_ends_at` (Postgres trigger, no
  StoreKit object). The iOS paywall MUST suppress the StoreKit intro offer while `trial_ends_at` is in
  the future, and disclose the card-free trial as outside StoreKit, or Apple double-grants / rejects.
- **Sign in with Apple** via native `ASAuthorizationAppleIDProvider` +
  `supabase.auth.signInWithIdToken(provider:.apple)`.

## Conformance / golden-test strategy

- **Layer 0:** `pnpm test` is currently RED — `rateLimit.test.ts` fails to load (missing
  `_shared/rateLimit`, Edge infra, not engine). Fix/quarantine first or real regressions hide.
- **Layer 1 (load-bearing):** a vitest "vector capture" mode serializes `{input,output}` to
  `fixtures/conformance/*.json`, checked in. Capture **exact** vectors incl. the under-tested gaps:
  `computeRecovery` full fatigue map (today ZERO exact coverage — the biggest blind spot), `prescribe`
  full struct, generator's exact chosen list+order for a fixed seed, `weights` exact numbers,
  `warmupSets`, stats e1RM/streaks.
- **Layer 2:** an XCTest engine target replays the fixtures (+ a randomized corpus) through the
  JSContext bridge asserting byte-identical output, with **TimeZone + Locale pinned** (stats streaks use
  `getTimezoneOffset`; `planMatch.ts:102` uses `localeCompare`).
- **Bundle-staleness gate (the #1 ongoing JSC risk):** a CI step rebuilds the IIFE from web `lib/+data/`
  and fails if the iOS-vendored bundle differs — else iOS silently ships an old engine after a web fix.
  Cheap version: bundle-diff on a Linux runner; add macOS `xcodebuild test` only when affordable.

## Immediate steps (ordered)

1. **[blocking] Quarantine red test + capture golden vectors** — green `pnpm test`, then the vitest
   vector-capture mode → `fixtures/conformance/*.json`. (Work in THIS repo; do first.)
2. **[blocking] Build the engine IIFE bundle** — esbuild/Rollup the 12 pure lib files +
   `data/{exercises,muscles,plans,rehab}` (+ `mergePersisted`) into ONE IIFE exposing
   `generateWorkout/prescribe/computeRecovery/suggestedFocus/scaffoldPlan/summarizeWorkout`. Versioned
   artifact the iOS app vendors. Confirm `mergePersisted` extracts cleanly (decision #3 above).
3. **[blocking] Xcode project + SwiftPM layout** — Xcode 16, iOS 17 min. Modules: Engine, Model,
   Persistence, Sync, Networking (supabase-swift via SPM), DesignSystem, Features.
4. **[blocking] Engine bridge spike + conformance harness** — long-lived JSContext, round-trip a
   hardcoded profile+history through `generateWorkout`; XCTest replays fixtures with TimeZone/Locale
   pinned. Proves the marshalling seam before any UI.
5. **supabase-swift auth round-trip** — `signInWithPassword` + deep-link callback; reproduce the
   bootstrap race guard; verify pull + a monotonic push the server accepts; confirm 42501 is terminal.
   *Prereq:* register iOS deep-link redirect URLs in the Supabase allowlist.
6. **First device build** — free Individual provisioning installs to a physical iPhone. Validate
   JSContext warmup, file persistence, Keychain restore, `scenePhase` pull-on-foreground.

## First milestone

**"Generate + log + sync a workout, end-to-end on a real iPhone, byte-identical to web."** Signed-in
user hydrates their cloud blob, Home renders the recovery map + a generated session via JSContext that
matches web for the same inputs (proven by the green conformance target), logs sets, `finishWorkout`
writes a correctly-stamped workout to the file blob, sync pushes with a strictly-increasing clock the
server accepts — verified by reloading web and seeing the same workout. Proves the three highest-risk
seams (engine fidelity, Codable↔JSONB contract, sync clock) before any breadth of UI. Billing + the
full screen inventory come after.

## Enrollment / platform notes

- Apple Developer Program **Individual** ($99/yr) — publishes under your personal legal name; not
  convertible to org later (transfer the app to a new org account if you incorporate). Enroll early
  (identity verification can take days). Small Business Program is a separate, explicit enrollment.
- Add macOS CI later (cost); start with the Linux bundle-diff check.
