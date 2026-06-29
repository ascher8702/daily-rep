# Deploy runbook — Daily Rep

How an operator ships Daily Rep to production. The app has two deployable surfaces:

1. **The Next.js frontend** → a Node host (Vercel is the assumed target; `vercel.json` is committed).
2. **The Supabase backend** → SQL migrations (`supabase/migrations/`) + Edge Functions
   (`supabase/functions/`) on the project.

> The dedicated Supabase project (`clobxwwcjlmyckvkongk`) is now provisioned and the data cutover is
> done; the schema is version-controlled under `supabase/migrations/`. This runbook targets that
> project. (Historical migration plan: `docs/archived/runbook-dedicated-project.md`.)

---

## 0. One-time setup

**Frontend host (Vercel):**
- Import the GitHub repo. Framework preset: **Next.js**. Node **20**. Package manager **pnpm** (the
  committed `vercel.json` pins install/build commands).
- Project env vars (Production + Preview):
  | Var | Value |
  | --- | --- |
  | `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
  | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the project anon/publishable key (NOT service_role) |
  | `NEXT_PUBLIC_SITE_URL` | `https://daily-rep.app` (canonical; used for OG/metadata) |
  | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Turnstile site key (enables CAPTCHA; optional but required for launch) |
  | `NEXT_PUBLIC_SENTRY_DSN` | error-reporting DSN (Sentry is prod-only and opt-in via this DSN; leave unset to disable) |
  - The production build **fail-fasts** if the two `SUPABASE` vars are missing — that's intentional.
- Domain: point `daily-rep.app` at the host. Keep it consistent with `NEXT_PUBLIC_SITE_URL`, the email
  templates (`emails/`), and `APP_URL` in the checkout edge function.

**Supabase project:**
- Edge Function secrets (Dashboard → Project Settings → Edge Functions → Secrets, or `supabase secrets set`):
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (live values — see `docs/STRIPE_SETUP.md`),
  `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`, `STRIPE_PORTAL_CONFIG`, `APP_URL`, and
  `RECONCILE_SECRET` (a random string shared with the reconciliation cron — see below).
- **`APP_URL` is required in production and does double duty:** the checkout/portal functions build their
  Stripe success/cancel/return redirect URLs from it, AND `_shared/cors.ts` derives the CORS allow-origin
  from it (it reflects exactly that origin). If `APP_URL` is unset, checkout/portal redirects break and CORS
  falls back to a wildcard `*` (the dev-only convenience) — so the billing functions would accept
  cross-origin browser calls. Set it to the canonical app origin (matching `NEXT_PUBLIC_SITE_URL`).
- Reconciliation cron (missed-webhook safety net): after deploying `reconcile-subscriptions`, store its
  URL + `RECONCILE_SECRET` in Vault so the baseline schema's `cron.schedule('reconcile-subscriptions-6h', …)`
  can call it (see the cron block near the end of `20260627000000_baseline_schema.sql` for the exact
  `vault.create_secret` calls).
- Auth → Attack Protection → enable CAPTCHA (Turnstile) with the matching secret key.
- Auth → Attack Protection → enable **leaked-password (HIBP) protection** (rejects passwords found in known
  breaches); set a sane min password length.
- Database → enable **PITR** (the `delete-account` function is irreversible; PITR is the only recovery).
- Stripe webhook endpoint → `https://<ref>.supabase.co/functions/v1/stripe-webhook`, subscribed to:
  `checkout.session.completed`, `customer.subscription.created|updated|deleted|paused|resumed`,
  `invoice.paid`, `invoice.payment_failed`, `customer.deleted`, and `charge.dispute.created`.

---

## 1. Pre-deploy gate (must be green)

From a clean checkout of the commit you intend to ship:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm audit:prod          # BLOCKING for production: high/critical advisories in prod deps
pnpm check:legal          # BLOCKING for production: legal placeholders must be filled by counsel
pnpm check:prod           # BLOCKING for production: static release-regression guards
NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_ANON_KEY=… pnpm build
```

`audit:prod`, `check:legal`, and `check:prod` are hard gates in CI. `check:legal` and `check:prod`
also run at deploy: `vercel.json` runs
`pnpm check:legal && pnpm check:prod && pnpm build`, so a Vercel build fails while legal placeholders
remain or a release-blocking production guard regresses. Do not bypass them.

`audit:prod` fails only on **high/critical** advisories in production dependencies (`--audit-level=high`).
A reviewed advisory that is awaiting an upstream fix can be allow-listed **without** disabling the gate: add
its CVE/GHSA id to `auditConfig.ignoreCves` / `auditConfig.ignoreGhsas` in `package.json` (pnpm consults
it). Keep that list short, justify each entry in the PR, and remove the id once the fix ships — anything not
on the list still hard-fails. Do not silence the gate wholesale.

---

## 2. Deploy the backend FIRST (schema, then functions)

Backend changes must land before the frontend that depends on them.

```bash
# Migrations (review the diff vs. the live project first):
supabase db push --project-ref <ref>

