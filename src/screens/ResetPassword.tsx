'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../store/useAuth'
import { reportError } from '../lib/telemetry'
import { BrandLogo } from '../components/BrandLogo'
import { Button } from '../components/ui/Button'

// Defined at module scope (NOT inside the component) so they keep a stable identity across renders —
// otherwise React would remount the subtree on every keystroke and the password inputs would lose focus.
function Hero({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="bg-gradient-blaze text-center px-6 pt-[76px] pb-14 safe-top">
      <BrandLogo size={74} />
      <h1 className="mt-[18px] font-display text-[34px] font-black uppercase tracking-[-0.02em] leading-[0.9] text-on-accent">
        {title}
      </h1>
      <p className="mt-2 text-[12px] font-extrabold uppercase tracking-[0.16em] text-on-accent/70">{subtitle}</p>
    </div>
  )
}

function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 bg-bg rounded-t-[28px] -mt-[22px] px-[22px] pt-7 pb-8 safe-bottom">
      <div className="mx-auto w-full max-w-sm">{children}</div>
    </div>
  )
}

/**
 * Set-a-new-password screen for the password-recovery flow. Reached when the user follows the reset
 * link from `reset-password.html`: Supabase establishes a temporary recovery session and fires
 * PASSWORD_RECOVERY, which sets `recovering` in the auth store. AppShell routes here while `recovering`
 * is true (and the /reset-password route renders it directly), so the user sets a new password before
 * landing in the app. On success the recovery flag clears and they continue as a normal signed-in user.
 */
export default function ResetPassword() {
  const router = useRouter()
  const recovering = useAuth((s) => s.recovering)
  const email = useAuth((s) => s.email)
  const initialized = useAuth((s) => s.initialized)
  const updatePassword = useAuth((s) => s.updatePassword)

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  // Supabase appends an error to the URL fragment when a link is expired/invalid (no session is created).
  const [linkError, setLinkError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const desc = params.get('error_description') || params.get('error')
    if (desc) setLinkError(desc.replace(/\+/g, ' '))
  }, [])

  // a usable session (recovery or already signed in) lets us call updateUser({ password })
  const hasSession = recovering || !!email

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (password !== confirm) {
      setError('Passwords don’t match')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const err = await updatePassword(password)
      if (err) setError(err)
      else setDone(true)
    } catch (e) {
      reportError(e, { scope: 'auth.resetPassword' })
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  // Success — password set; continue into the app (the session is now a normal signed-in session).
  if (done) {
    return (
      <div className="min-h-full flex flex-col animate-fade-in">
        <Hero title="All set" subtitle="Your password is updated" />
        <Sheet>
          <div role="status" className="rounded-2xl bg-blaze/10 border border-blaze/30 px-4 py-4 text-sm text-fg/80 leading-relaxed">
            Your password has been changed. You can use it the next time you sign in.
          </div>
          <Button type="button" variant="primary" size="lg" fullWidth className="mt-5" onClick={() => router.replace('/')}>
            Continue to Daily Rep
          </Button>
        </Sheet>
      </div>
    )
  }

  // No usable session: link expired/invalid, or opened directly. Send them back to sign in.
  if (initialized && !hasSession) {
    return (
      <div className="min-h-full flex flex-col animate-fade-in">
        <Hero title="Link expired" subtitle="Let’s try that again" />
        <Sheet>
          <div role="alert" className="rounded-2xl bg-rose-400/10 border border-rose-400/30 px-4 py-4 text-sm text-rose-200 leading-relaxed">
            {linkError
              ? 'This password reset link is invalid or has expired.'
              : 'This reset link is no longer valid. Reset links can only be used once and expire after an hour.'}
          </div>
          <Button type="button" variant="primary" size="lg" fullWidth className="mt-5" onClick={() => router.replace('/')}>
            Back to sign in
          </Button>
          <p className="mt-3 text-center text-[12px] text-fg/45 leading-snug">
            Request a fresh link from the “Forgot password?” option on the sign-in screen.
          </p>
        </Sheet>
      </div>
    )
  }

  // Still verifying the link (recovery session not established yet).
  if (!hasSession) {
    return (
      <div className="min-h-full flex flex-col animate-fade-in">
        <Hero title="One sec" subtitle="Verifying your link" />
        <Sheet>
          <div className="rounded-2xl bg-card border border-hairline/10 px-4 py-5 text-center text-sm text-fg/55">
            Checking your reset link…
          </div>
        </Sheet>
      </div>
    )
  }

  // The set-a-new-password form.
  return (
    <div className="min-h-full flex flex-col animate-fade-in">
      <Hero title="New password" subtitle="Choose something strong" />
      <Sheet>
        <form onSubmit={submit} className="space-y-4">
          {email && (
            <p className="text-sm text-fg/60 leading-relaxed">
              Setting a new password for <span className="font-bold text-fg">{email}</span>.
            </p>
          )}
          <div>
            <label htmlFor="new-password" className="block text-xs font-semibold text-fg/60 mb-1.5">New password</label>
            <div className="relative">
              <input
                id="new-password"
                type={showPw ? 'text' : 'password'}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full rounded-xl bg-card border border-hairline/10 px-4 py-3.5 pr-11 text-[15px] outline-none focus:border-blaze"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-fg/40 active:text-fg/70"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                  {showPw && <path d="M3 3l18 18" />}
                </svg>
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="confirm-password" className="block text-xs font-semibold text-fg/60 mb-1.5">Confirm password</label>
            <input
              id="confirm-password"
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter your new password"
              className="w-full rounded-xl bg-card border border-hairline/10 px-4 py-3.5 text-[15px] outline-none focus:border-blaze"
            />
          </div>

          {error && (
            <div role="alert" className="rounded-xl bg-rose-400/10 border border-rose-400/30 px-3 py-2.5 text-sm text-rose-300">
              {error}
            </div>
          )}

          <Button type="submit" variant="primary" size="lg" fullWidth disabled={busy || !password || !confirm}>
            {busy ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      </Sheet>
    </div>
  )
}
