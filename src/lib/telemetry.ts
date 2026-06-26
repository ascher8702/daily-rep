/**
 * Central error/telemetry seam. ONE place every catch site + error boundary forwards to, so they don't
 * each need to know the backend. In development it logs to the console; in production it forwards to a
 * registered {@link TelemetrySink} (and stays a silent no-op until one is registered, so no PII leaks and
 * there's no console noise).
 *
 * Wiring a backend is now a one-liner: call {@link registerTelemetrySink} once at app start with an
 * adapter for your provider, e.g.
 *
 *   registerTelemetrySink({
 *     captureError: (e, ctx) => Sentry.captureException(e, { tags: { scope: ctx?.scope }, extra: ctx }),
 *     captureEvent: (name, props) => posthog.capture(name, props),
 *   })
 *
 * Keep PII out of `context`/`props`; the adapter is the right place to scrub anything provider-specific.
 * The DSN/init for the chosen provider remains a [HUMAN] step (NEXT_PUBLIC_SENTRY_DSN etc.).
 */

export interface ErrorContext {
  /** where it happened, e.g. 'sync.push' | 'auth.signOut' | 'route-error-boundary' */
  scope?: string
  /** extra non-PII tags (ids, counts, digests) */
  [key: string]: unknown
}

/** A pluggable backend for the telemetry seam. Both methods are optional. */
export interface TelemetrySink {
  captureError?: (error: unknown, context?: ErrorContext) => void
  captureEvent?: (name: string, props?: Record<string, unknown>) => void
}

/** The single active sink, or null when none is wired (the default — seam stays a no-op in prod). */
let sink: TelemetrySink | null = null

/** Register (or clear, with null) the backend the prod seam forwards to. Idempotent; last wins. */
export function registerTelemetrySink(next: TelemetrySink | null): void {
  sink = next
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
    // prod: forward to the registered reporter (no-op until one is wired via registerTelemetrySink)
    sink?.captureError?.(error, context)
  } catch {
    /* reporting itself must never throw */
  }
}

/** Optional product-analytics event seam (forwards to the sink in prod; no-op until one is wired). */
export function reportEvent(name: string, props?: Record<string, unknown>): void {
  try {
    if (!isProd()) {
      // eslint-disable-next-line no-console
      console.debug('[telemetry:event]', name, props ?? '')
      return
    }
    // prod: forward to PostHog/analytics via the registered sink.
    sink?.captureEvent?.(name, props)
  } catch {
    /* never throw */
  }
}
