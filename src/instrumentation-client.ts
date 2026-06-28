// Sentry browser init. Loaded by Next's instrumentation-client convention and Sentry's build plugin.
// Activates ONLY when NEXT_PUBLIC_SENTRY_DSN is set and NODE_ENV=production, so dev/preview without a
// DSN are unaffected. Also bridges the app's telemetry seam so explicit catch sites (reportError) and
// product events (reportEvent) reach Sentry.
import * as Sentry from '@sentry/nextjs'
import { registerTelemetrySink } from './lib/telemetry'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

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
      Sentry.captureException(error, {
        tags: context?.scope ? { scope: String(context.scope) } : undefined,
        extra: context,
      }),
    // Product events become breadcrumbs (context on the next error) rather than standalone issues.
    captureEvent: (name, props) =>
      Sentry.addBreadcrumb({ category: 'app', message: name, level: 'info', data: props }),
  })
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
