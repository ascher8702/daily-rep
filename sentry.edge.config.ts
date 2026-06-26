// Sentry init for the Edge runtime (middleware / edge routes), loaded by src/instrumentation.ts.
// Activates only with a DSN in production.
import * as Sentry from '@sentry/nextjs'

// Public client key (safe to commit); override with SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN per environment.
const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN ||
  'https://60662eedc7853961107c5d4103bd03ab@o4511054322532352.ingest.us.sentry.io/4511633373921280'

if (dsn) {
  Sentry.init({
    dsn,
    enabled: process.env.NODE_ENV === 'production',
    tracesSampleRate: 0.1,
  })
}
