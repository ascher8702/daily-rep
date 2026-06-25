# FitForge — User Workflow Map

_Generated 2026-06-23 by a 7-agent functional audit (one agent per screen-area), maintained as flows change. Outstanding functional bugs are tracked in docs/loop-progress.md._

Status legend: **OK** works as expected · **BUG** confirmed functional defect (see bug list) · **MINOR** low-impact UX gap · **VERIFIED-OK** audit flagged a concern but code inspection shows it works

---

## 1. Auth & First Run (`Auth.tsx`, `useAuth.ts`, `AppShell.tsx`)

The whole app is **state-gated** by `AppShell.tsx` — `!signedInEmail` → Auth screen; `!onboarded` → Onboarding; otherwise the app. Gates are reactive, so clearing auth/profile state re-routes automatically with no `router.push` needed.

| Screen | Action | Status |
|---|---|---|
| Auth | First run lands on Auth in sign-up mode (account null) | OK |
| Auth | Create account — validates email format + password length, persists, advances to Onboarding | OK |
| Auth | Sign in with correct email/password | OK |
| Auth | Sign in wrong password → "Email or password is incorrect", can retry | OK |
| Auth | Sign in with no account → "No account yet — sign up first" + toggle to sign-up | OK |
| Auth | Invalid email → "Enter a valid email address" | OK |
| Auth | Password < 6 chars → password-length error | OK |
| Auth | Submit disabled unless both email + password present | OK |
| Auth | Busy guard — re-taps ignored while request pending ("Please wait…") | OK |
| Auth | Account persisted across tab close; mode picked by account existence | OK |

## 2. Onboarding (`Onboarding.tsx`, `useStore.ts`)

| Step | Action | Status |
|---|---|---|
| Name | Empty name → falls back to "Athlete" | OK |
| Name | Trailing/leading spaces trimmed; capped at 30 chars (`maxLength`) | OK |
| Equipment (step 3) | Continue disabled until ≥1 item selected | OK |
| Equipment | Preset select applies item set; active states correct | OK |
| Equipment | Individual toggle add/remove | OK |
| Focus muscles | Optional toggle; may be left empty | OK |
| Session length | Slider live-updates from default 50 min | OK |
| Final step | Shows "You're all set, {name}…" + "Build my first workout" | OK |
| Final step | "Build my first workout" → `complete()` (onboarded=true) → `generate()` → home with session | OK |
| Nav | Back button preserves state-controlled answers | OK |
| Nav | On final step only Build button shows (no Continue) | OK |
| Persistence | Onboarding state not persisted mid-flow (intentional); restart from step 0 | OK |
| Recovery | Corrupt/null `onboarded` coerced to false → re-gated to Onboarding | OK |

## 3. Home / Today (`app/page.tsx`)

| Section | Action | Status |
|---|---|---|
| Current hero | Tap exercise / "+N more" → `/session` | OK |
| Current hero | Start (planned) → `startWorkout()` + `/session` | OK |
| Current hero | Continue (active) → `/session` without restarting timer | OK |
| Current hero | Switch → confirm if logged → `generate()` + `/session` | OK |
| Current hero | Discard → confirm if logged/active → `discardCurrent()` + clear selection | OK |
| Plan-day hero | Start → resume if same day w/ logged work, else confirm → `generateFromPlan()` + start | OK |
| Plan-day hero | Build a free workout (no preview) → confirm → `generate()` + `/session` | OK |
| Plan-day hero | Skip to next day → confirm → `skipPlanDay()` (untags session) | OK |
| Plan status | Manage → `/plans` | OK |
| Plan status | Start [planDay] instead → confirm → generate + start | OK |
| Recovery diagram | front/back toggle | **MINOR** (selection card not cleared on toggle) |
| Recovery diagram | Tap muscle toggles recovery card | OK |
| Focus pills | Tap → confirm if logged → `generate({focusOverride})` + `/session` | OK |
| Shortcuts | "Rebuild a fresh workout" → confirm if logged → `generate()` | OK |
| Empty state | "Follow a Plan" card → `/plans` | OK |
| All confirm-gated actions | Concurrent confirms | **BUG** (ConfirmProvider race) |

## 4. Session (`app/session/page.tsx`, `session/[id]`)

| Action | Status |
|---|---|
| `/session` with no active session → empty state + Generate | OK |
| Generate new workout (planned) | OK |
| Start workout (planned → active, startedAt, timer) | OK |
| Log weight (decimals, non-numeric rejected, cap 9999) | OK |
| Log reps (integers only, cap 999) | OK |
| Weight +/− stepper (loadable increments) | OK |
| Reps +/− stepper (floor 0) | OK |
| Mark set done → scroll next, auto-start rest timer on first working set | OK |
| Mark set undone (no scroll/timer) | OK |
| Remove set (keeps ≥1 working set) | OK |
| Apply last time (copy weight/reps from last performance) | OK |
| Add set (inherits last working set) | OK |
| Navigate ← Back / Next → between exercises | OK |
| Swap exercise (carry sets, preserve instanceId, warn if logged) | OK |
| Reorder exercise up/down (disabled at bounds) | OK |
| Remove exercise (confirm → back to `/session`) | OK |
| Regenerate (warn if logged, preserve plan/focus) | OK |
| Finish (save working sets, advance plan, discard if empty, confirm incomplete) | OK |
| Discard (warn, clear current) | OK |
| Warm-up sets toggle | OK |
| `/session/[invalid-id]` → redirect to `/session` | OK |
| Coaching cue, plate breakdown, equipment note, timer, progress bar | OK |

