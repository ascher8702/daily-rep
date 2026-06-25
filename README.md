# Daily Rep

A mobile-first, personalized strength-training web app inspired by the iOS app **Fitbod**. Daily Rep generates each workout around how recovered your muscles are, logs your sets with an automatic rest timer, and tracks your progress over time — running in the browser with offline-first local persistence and optional Supabase cloud sync.

## Features

- **Personalized workout generation** — a muscle-recovery model decides which muscles are fresh, then builds a session that fits your goal, equipment, experience level, and available time.
- **Muscle recovery heatmap** — a front/back body diagram colored by how fatigued vs. fresh each muscle group is, decaying over time after you train it.
- **Set-by-set logging** — weight + reps per set, warm-up sets, working sets, and a one-tap "done" check that auto-starts a rest timer.
- **Rest timer** — auto-starts when you complete a set, with ±15s and skip controls.
- **Exercise library** — ~50 exercises across every muscle group and equipment profile, with cueing instructions, filterable by muscle / category / your equipment.
- **Progress analytics** — volume trend, muscle balance (push/pull/legs/core), estimated 1-rep-max personal records, streaks, and totals.
- **History** — every completed session, grouped by date, with full set detail.
- **Onboarding** — goal, experience, equipment, focus muscles, and session length drive the personalization from day one.
- **Installable PWA** — standalone display, theme color, app icon, safe-area aware.

## Tech stack

- **Next.js 14** (App Router) + **TypeScript** (strict)
- **Tailwind CSS** for styling (custom dark "ink"/lime theme)
- **Zustand** with `persist` for state + localStorage persistence
- Hand-rolled inline **SVG** for the body heatmap and progress charts (zero chart/icon dependencies)

## Architecture

```
src/
  app/                 Next.js routes (Today, Session, Library, Progress, History, Settings)
    layout.tsx         metadata + viewport + <AppShell>
    AppShell.tsx       onboarding gate + bottom nav + global rest-timer bar
  screens/Onboarding   first-run personalization wizard
  components/          BodyDiagram, Sheet, ExercisePicker, BottomNav, RestTimerBar, icons
  data/                exercises.ts (library) + muscles.ts (metadata)
  lib/
    recovery.ts        fatigue model (per-muscle half-life decay) -> freshness map
    generator.ts       recovery-aware session builder (muscle scoring, equipment/time fit, set/rep prescription)
    format.ts          weight/date/clock formatting, Epley 1RM
  store/useStore.ts    Zustand store: profile, history, active session, rest timer
  types.ts             domain model
```

### How personalization works

1. Every completed set deposits **fatigue** on the muscles it trains (primary fully, secondary partially), weighted by RPE/volume.
2. Fatigue **decays** with a per-muscle half-life (large muscles recover slower), so the current state is the sum of decayed contributions from recent workouts.
3. **Freshness = 100 − fatigue.** The generator scores muscles by freshness (plus your focus emphasis), picks the targets, then greedily selects exercises that cover them — respecting your equipment and experience, fitting your time budget, and prescribing sets/reps/rest from your goal. It also applies a light progressive-overload nudge based on your last session.

## Getting started

```bash
pnpm install
cp .env.example .env.local   # then fill in your Supabase values
pnpm dev                     # http://localhost:3000
```

### Environment

Daily Rep uses Supabase for auth + cloud sync, and **an account is required to use the app**, so both
variables below must be set. A production build **fails fast** if either is missing (so a misconfigured
deploy can't silently ship an unauthenticated app). In local dev without them, the app runs in an open
local-only fallback for convenience.

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL (`https://<ref>.supabase.co`). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The Supabase anon/publishable key (safe in the client — protected by RLS; **never** use the service_role key). |

See `.env.example`.

Build / run production:

```bash
pnpm build
pnpm start
```

Type-check:

```bash
pnpm typecheck
```

> Local data lives in `localStorage` under the `daily-rep-v1` key (cloud-synced to Supabase when signed in). Resetting from **Settings → Reset all data** clears it and returns you to onboarding.
# daily-rep
