// Sentry browser init. Auto-injected into the client bundle by withSentryConfig (next.config.mjs).
// Activates ONLY when NEXT_PUBLIC_SENTRY_DSN is set and NODE_ENV=production, so dev/preview without a
// DSN are unaffected. Also bridges the app's telemetry seam so explicit catch sites (reportError) and
// product events (reportEvent) reach Sentry.
import * as Sentry from '@sentry/nextjs'
import { registerTelemetrySink } from './src/lib/telemetry'

// The DSN is a PUBLIC client key (write-only ingest — it ships in the browser bundle anyway), so it's
// safe to commit as the default. Override per-environment with NEXT_PUBLIC_SENTRY_DSN if needed.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ||
  'https://60662eedc7853961107c5d4103bd03ab@o4511054322532352.ingest.us.sentry.io/4511633373921280'

if (dsn) {
  Sentry.init({
    dsn,
    enabled: process.env.NODE_ENV === 'production',
    // Modest performance sampling; no Session Replay (keeps quota + bundle weight down — opt in later).
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  })

  registerTelemetrySink({
    captureError: (error, context) =>
      Sentry.captureException(error, { tags: context?.scope ? { scope: String(context.scope) } : undefined, extra: context }),
    // Product events become breadcrumbs (context on the next error) rather than standalone issues.
    captureEvent: (name, props) =>
      Sentry.addBreadcrumb({ category: 'app', message: name, level: 'info', data: props }),
  })
}