# Edge Functions (all six — redeploy any that changed):
supabase functions deploy create-checkout-session create-portal-session set-auto-renew \
  stripe-webhook delete-account reconcile-subscriptions --project-ref <ref>
```

The schema is collapsed onto `20260627000000_baseline_schema.sql` (which folds the historical entitlement
RLS, monotonic-write guard, analytics, and the `reconcile-subscriptions-6h` cron); pre-baseline migrations
live in `supabase/migrations/archive/`. Migrations applied on top of the baseline:

| Migration | What it adds |
| --- | --- |
| `20260628130000_fail_closed_missing_subscription_entitlement` | Missing `subscriptions` row now fails closed (last server-side paywall fail-open path removed). |
| `20260628140000`–`20260628200000` | DB-managed exercises catalogue + plans seed + `exercise_facts` sync trigger (remote-config layer). |
| `20260628234205_rate_limit_buckets_and_consume_rpc` | Cross-instance rate-limit store: `rate_limit_buckets` table + atomic `consume_rate_limit()` RPC (the in-memory limiter is per-warm-instance; `delete-account` uses this for a global budget). |
| `20260628234242_rls_auto_enable_cover_analytics_schema` | Widens the `rls_auto_enable` event-trigger backstop from `public` to also cover the private `analytics` schema. |
| `20260628234314_stripe_events_idempotency_ledger` | `stripe_events` ledger so the webhook short-circuits duplicate Stripe deliveries (insert-on-conflict-do-nothing → 200). |
| `20260628234400_rate_limit_and_events_sweep_cron` | pg_cron sweeps that reclaim stale `rate_limit_buckets` (daily, >1d old) and old `stripe_events` (90-day retention). |

**Edge Functions are not auto-deployed — redeploy any function whose source changed** (and remember
`supabase/functions/_shared/` is imported by several, so a change there means redeploying every dependent
function). The six functions and their JWT gating (`supabase/config.toml`): `stripe-webhook` and
`reconcile-subscriptions` are public (verified by Stripe signature / `RECONCILE_SECRET`); the other four
(`create-checkout-session`, `create-portal-session`, `set-auto-renew`, `delete-account`) require a JWT.

Verify: `supabase migration list --project-ref <ref>` matches `supabase/migrations/`, and
`get_advisors(security)` reports no new criticals. In particular confirm
`20260628130000_fail_closed_missing_subscription_entitlement` (and the baseline entitlement RLS it
hardens) is applied — until it is, the paywall is client-only (no server backstop), so the entitlement
smoke check below will not actually enforce.

## 3. Deploy the frontend

- **Vercel:** merging to `main` triggers a production deployment (per `vercel.json`). Or
  `vercel --prod` from the repo.

## 4. Smoke test (production)

- Load the app → sign up a throwaway account → confirm onboarding → trial is active.
- Subscribe with a live-mode test card path (or a real card you refund) → webhook lands → entitlement
  flips to Pro within a few seconds on `/checkout/return`.
- Open the billing portal; toggle auto-renew; confirm it reflects back.
- Sign out / back in; confirm sync restores data on a second device.
- Hit `/privacy` and `/terms` signed-out; confirm support email is `support@daily-rep.app`.
- **Entitlement enforcement (negative path — proves the P0 gate is live):** for a test user whose
  trial has expired and who has no active subscription, set `trial_ends_at` in the past and confirm a
  cloud write is **rejected** server-side (a `daily_rep_state` upsert returns Postgres `42501`); the app
  logs `sync.push.denied` and does not retry-storm. Then confirm an entitled user's write **succeeds**.
  If the un-entitled write succeeds, the entitlement migration is not applied — stop and apply it.

## 5. Rollback

- **Frontend:** Vercel → Deployments → promote the previous good deployment (instant). No data impact.
- **Edge Functions:** redeploy from the previous commit (`git checkout <prev> -- supabase/functions && supabase functions deploy …`).
- **Database:** migrations are forward-only. For a bad migration, ship a new corrective migration; for
  data loss, restore via **PITR**. Never hand-edit the live schema — add a migration and `db push`.

## 6. Post-deploy

- Watch error telemetry (Sentry, if `NEXT_PUBLIC_SENTRY_DSN` is set) and Stripe webhook delivery for failures.
- Confirm the analytics pg_cron jobs are draining (`analytics.reconcile_queue` depth ≈ 0).
