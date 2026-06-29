/**
 * LOCAL / DEMO auth helpers.
 *
 * ⚠️ This is a CLIENT-SIDE-ONLY gate: the account (email + salted SHA-256 password hash) lives
 * in localStorage and there is no server. It keeps casual onlookers out and gives the app a real
 * sign-up/sign-in flow, but it is NOT secure against anyone with access to the device/browser
 * storage. Do not treat it as real authentication.
 */

const enc = new TextEncoder()

/** Salted SHA-256 of a password, hex-encoded. */
export async function hashPassword(password: string, salt: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(`${salt}:${password}`))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** A random 16-byte salt, hex-encoded. */
export function randomSalt(): string {
  const a = new Uint8Array(16)
  crypto.getRandomValues(a)
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function emailValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

/** Returns a problem message, or null when the password is acceptable. Enforced on SIGN-UP only
 *  (sign-in never length-checks, so existing shorter-password accounts are never locked out). The
 *  ≥8 floor matches the Supabase Auth min-length + leaked-password (HIBP) protection that should be
 *  enabled in the dashboard — see docs/runbook-deploy.md `[HUMAN]` items. */
export function passwordIssue(password: string): string | null {
  if (password.length < 8) return 'Use at least 8 characters'
  return null
}

/** Junk that supabase-js / JSON.stringify can leave behind as an "error message" — never show these. */
const JUNK_MESSAGES = new Set(['{}', '[]', '[object Object]', 'null', 'undefined'])

/**
 * Turn a Supabase auth error into a user-friendly, NON-EMPTY message safe to render in the Auth
 * screen's alert box. A live test showed an email-send 500 surfacing an opaque message that rendered
 * literally as "{}", so we (a) map known cases by error `code`/`message`, (b) pass through a sensible
 * human-readable `message`, and (c) otherwise fall back to a generic notice — never raw junk. Pure and
 * dependency-free; reads `.code`/`.message` defensively because the shape isn't guaranteed.
 */
export function friendlyAuthError(error: unknown): string {
  const err = (error ?? {}) as { code?: unknown; message?: unknown }
  const code = typeof err.code === 'string' ? err.code.toLowerCase() : ''
  const rawMessage = typeof err.message === 'string' ? err.message : ''
  const message = rawMessage.toLowerCase()

  const has = (s: string) => code.includes(s) || message.includes(s)

  if (has('invalid login credentials') || has('invalid_credentials')) {
    return 'Incorrect email or password.'
  }
  if (has('email not confirmed') || has('email_not_confirmed')) {
    return 'Please confirm your email first - check your inbox.'
  }
  if (has('over_email_send_rate_limit') || has('unexpected_failure') || message.includes('sending')) {
    return 'We could not send that email right now. Please try again in a few minutes.'
  }
  if (has('user already registered') || has('user_already_exists')) {
    return 'An account with this email already exists. Try signing in.'
  }

  const trimmed = rawMessage.trim()
  if (trimmed.length > 1 && !JUNK_MESSAGES.has(trimmed)) return trimmed

  return 'Something went wrong. Please try again.'
}

/**
 * Best-effort display name from an email's local-part, to prefill onboarding:
 * "jane.doe@x.com" → "Jane Doe", "vlad8702@gmail.com" → "Vlad". Returns '' when nothing usable
 * remains (e.g. a purely numeric local-part), so the caller can fall back to an empty field.
 */
export function nameFromEmail(email: string): string {
  const local = (email.split('@')[0] ?? '').trim()
  if (!local) return ''
  return local
    .split(/[._+-]+/)
    .map((w) => w.replace(/\d+/g, '')) // drop digits (e.g. "vlad8702" → "vlad")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}
