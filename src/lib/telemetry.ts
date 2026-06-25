/**
 * Central error/telemetry seam. ONE place every catch site + error boundary forwards to, so they don't
 * each need to know the backend. Today it logs to the console in development and deliberately NO-OPS in
 * production (no console noise, no PII leakage). When an error reporter is available, wire it here.
 *
 * TODO(telemetry) [HUMAN]: add a Sentry/PostHog DSN + init (e.g. NEXT_PUBLIC_SENTRY_DSN) and forward in
 * the production branch below — `Sentry.captureException(error, { tags: { scope }, extra: context })`.
 * Keep PII out of `context`.
 */

export interface ErrorContext {
  /** where it happened, e.g. 'sync.push' | 'auth.signOut' | 'route-error-boundary' */
  scope?: string
  /** extra non-PII tags (ids, counts, digests) */
  [key: string]: unknown
}

/** Read dynamically (not captured at import) so the prod/dev branch is honoured at call time. */
function isProd(): boolean {
  return process.env.NODE_ENV === 'production'
}

/** Report an unexpected error. Never throws — reporting must not break the path that's already failing. */
export function reportError(error: unknown, context?: ErrorContext): void {
  try {
    if (!isProd()) {
      // eslint-disable-next-line no-console
      console.error(`[telemetry]${context?.scope ? ` ${context.scope}:` : ''}`, error, context ?? '')
      return
    }
    // prod: forward to the error reporter once configured (see TODO above). No-op until then.
  } catch {
    /* reporting itself must never throw */
  }
}

/** Optional product-analytics event seam (no-op until a provider is wired). */
export function reportEvent(name: string, props?: Record<string, unknown>): void {
  try {
    if (!isProd()) {
      // eslint-disable-next-line no-console
      console.debug('[telemetry:event]', name, props ?? '')
      return
    }
    // prod: forward to PostHog/analytics once configured.
  } catch {
    /* never throw */
  }
}
