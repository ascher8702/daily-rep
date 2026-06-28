# Deploy runbook — Daily Rep

How an operator ships Daily Rep to production. The app has two deployable surfaces:

1. **The Next.js frontend** → a Node host (Vercel is the assumed target; `vercel.json` is committed).
2. **The Supabase backend** → SQL migrations (`supabase/migrations/`) + Edge Functions
   (`supabase/functions/`) on the project.

> Today both surfaces share a Supabase project with an unrelated app (see
> `docs/runbook-dedicated-project.md`). Moving to a dedicated project is a prerequisite for a clean
> production launch; this runbook assumes the **target** project, dedicated or not.

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
  | `NEXT_PUBLIC_SENTRY_DSN` | error-reporting DSN once the telemetry sink is wired (optional) |
  - The production build **fail-fasts** if the two `SUPABASE` vars are missing — that's intentional.
- Domain: point `daily-rep.app` at the host. Keep it consistent with `NEXT_PUBLIC_SITE_URL`, the email
  templates (`emails/`), and `APP_URL` in the checkout edge function.

**Supabase project:**
- Edge Function secrets (Dashboard → Project Settings → Edge Functions → Secrets, or `supabase secrets set`):
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (live values — see `docs/STRIPE_SETUP.md`),
  `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`, `STRIPE_PORTAL_CONFIG`, `APP_URL`, and
  `RECONCILE_SECRET` (a random string shared with the reconciliation cron — see below).
- Reconciliation cron (missed-webhook safety net): after deploying `reconcile-subscriptions`, store its
  URL + `RECONCILE_SECRET` in Vault so migration `20260626160000` can schedule it (see that migration's
  header for the exact `vault.create_secret` calls).
- Auth → Attack Protection → enable CAPTCHA (Turnstile) with the matching secret key.
- Auth → enable leaked-password (HIBP) protection; set a sane min password length.
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
pnpm check:legal          # BLOCKING for production: legal placeholders must be filled by counsel
pnpm check:prod           # BLOCKING for production: static release-regression guards
NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_ANON_KEY=… pnpm build
```

`check:legal` and `check:prod` are hard gates in CI and at deploy: `vercel.json` runs
`pnpm check:legal && pnpm check:prod && pnpm build`, so a Vercel build fails while legal placeholders
remain or a release-blocking production guard regresses. Do not bypass them.

---

## 2. Deploy the backend FIRST (schema, then functions)

Backend changes must land before the frontend that depends on them.

```bash
# Migrations (review the diff vs. the live project first):
supabase db push --project-ref <ref>

# Edge Functions:
supabase functions deploy create-checkout-session create-portal-session set-auto-renew \
  stripe-webhook delete-account reconcile-subscriptions --project-ref <ref>
```

Verify: `supabase migration list --project-ref <ref>` matches `supabase/migrations/`, and
`get_advisors(security)` reports no new criticals. In particular confirm
`20260626140000_entitlement_rls_on_daily_rep_state` is applied — until it is, the paywall is
client-only (no server backstop), so the entitlement smoke check below will not actually enforce.

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

- Watch error telemetry (once the Sentry sink is wired) and Stripe webhook delivery for failures.
- Confirm the analytics pg_cron jobs are draining (`analytics.reconcile_queue` depth ≈ 0).
