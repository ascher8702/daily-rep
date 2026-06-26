#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Provision a FRESH, dedicated Supabase project for Daily Rep from version-controlled
# migrations + edge functions. Use this for the "delete the shared project, stand up a
# clean one" cutover — there is NO data migration (fresh start).
#
# Prereqgs (operator, on your machine — NONE of this can run from the agent sandbox):
#   • Supabase CLI installed + logged in:  supabase login
#   • A new EMPTY project created in the dashboard; note its <project-ref>
#   • Stripe account + live/test keys; Vercel project access
#
# Usage:
#   NEW_REF=<project-ref> ./scripts/provision-dedicated-project.sh preflight
#   NEW_REF=<project-ref> ./scripts/provision-dedicated-project.sh schema
#   NEW_REF=<project-ref> ./scripts/provision-dedicated-project.sh functions
#   NEW_REF=<project-ref> ./scripts/provision-dedicated-project.sh verify
#   NEW_REF=<project-ref> ./scripts/provision-dedicated-project.sh secrets-help
#   NEW_REF=<project-ref> ./scripts/provision-dedicated-project.sh all   # schema → functions → verify
#
# Idempotent: re-running is safe (db push skips applied migrations; functions redeploy).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

NEW_REF="${NEW_REF:-}"
FUNCTIONS=(create-checkout-session create-portal-session set-auto-renew stripe-webhook delete-account reconcile-subscriptions)

die()  { echo "ERROR: $*" >&2; exit 1; }
note() { echo "  • $*"; }
hr()   { printf '─%.0s' {1..70}; echo; }

require_cli() {
  command -v supabase >/dev/null 2>&1 || die "supabase CLI not found. Install: https://supabase.com/docs/guides/cli"
}
require_ref() { [[ -n "$NEW_REF" ]] || die "NEW_REF=<project-ref> is required."; }

