import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { startSync, stopSync } from '../lib/sync'
import { emailValid, passwordIssue, normalizeEmail } from '../lib/auth'
import { reportError } from '../lib/telemetry'
import { useStore } from './useStore'

/**
 * Auth + cloud session, backed by Supabase Auth. An account is REQUIRED to use the app (it's a paid
 * product) — there is no anonymous / "continue without an account" path. Signing in starts cloud sync;
 * signing out stops it and returns to the sign-in screen. The ONLY time the gate is bypassed is a build
 * with no Supabase env configured (e.g. local dev without .env.local), which falls back to an open local
 * mode so the app isn't bricked; a properly-configured build always requires sign-in.
 */

export interface AuthState {
  /** signed-in cloud email, or null */
  email: string | null
  /** running without cloud configured — a dev/infra fallback only, NOT a user choice */
  localOnly: boolean
  /** auth bootstrap finished — gate waits for this to avoid a flash of the sign-in screen */
  initialized: boolean
  /** a non-error notice to show (e.g. "check your email to confirm") */
  pending: string | null
  /** a password-recovery session is active (the user followed a reset-password link). While true the
   *  app routes to the "set a new password" screen instead of the normal signed-in experience. */
  recovering: boolean
  signUp: (email: string, password: string, captchaToken?: string) => Promise<string | null>
  signIn: (email: string, password: string, captchaToken?: string) => Promise<string | null>
  /** Send a password-reset email. Always resolves with null on a well-formed request (Supabase does not
   *  reveal whether the address exists, to prevent account enumeration); the UI shows a generic notice. */
  resetPassword: (email: string, captchaToken?: string) => Promise<string | null>
  /** Change the account email. Supabase emails a confirmation link to the new (and old) address; the
   *  change only applies once confirmed, so the UI tells the user to check their inbox. */
  updateEmail: (newEmail: string) => Promise<string | null>
  /** Set a new password for the current session — used both by the recovery flow and from Settings. */
  updatePassword: (newPassword: string) => Promise<string | null>
  /** OAuth sign-in (Google / Apple). On success the browser redirects to the provider and the
   *  function never really "returns" (the page navigates away); it resolves with an error message
   *  only when the redirect couldn't be started (e.g. the provider isn't enabled in Supabase). */
  signInWithProvider: (provider: 'google' | 'apple') => Promise<string | null>
  /** Passwordless sign-in: email the user a one-time magic link (Supabase `signInWithOtp`). On success
   *  no session exists yet — it lands when they open the link — so `pending` is set to a "check your
   *  email" notice. Resolves with an error message only when the email couldn't be sent. */
  signInWithMagicLink: (email: string, captchaToken?: string) => Promise<string | null>
  signOut: () => Promise<void>
  /** permanently delete the account + ALL cloud data (GDPR erasure), then tear down local state.
   *  Returns an error message on failure, or null on success. */
  deleteAccount: () => Promise<string | null>
  init: () => void
}

let bootstrapped = false

