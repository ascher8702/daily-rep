// Next.js instrumentation hook. Loads the Sentry server/edge init per runtime (the client init is
// injected into the browser bundle by withSentryConfig). No-op unless a DSN is configured.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config')
  }
}

// Capture errors thrown while rendering Server Components / route handlers (Next's onRequestError hook).
export { captureRequestError as onRequestError } from '@sentry/nextjs'
