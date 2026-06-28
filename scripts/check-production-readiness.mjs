#!/usr/bin/env node
/**
 * Static production-readiness guard for release-blocking controls that are easy to regress in code.
 * This complements tests and smoke checks; it does not replace the live Supabase/Stripe verification
 * in docs/runbook-deploy.md.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return readFileSync(join(root, rel), 'utf8')
}

const checks = [
  {
    label: 'Sentry deletes uploaded source maps and disables maps without an upload token',
    file: 'next.config.mjs',
    test: (s) =>
      s.includes('deleteSourcemapsAfterUpload: true') &&
      s.includes('disable: !process.env.SENTRY_AUTH_TOKEN'),
  },
  {
    label: 'Sentry DSNs are configured only through environment variables',
    file: 'sentry.client.config.ts',
    test: (s) => !s.includes('ingest.us.sentry.io') && s.includes('process.env.NEXT_PUBLIC_SENTRY_DSN'),
  },
  {
    label: 'Server Sentry DSN is configured only through environment variables',
    file: 'sentry.server.config.ts',
    test: (s) => !s.includes('ingest.us.sentry.io') && s.includes('process.env.SENTRY_DSN'),
  },
  {
    label: 'Edge Sentry DSN is configured only through environment variables',
    file: 'sentry.edge.config.ts',
    test: (s) => !s.includes('ingest.us.sentry.io') && s.includes('process.env.SENTRY_DSN'),
  },
  {
    label: 'Checkout requires explicit Stripe price ids and APP_URL',
    file: 'supabase/functions/create-checkout-session/index.ts',
    test: (s) =>
      !/price_1T[nm]/.test(s) &&
      s.includes("Deno.env.get('STRIPE_PRICE_MONTHLY') || undefined") &&
      s.includes("Deno.env.get('STRIPE_PRICE_ANNUAL') || undefined") &&
      s.includes("const appUrl = Deno.env.get('APP_URL')") &&
      !s.includes("req.headers.get('origin')"),
  },
  {
    label: 'Portal requires explicit portal config and APP_URL',
    file: 'supabase/functions/create-portal-session/index.ts',
    test: (s) =>
      !/bpc_1Tn/.test(s) &&
      s.includes("Deno.env.get('STRIPE_PORTAL_CONFIG') || undefined") &&
      s.includes("const appUrl = Deno.env.get('APP_URL')") &&
      !s.includes("req.headers.get('origin')"),
  },
  {
    label: 'Account deletion blocks when Stripe cancellation fails',
    file: 'supabase/functions/delete-account/index.ts',
    test: (s) =>
      s.includes('return json({ error:') &&
      s.includes('stripe.subscriptions.cancel') &&
      !s.includes('continuing):'),
  },
  {
    label: 'Client entitlement fails closed with no cached/verified row',
    file: 'src/store/useEntitlement.ts',
    test: (s) =>
      s.includes('with no cache, fail closed') &&
      !s.includes('cached ?? { ...INITIAL, loading: false, entitled: true }'),
  },
  {
    label: 'RLS entitlement predicate fails closed on missing subscription rows',
    file: 'supabase/migrations/20260628130000_fail_closed_missing_subscription_entitlement.sql',
    test: (s) =>
      s.includes('when not exists (select 1 from public.subscriptions') &&
      s.includes('then false'),
  },
]

let failures = 0
for (const check of checks) {
  const source = read(check.file)
  if (!check.test(source)) {
    console.error(`check:prod — failed: ${check.label} (${check.file})`)
    failures++
  }
}

if (failures > 0) {
  console.error(`\ncheck:prod — ${failures} production-readiness guard(s) failed.`)
  process.exit(1)
}

console.log('check:prod — production-readiness guards passed. ✓')
