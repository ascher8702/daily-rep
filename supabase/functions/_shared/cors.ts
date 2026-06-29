/**
 * Centralised CORS headers for the JWT-gated billing/account Edge Functions (create-checkout-session,
 * create-portal-session, set-auto-renew, delete-account). These are called by the browser via
 * supabase-js `functions.invoke`, so they MUST emit CORS — but the previous wildcard
 * `Access-Control-Allow-Origin: '*'` let any site on the web invoke them with a victim's forwarded creds.
 * We now reflect ONLY the app's own origin (derived from APP_URL, the same env already used to build the
 * Stripe redirect URLs) so cross-origin callers get no CORS grant and the browser blocks the response.
 *
 * APP_URL may be a full URL with a path (e.g. https://app.dailyrep.com); we normalise to its scheme+host
 * origin. If APP_URL is unset (local/dev convenience), we fall back to wildcard so dev tooling still works
 * — production sets APP_URL, so prod is locked down.
 */

/** The allowed browser origin, or null when APP_URL is unset/unparseable (→ dev wildcard fallback). */
function allowedOrigin(): string | null {
  const appUrl = Deno.env.get('APP_URL')
  if (!appUrl) return null
  try {
    return new URL(appUrl).origin
  } catch {
    return null
  }
}

/**
 * Build the CORS headers for a request. When APP_URL is set we always advertise exactly that origin (so a
 * cross-origin page never receives a matching Allow-Origin and the browser blocks the response); when it's
 * unset (dev) we fall back to '*'. `req` is accepted for forward-compat / per-request variation and to keep
 * call sites uniform. `Vary: Origin` keeps shared caches from serving one origin's grant to another.
 */
export function corsHeaders(_req: Request): Record<string, string> {
  const allowed = allowedOrigin()
  return {
    'Access-Control-Allow-Origin': allowed ?? '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}
