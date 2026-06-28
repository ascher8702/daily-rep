# Stripe billing — setup & runbook

Daily Rep is a paid product gated behind a **30-day, card-free free trial**. New accounts get full
access for 30 days with no payment details; after that an active Stripe subscription is required.

- **Monthly** — $7.99/month
- **Annual** — $59.99/year (≈ $5.00/mo, "Save 37%")

## Screen flow (designed)

- **Trial start** (`/subscribe`, and a one-time post-onboarding welcome) — the card-free "30 Days Free"
  value screen with the trial timeline. `src/screens/TrialStart.tsx`.
- **Paywall gate** — when a signed-in user isn't entitled, AppShell renders `src/screens/Paywall.tsx`
  in `trial-ended` or `subscription-ended` mode (shared Pro card + plan selector + a "Your data" subpage
  so export/delete stay reachable while gated).
- **Checkout return** (`/checkout/return`) — `confirming → welcome` (bridges the async webhook gap) or
  `payment-failed`. Stripe `success_url`/`cancel_url` point here. `src/app/checkout/return/page.tsx`.
- **Settings hub** (`/settings`) — profile header + grouped rows drilling into subpages:
  `/settings/training`, `/settings/profile`, `/settings/membership`.
- **Membership / billing** (`/settings/membership`) — native **auto-renew toggle** (+ confirm sheet and
  "Canceling" state) via the `set-auto-renew` function; card / change-plan / billing-history hand off to
  the Stripe Billing Portal.

The browser never talks to Stripe directly. Checkout and the billing portal are **Stripe-hosted
redirects** created by Supabase Edge Functions, so there is **no Stripe key and no publishable key in
the client** — nothing to leak, and no CSP changes were needed.

---

## Architecture

```
 Browser (Next.js)
   │  supabase.functions.invoke('create-checkout-session' | 'create-portal-session')   (JWT auth)
   ▼
 Supabase Edge Functions (Deno)                         Stripe
   create-checkout-session ──────────────────────────►  Checkout Session ─┐
   create-portal-session  ──────────────────────────►  Billing Portal     │  user pays / manages
   stripe-webhook  ◄───────────────────────────────────  webhook events ◄─┘
   │  (service role, bypasses RLS)
   ▼
 public.subscriptions  ◄── auth.users INSERT trigger seeds a 30-day trial row
   │  (RLS: owner can READ only)
   ▼
 Browser reads its row → deriveEntitlement() → app or paywall
```

**Entitlement** = a live Stripe subscription (`status ∈ active | trialing | past_due`) **OR** still
inside the card-free trial window (`now < trial_ends_at`). A user can only ever **read** their own
`subscriptions` row (RLS) — they can't grant themselves Pro. The webhook (service role) and the signup
trigger (`security definer`) are the only writers.

---

## What's already provisioned (TEST mode — Stripe account `acct_1TlyIs…`, Supabase project `clobxwwcjlmyckvkongk`)

> Billing runs on the **dedicated** Supabase project `clobxwwcjlmyckvkongk` (the app's current
> `NEXT_PUBLIC_SUPABASE_URL`). The earlier shared project `aswwhsxubqyzbrfoptoq` and an unrelated Stripe
> account `acct_1TlyIy…` are both orphaned/unused — ignore them. (Stripe objects were re-created after a
> "delete test data" wipe of the sandbox, hence the IDs below.)

| Resource | ID |
| --- | --- |
| Product | Daily Rep Pro product in the target Stripe account |
| Price — monthly $7.99 | `price_...` from the target Stripe account |
| Price — annual $59.99 | `price_...` from the target Stripe account |
| Billing portal config | `bpc_...` from the target Stripe account |
| Webhook endpoint | `we_1Tn0H8Ly7BVo8A05Z7aDNPR5` → `https://clobxwwcjlmyckvkongk.supabase.co/functions/v1/stripe-webhook` |
| Webhook signing secret | `whsec_REDACTED_SET_IN_SUPABASE_SECRETS` (must match `STRIPE_WEBHOOK_SECRET` on the project) |

DB migration `subscriptions_table_and_trial` and Edge Functions `create-checkout-session`,
`create-portal-session`, `set-auto-renew`, `stripe-webhook`, `reconcile-subscriptions`, and the updated
`delete-account` are deployed.

Price, portal, webhook, and app URL values are all required Edge Function secrets. The functions do not
carry test-mode defaults.

---

## ⚠️ Required one-time step — set the Edge Function secrets

These **cannot** be set from the deploy tooling; set them once in Supabase. Until they are set, the
`stripe-webhook` function fails to boot (it constructs the Stripe client from `STRIPE_SECRET_KEY` at
startup) and checkout returns an error.

**Dashboard:** Project → *Project Settings* → *Edge Functions* → *Secrets* → add:

