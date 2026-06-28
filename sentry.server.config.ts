// Sentry Node (server) init, loaded by src/instrumentation.ts register(). Activates only with a DSN in
// production. Accepts SENTRY_DSN or NEXT_PUBLIC_SENTRY_DSN. Bridges the telemetry seam server-side too.
import * as Sentry from '@sentry/nextjs'
import { registerTelemetrySink } from './src/lib/telemetry'

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    enabled: process.env.NODE_ENV === 'production',
    tracesSampleRate: 0.1,
  })

  registerTelemetrySink({
    captureError: (error, context) =>
      Sentry.captureException(error, { tags: context?.scope ? { scope: String(context.scope) } : undefined, extra: context }),
    captureEvent: (name, props) =>
      Sentry.addBreadcrumb({ category: 'app', message: name, level: 'info', data: props }),
  })
}
