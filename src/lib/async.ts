/**
 * Run `promise`, but guarantee the app makes forward progress even if it never settles. If the promise
 * hasn't settled within `ms`, `onTimeout` fires once (e.g. to flip an `initialized` flag so a gated UI
 * stops waiting). The promise's real outcome still propagates afterwards: `onValue` runs on every
 * resolve and `onError` on every reject, even if the timeout already fired — so a slow-but-successful
 * result is never dropped.
 *
 * Used to keep the auth bootstrap (`supabase.auth.getSession()`) from stranding the app on the loading
 * skeleton forever when a token refresh hangs.
 */
export function settleWithin<T>(
  promise: Promise<T>,
  ms: number,
  handlers: { onValue: (value: T) => void; onError: (error: unknown) => void; onTimeout: () => void },
): void {
  let settled = false
  const timer = setTimeout(() => {
    if (!settled) handlers.onTimeout()
  }, ms)
  promise.then(
    (value) => {
      settled = true
      clearTimeout(timer)
      handlers.onValue(value)
    },
    (error) => {
      settled = true
      clearTimeout(timer)
      handlers.onError(error)
    },
  )
}
