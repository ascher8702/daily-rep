// Sentry init for the Edge runtime (middleware / edge routes), loaded by src/instrumentation.ts.
// Activates only with a DSN in production.
import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    enabled: process.env.NODE_ENV === 'production',
    tracesSampleRate: 0.1,
  })
}
