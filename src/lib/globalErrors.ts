import { reportError } from './telemetry'

/**
 * Install process-wide handlers for errors that escape React's render-phase error boundaries: uncaught
 * exceptions thrown from event handlers / timers (`error`) and rejected promises that nothing `await`s or
 * `.catch`es (`unhandledrejection`). The codebase has many fire-and-forget `void promise` call sites
 * (sync, entitlement refresh, auth), so without this seam those failures are invisible in production.
 *
 * Forwards to {@link reportError}; returns a cleanup that removes both listeners (so it's safe to install
 * from a `useEffect`). Idempotent per target via referential listeners.
 */
export function installGlobalErrorHandlers(target: Window = window): () => void {
  const onError = (event: ErrorEvent) => {
    // event.error carries the stack when available; fall back to the message string.
    reportError(event.error ?? event.message, { scope: 'window.onerror', message: event.message })
  }
  const onRejection = (event: PromiseRejectionEvent) => {
    reportError(event.reason, { scope: 'unhandledrejection' })
  }
  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)
  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
  }
}