## 5. Plans List (`app/plans/page.tsx`, `useStore.ts`)

| Action | Status |
|---|---|
| Start plan (built-in/custom) — preserve logged session, discard untouched | OK |
| Confirm before switching plans; cancel aborts | OK |
| Active plan banner (name, day title, Following badge, End plan) | OK |
| Start today's plan day — resume exact match else regenerate | OK |
| Plan-day fallback to recovery-aware generation (never empty) | OK |
| Day rotation modulo schedule length | OK |
| Finish plan-day advances dayIndex | OK |
| Skip plan day detaches session | OK |
| Filters: days (2–6 / Any), equipment, search — ANDed, "any" transparent | OK |
| No plans match → message, no crash | OK |
| Edit custom plan → builder | OK |
| Shorten schedule while following → dayIndex clamped | OK |
| Delete custom plan (remove, stop if following, clear tags) | OK |
| Duplicate built-in → "(Copy)" custom → builder | OK |
| Orphaned active plan (deleted) → banner + End plan, no crash | OK |
| Corrupt dayIndex → coerced finite ≥0 | OK |

## 6. Plan Builder (`app/plans/builder/page.tsx`)

| Action | Status |
|---|---|
| Generate / Regenerate plan (confirm if schedule non-empty) | OK |
| Edit plan name (maxLength 40) | OK |
| Change goal/level/equipment/days settings | OK |
| Add a day | OK |
| Remove a day | **BUG** (can remove all → unsaveable dead-end) |
| Move day up/down (disabled at bounds) | OK |
| Edit day title (title + label) | OK |
| Add lift via ExercisePicker (excludes existing, default sets/reps by goal) | OK |
| Edit sets/repMin/repMax (NumBox, defer clamp to blur) | OK |
| Remove / move lift up-down | OK |
| Save new (canSave: name + schedule + ≥1 lift) | OK |
| Save edit (`updateCustomPlan`) | OK |
| Unsaved-changes guard on back / beforeunload (name+schedule only) | OK |
| Settings not in dirty guard | **MINOR** (intentional; silent settings loss) |

## 7. Library (`app/library/page.tsx`)

| Action | Status |
|---|---|
| Search by name/muscle/equipment/category | OK |
| Filter by muscle (primary OR secondary) | OK |
| Filter by category | OK |
| "Available with my equipment" toggle (default on) | OK |
| Clear search (X) | OK |
| Quick-add to today (generate session if none, toast, disabled if already added) | OK |
| Open detail sheet | OK |
| Add from detail sheet (disabled "Already added") | OK |
| Duplicate detection (quick-add + detail) | OK |
| Result count + pluralization | OK |
| Empty state → Clear filters | OK |

## 8. History (`app/history/page.tsx`, `useStore.ts`)

| Action | Status |
|---|---|
| Open workout detail sheet (stats, per-set breakdown) | OK |
| Search by title/exercise (clear button) | OK |
| Repeat workout (clone fresh planned, confirm if logged) | OK |
| Delete workout (confirm → remove → sheet auto-closes via re-derivation) | VERIFIED-OK |
| No-match search message | **MINOR** (no "try different search" hint) |

## 9. Progress (`app/progress/page.tsx`)

| Action | Status |
|---|---|
| Recovery map (color-coded, tap muscle highlights + flips view) | OK |
| Volume trend (last 12, peak in lime, needs 2+ workouts) | OK |
| Muscle balance (push/pull/legs/core, 14-day, empty state) | OK |
| Personal records (top 6 by est. 1RM, BW label, empty state) | OK |

## 10. Settings (`app/settings/page.tsx`, `useStore.ts`, `useAuth.ts`)

| Action | Status |
|---|---|
| Update name (maxLength 30, persisted) | OK |
| Update bodyweight (decimals, in-flight "70." handled) | OK |
| Set training goal / experience (radios, persisted) | OK |
| Switch unit lb↔kg (converts history + current + bodyweight, toast) | OK |
| Session length slider (20–90) | OK |
| Toggle equipment (10) / focus muscles (14) | OK |
| Theme (system/light/dark) — `AppShell` applies live | OK |
| Accent color (7 swatches) | OK |
| Load sample data (confirm → replace, toast) | OK |
| Reset all data (confirm → resetAll → AppShell re-gates to Onboarding) | VERIFIED-OK |
| Sign out (clears email → AppShell re-gates to Auth) | VERIFIED-OK |
| Browse plans → `/plans` | OK |

---

### Notes on audit downgrades (verified against source)
- **Reset / Sign-out "missing navigation"** flagged as high in the History/Progress/Settings audit are **not bugs**. `AppShell.tsx:48,58` gate the entire tree on `useAuth.email` and `profile.onboarded`. Setting either falsy triggers an immediate re-render to Auth/Onboarding. No `router.push` is required because routing is state-driven, not URL-driven. The Settings page renders inside the gated subtree.
- **History stale detail sheet after delete** is **not a crash/stale-render bug**. `selected` is derived (`workouts.find(...) ?? null`); after delete it recomputes to `null`, and the Sheet is gated `open={selected !== null}` with `{selected && …}` content, so it closes cleanly.