cmd_preflight() {
  hr; echo "PREFLIGHT"
  require_cli
  note "supabase CLI: $(supabase --version 2>/dev/null | head -1)"
  require_ref
  note "target project ref: $NEW_REF"
  local n; n=$(ls supabase/migrations/*.sql 2>/dev/null | wc -l | tr -d ' ')
  [[ "$n" -gt 0 ]] || die "no migrations found under supabase/migrations/"
  note "migrations to apply: $n"
  note "migration order (first/last):"
  ls supabase/migrations/*.sql | head -1 | sed 's/^/      /'
  ls supabase/migrations/*.sql | tail -1 | sed 's/^/      /'
  note "edge functions to deploy: ${FUNCTIONS[*]}"
  echo
  echo "STRONGLY RECOMMENDED before touching the real project — prove the schema reproduces cleanly:"
  note "supabase start                 # local stack"
  note "supabase db reset              # replays ALL migrations on a clean DB; must succeed end-to-end"
  hr
  echo "Preflight OK. Next: '$0 schema'"
}

cmd_schema() {
  require_cli; require_ref
  hr; echo "SCHEMA → linking + db push to $NEW_REF"
  echo "You'll be prompted for the project's DB password (Dashboard → Settings → Database)."
  supabase link --project-ref "$NEW_REF"
  # Applies every migration in supabase/migrations/ in order. The legacy-drop migration is defensive
  # (DROP ... IF EXISTS) so it's a harmless no-op on a clean project.
  supabase db push
  hr
  echo "Schema applied. NOTE: migration 20260626160000 schedules the reconcile cron, which only works"
  echo "once reconcile-subscriptions is deployed and RECONCILE_SECRET + Vault are set (see secrets-help)."
  echo "Next: '$0 functions'"
}

cmd_functions() {
  require_cli; require_ref
  hr; echo "FUNCTIONS → deploying to $NEW_REF"
  # config.toml carries the per-function verify_jwt settings.
  supabase functions deploy "${FUNCTIONS[@]}" --project-ref "$NEW_REF"
  hr
  echo "Functions deployed. Now set their secrets: '$0 secrets-help'"
}

cmd_secrets_help() {
  require_ref
  hr; echo "SECRETS + WIRING (run these yourself with real values — never commit them)"
  cat <<EOF

1) Edge Function secrets (Stripe + reconciliation):
   supabase secrets set \\
     STRIPE_SECRET_KEY=sk_live_xxx \\
     STRIPE_WEBHOOK_SECRET=whsec_xxx \\
     RECONCILE_SECRET=\$(openssl rand -hex 24) \\
     --project-ref $NEW_REF
   # optional: STRIPE_PRICE_MONTHLY / STRIPE_PRICE_ANNUAL / STRIPE_PORTAL_CONFIG / APP_URL

2) Vault entries so the cron (migration 20260626160000) can call reconcile-subscriptions:
   # run in the SQL editor on the new project, using the SAME RECONCILE_SECRET as above:
   select vault.create_secret('https://$NEW_REF.supabase.co/functions/v1/reconcile-subscriptions','reconcile_url');
   select vault.create_secret('<RECONCILE_SECRET>','reconcile_secret');

3) Auth hardening (Dashboard → Authentication):
   • enable Leaked Password Protection (HIBP) + a sane min length
   • set Site URL + Redirect URLs (https://daily-rep.app, .../reset-password, http://localhost:3000)
   • enable CAPTCHA (Turnstile) + paste the secret  [also set NEXT_PUBLIC_TURNSTILE_SITE_KEY in the app]
   • upload the email templates from emails/ if you customise them

4) Database (Dashboard → Database):
   • enable Point-in-Time Recovery (delete-account is irreversible; PITR is the only recovery)

5) App env (Vercel → Project → Settings → Environment Variables, Production + Preview):
   NEXT_PUBLIC_SUPABASE_URL      = https://$NEW_REF.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY = <new project's anon/publishable key>
   NEXT_PUBLIC_SITE_URL          = https://daily-rep.app
   # NEXT_PUBLIC_SENTRY_DSN is already baked in; override here if you want a different DSN
   # then redeploy the app

6) Stripe → Developers → Webhooks: point the endpoint at
   https://$NEW_REF.supabase.co/functions/v1/stripe-webhook
   subscribed to: checkout.session.completed,
     customer.subscription.created|updated|deleted|paused|resumed,
     invoice.paid, invoice.payment_failed, customer.deleted, charge.dispute.created
   then copy the new signing secret into STRIPE_WEBHOOK_SECRET (step 1).

7) Update this repo: change project_id in supabase/config.toml to "$NEW_REF" (or it's set by 'supabase link').
EOF
  hr
}

cmd_verify() {
  require_cli; require_ref
  hr; echo "VERIFY → $NEW_REF"
  echo "Run these checks in the SQL editor (or psql) on the new project:"
  cat <<'EOF'
  -- schema present
  select count(*) as public_tables from pg_tables where schemaname='public';            -- expect 8
  select to_regprocedure('public.is_active_subscriber()') is not null as gate_fn;        -- expect t
  select count(*) as exercise_facts from public.exercise_facts;                          -- expect 55
  select count(*) as plans from public.plans;                                            -- DB-managed (may be 0)
  -- RLS gated writes
  select count(*) from pg_policies where tablename='daily_rep_state'
    and policyname in ('daily_rep_state_insert_own','daily_rep_state_update_own');       -- expect 2
  -- cron jobs
  select jobname, schedule from cron.job order by jobname;
EOF
  echo "Then: supabase db lint / Dashboard advisors → confirm no new criticals."
  hr
}

case "${1:-preflight}" in
  preflight)    cmd_preflight ;;
  schema)       cmd_schema ;;
  functions)    cmd_functions ;;
  secrets-help) cmd_secrets_help ;;
  verify)       cmd_verify ;;
  all)          cmd_preflight; cmd_schema; cmd_functions; cmd_verify; cmd_secrets_help ;;
  *) die "unknown command '$1'. Use: preflight | schema | functions | secrets-help | verify | all" ;;
esac