| Secret | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | your Stripe **test** secret key (`sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_REDACTED_SET_IN_SUPABASE_SECRETS` |
| `STRIPE_PRICE_MONTHLY` | monthly recurring price id (`price_…`) |
| `STRIPE_PRICE_ANNUAL` | annual recurring price id (`price_…`) |
| `STRIPE_PORTAL_CONFIG` | billing portal configuration id (`bpc_…`) |
| `APP_URL` | trusted app URL, e.g. `https://daily-rep.app` or local tunnel URL |

**Or via CLI:**

```bash
supabase secrets set \
  STRIPE_SECRET_KEY=sk_test_xxx \
  STRIPE_WEBHOOK_SECRET=whsec_REDACTED_SET_IN_SUPABASE_SECRETS \
  STRIPE_PRICE_MONTHLY=price_test_monthly \
  STRIPE_PRICE_ANNUAL=price_test_annual \
  STRIPE_PORTAL_CONFIG=bpc_test_xxx \
  APP_URL=http://localhost:3000 \
  --project-ref clobxwwcjlmyckvkongk
```

Supabase auto-injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` — don't set
those. `APP_URL` is required and is the only trusted checkout/portal return base.

> Security note: the test secret key was shared in chat **and** the test webhook signing secret was
> previously committed to this file. Both are test-mode, but treat them as compromised: **roll the secret
> key** (Stripe Dashboard → Developers → API keys) and **roll the webhook signing secret** (Developers →
> Webhooks → the endpoint → roll signing secret), then update the `STRIPE_SECRET_KEY` /
> `STRIPE_WEBHOOK_SECRET` Edge Function secrets with the new values. Never paste a real `whsec_`/`sk_`
> into a tracked file — keep them only in Supabase Edge Function secrets.

---

## Testing the flow (test mode)

1. Set the two secrets above.
2. Sign in, open **Settings → Membership** (or wait out / fake the trial) and click **Subscribe**.
3. On Stripe Checkout use test card `4242 4242 4242 4242`, any future expiry / CVC / ZIP.
4. You're redirected back to `/checkout/return?status=success`; that page shows a "Confirming your
   subscription" state and polls the entitlement a few times while the webhook updates your row, then flips
   to a "You're Pro" welcome — from which **Start training** routes to `/` and the manage link routes to
   `/settings/membership`.
5. **Manage subscription** opens the Stripe Billing Portal (cancel, switch plan, update card).
6. To exercise the paywall without waiting 30 days, set `trial_ends_at` to the past for your user in
   `public.subscriptions`, then reload.

Other useful test cards: `4000 0025 0000 3155` (requires authentication), `4000 0000 0000 9995`
(declined). See https://docs.stripe.com/testing#cards.

---

## Going live

1. In the **live** Stripe account, create the Product + the two recurring Prices ($7.99/mo, $59.99/yr)
   and a Billing Portal configuration (cancel + switch between the two prices).
2. Create a **live** webhook endpoint pointing at the same function URL, subscribed to
   `checkout.session.completed`, `customer.subscription.created|updated|deleted`. Copy its `whsec_…`.
3. Set the Edge Function secrets to the **live** values:
   ```bash
   supabase secrets set \
     STRIPE_SECRET_KEY=sk_live_xxx \
     STRIPE_WEBHOOK_SECRET=whsec_live_xxx \
     STRIPE_PRICE_MONTHLY=price_live_monthly \
     STRIPE_PRICE_ANNUAL=price_live_annual \
     STRIPE_PORTAL_CONFIG=bpc_live_xxx \
     APP_URL=https://daily-rep.app \
     --project-ref clobxwwcjlmyckvkongk
   ```
4. Redeploy is **not** required — the functions read these from env at runtime.

---

## Webhook events handled

`checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`. For each, the function **re-retrieves** the subscription from Stripe
and mirrors its current state into `public.subscriptions`, so duplicate or out-of-order deliveries
converge to the truth. The user is resolved from `subscription.metadata.user_id` (set at checkout),
falling back to the stored `stripe_customer_id → user_id` mapping.

## Known limitations / follow-ups

- **Soft gate, backed by server-side enforcement:** the paywall is enforced client-side (this is a
  client-rendered, offline-capable app). The entitlement store caches the last-known-good result
  per user and falls back to it on a read error (so a lapsed user can't bypass the gate by blocking
  one request), but a determined account holder can still defeat any purely-client check. The valuable
  data stays behind Supabase RLS. **Server-side entitlement enforcement has shipped:** an
  `is_active_subscriber()` predicate now gates the `daily_rep_state` write RLS (migration
  `20260626140000_entitlement_rls_on_daily_rep_state.sql`), so a lapsed user can read but cannot write
  premium data even with a tampered client.
- `trial_will_end` reminder emails are not wired up (no card is on file during the app trial, so
  Stripe's built-in dunning doesn't apply until the user subscribes).
- A cross-row unique conflict in the webhook upsert (same Stripe customer/subscription id landing on a
  different `user_id` — only reachable via out-of-band re-association) is logged and acknowledged for
  **manual reconciliation** rather than auto-resolved. A pg_cron-scheduled `reconcile-subscriptions`
  function (every 6h via pg_net; see `20260626160000_schedule_subscription_reconciliation.sql`) now
  backstops missed/dropped webhooks by re-syncing subscription state from Stripe.

## Post-review hardening (already applied)

A multi-agent adversarial review ran against this integration. Fixes landed: closed the fail-open
paywall bypass (per-user last-known-good cache), added a Stripe-side duplicate-subscription guard +
customer-create idempotency key, clamped the carried trial to the trusted signup window, added
`invoice.paid`/`invoice.payment_failed` webhook handling, made the webhook fail gracefully on a missing
secret (instead of crashing at boot), revoked the `authenticated` role's write grants on
`subscriptions`, and replaced raw exception strings in function responses with generic codes. The DB
migrations + `supabase/config.toml` (per-function `verify_jwt`) are now version-controlled under
`supabase/`.