export const useAuth = create<AuthState>((set) => ({
  email: null,
  localOnly: false,
  initialized: false,
  pending: null,
  recovering: false,

  init: () => {
    if (bootstrapped) return
    bootstrapped = true

    // No cloud configured (e.g. missing env in local dev) → open local mode so the app isn't bricked.
    // In production supabase.ts throws when env is missing, so this branch is dev-only; the prod guard
    // here (localOnly stays false in production) is defense-in-depth — a misconfigured prod build shows
    // the (non-functional) sign-in gate rather than silently opening the app.
    if (!supabase) {
      set({ initialized: true, localOnly: process.env.NODE_ENV !== 'production' })
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user
      set({ email: u?.email ?? null, initialized: true })
      if (u) void startSync(u.id)
    })

    supabase.auth.onAuthStateChange((event, session) => {
      const u = session?.user
      set({ email: u?.email ?? null })
      // A reset-password link signs the user into a temporary recovery session and fires this event;
      // flag it so the gate shows the "set a new password" screen until the password is updated.
      if (event === 'PASSWORD_RECOVERY') set({ recovering: true })
      if (u) {
        set({ pending: null })
        void startSync(u.id)
      } else {
        set({ recovering: false })
        void stopSync()
      }
    })
  },

  signUp: async (rawEmail, password, captchaToken) => {
    const email = normalizeEmail(rawEmail)
    if (!emailValid(email)) return 'Enter a valid email address'
    const pw = passwordIssue(password)
    if (pw) return pw
    if (!supabase) return 'Cloud sync is not configured'
    // captchaToken is only present when NEXT_PUBLIC_TURNSTILE_SITE_KEY is configured (the Auth screen
    // renders the widget then) AND the Supabase dashboard has CAPTCHA enabled to verify it server-side.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: captchaToken ? { captchaToken } : undefined,
    })
    if (error) return error.message
    // when email confirmation is required, no session is returned yet
    if (!data.session) {
      set({ pending: 'Check your email to confirm your account, then sign in.' })
      return null
    }
    return null // signed in — onAuthStateChange wires email + sync
  },

  signIn: async (rawEmail, password, captchaToken) => {
    if (!supabase) return 'Cloud sync is not configured'
    const email = normalizeEmail(rawEmail)
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: captchaToken ? { captchaToken } : undefined,
    })
    if (error) return error.message
    return null
  },

  signInWithProvider: async (provider) => {
    if (!supabase) return 'Cloud sync is not configured'
    // PKCE flow: signInWithOAuth redirects the browser to the provider, which returns to `redirectTo`
    // with a `?code=` that supabase-js auto-exchanges on load (detectSessionInUrl) → onAuthStateChange
    // wires email + sync, exactly like password sign-in. `redirectTo` MUST be in Supabase's allowed
    // Redirect URLs. On error (e.g. the provider isn't enabled yet) no redirect happens and we surface it.
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
      },
    })
    if (error) return error.message
    return null
  },

  signInWithMagicLink: async (rawEmail, captchaToken) => {
    const email = normalizeEmail(rawEmail)
    if (!emailValid(email)) return 'Enter a valid email address'
    if (!supabase) return 'Cloud sync is not configured'
    // The link returns to the app origin, where detectSessionInUrl exchanges it for a session
    // (→ onAuthStateChange wires email + sync), exactly like the OAuth flow.
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
        captchaToken,
      },
    })
    if (error) return error.message
    set({ pending: 'Check your email for a sign-in link to finish signing in.' })
    return null
  },

  resetPassword: async (rawEmail, captchaToken) => {
    const email = normalizeEmail(rawEmail)
    if (!emailValid(email)) return 'Enter a valid email address'
    if (!supabase) return 'Cloud sync is not configured'
    // The link returns to /reset-password (must be in Supabase's allowed Redirect URLs), where the
    // recovery session is detected and the "set a new password" screen is shown.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined,
      captchaToken,
    })
    if (error) return error.message
    return null
  },

  updateEmail: async (rawEmail) => {
    if (!supabase) return 'Cloud sync is not configured'
    const email = normalizeEmail(rawEmail)
    if (!emailValid(email)) return 'Enter a valid email address'
    // Supabase emails a confirmation link to the new (and old) address; onAuthStateChange updates the
    // local email only after the link is followed, so the caller prompts the user to check their inbox.
    const { error } = await supabase.auth.updateUser(
      { email },
      { emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined },
    )
    if (error) return error.message
    return null
  },

  updatePassword: async (newPassword) => {
    if (!supabase) return 'Cloud sync is not configured'
    const issue = passwordIssue(newPassword)
    if (issue) return issue
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) return error.message
    // password set — leave any recovery session and continue as a normally signed-in user
    set({ recovering: false })
    return null
  },

  signOut: async () => {
    // never leave the user stuck "signed in" on a network error — always tear down local session state
    try {
      if (supabase) await supabase.auth.signOut()
    } catch (e) {
      // ignore network/identity errors (we still clear the local session below), but surface it
      reportError(e, { scope: 'auth.signOut' })
    }
    await stopSync()
    // back to the sign-in screen (account required — no local fallback for a configured build)
    set({ email: null, localOnly: false, recovering: false })
  },

  deleteAccount: async () => {
    if (!supabase) return 'Account deletion is unavailable in this build'
    let res
    try {
      // the Edge Function re-derives the uid from the caller's JWT, purges all data, then deletes
      // the auth user — a user can only ever delete THEMSELVES.
      res = await supabase.functions.invoke('delete-account', { method: 'POST' })
    } catch (e) {
      reportError(e, { scope: 'auth.deleteAccount' })
      return e instanceof Error ? e.message : 'Could not reach the server. Please try again.'
    }
    if (res.error) return res.error.message || 'Could not delete your account. Please try again.'
    const body = res.data as { ok?: boolean; error?: string } | null
    if (body?.error) return body.error
    // account + cloud data are gone server-side — tear everything down locally
    await stopSync()
    try {
      await supabase.auth.signOut()
    } catch {
      /* the user no longer exists server-side; clearing the local session is enough */
    }
    useStore.getState().resetAll()
    set({ email: null, localOnly: false, pending: null, recovering: false })
    return null
  },
}))
