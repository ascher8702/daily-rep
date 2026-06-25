'use client'

import { useState } from 'react'
import { useAuth } from '../store/useAuth'
import { captchaEnabled } from '../lib/captcha'
import { reportError } from '../lib/telemetry'
import TurnstileWidget from '../components/TurnstileWidget'
import { BrandLogo } from '../components/BrandLogo'
import { Button } from '../components/ui/Button'

export default function Auth() {
  const signUp = useAuth((s) => s.signUp)
  const signIn = useAuth((s) => s.signIn)
  const pending = useAuth((s) => s.pending)

  const [mode, setMode] = useState<'signup' | 'signin'>('signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // CAPTCHA (only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set). `nonce` bumps to remount the widget for
  // a fresh challenge after a failed attempt, since Turnstile tokens are single-use.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaNonce, setCaptchaNonce] = useState(0)

  const isSignup = mode === 'signup'
  const needsCaptcha = captchaEnabled && !captchaToken

  // switch sign-up ↔ sign-in, clearing the error and forcing a fresh CAPTCHA challenge
  const switchTo = (m: 'signup' | 'signin') => {
    setMode(m)
    setError(null)
    if (captchaEnabled) {
      setCaptchaToken(null)
      setCaptchaNonce((n) => n + 1)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || needsCaptcha) return
    setBusy(true)
    setError(null)
    try {
      const token = captchaToken ?? undefined
      const err = await (isSignup ? signUp(email, password, token) : signIn(email, password, token))
      if (err) {
        setError(err)
        // the token (if any) was consumed by the attempt → force a fresh challenge before retrying
        if (captchaEnabled) {
          setCaptchaToken(null)
          setCaptchaNonce((n) => n + 1)
        }
      }
      // on success the auth store sets `email` (or `pending` for email confirmation), flipping AppShell
    } catch (e) {
      reportError(e, { scope: 'auth.submit', mode })
      setError('Something went wrong. Please check your connection and try again.')
      if (captchaEnabled) {
        setCaptchaToken(null)
        setCaptchaNonce((n) => n + 1)
      }
    } finally {
      setBusy(false)
    }
  }

  const tab = (m: 'signup' | 'signin', label: string) => (
    <button
      type="button"
      onClick={() => switchTo(m)}
      aria-pressed={mode === m}
      className={`flex-1 rounded-[10px] py-2.5 text-sm font-extrabold transition ${
        mode === m ? 'bg-gradient-blaze text-on-accent' : 'text-fg/50 active:text-fg/75'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="min-h-full flex flex-col animate-fade-in">
      {/* blaze hero — brand lockup on the orange gradient */}
      <div className="bg-gradient-blaze text-center px-6 pt-[76px] pb-14 safe-top">
        <BrandLogo size={74} />
        <h1 className="mt-[18px] font-display text-[34px] font-black uppercase tracking-[-0.02em] leading-[0.9] text-on-accent">
          {isSignup ? 'Daily Rep' : 'Welcome back'}
        </h1>
        <p className="mt-2 text-[12px] font-extrabold uppercase tracking-[0.16em] text-on-accent/70">
          {isSignup ? 'Strength, measured' : 'Pick up where you left off'}
        </p>
      </div>

      {/* form sheet — overlaps the hero */}
      <div className="flex-1 bg-bg rounded-t-[28px] -mt-[22px] px-[22px] pt-6 pb-8 safe-bottom">
        <div className="mx-auto w-full max-w-sm">
          {/* mode switch */}
          <div className="flex gap-1 rounded-[13px] bg-card border border-hairline/[0.08] p-1">
            {tab('signup', 'Create account')}
            {tab('signin', 'Sign in')}
          </div>

          {pending && (
            <div
              role="status"
              className="mt-4 rounded-xl bg-blaze/10 border border-blaze/30 px-4 py-3 text-sm text-blaze-label"
            >
              {pending}
            </div>
          )}

          <form onSubmit={submit} className="mt-4 space-y-4">
            <div>
              <label htmlFor="auth-email" className="block text-xs font-semibold text-fg/60 mb-1.5">
                Email
              </label>
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl bg-card border border-hairline/10 px-4 py-3.5 text-[15px] outline-none focus:border-blaze"
              />
            </div>
            <div>
              <label htmlFor="auth-password" className="block text-xs font-semibold text-fg/60 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  id="auth-password"
                  type={showPw ? 'text' : 'password'}
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isSignup ? 'At least 8 characters' : 'Your password'}
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

            {error && (
              <div role="alert" className="rounded-xl bg-rose-400/10 border border-rose-400/30 px-3 py-2.5 text-sm text-rose-300">
                {error}
              </div>
            )}

            {captchaEnabled && (
              <div className="pt-1">
                <TurnstileWidget key={captchaNonce} onToken={setCaptchaToken} />
              </div>
            )}

            <Button type="submit" variant="primary" size="lg" fullWidth disabled={busy || !email || !password || needsCaptcha}>
              {busy ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}
            </Button>
          </form>

          <button
            onClick={() => switchTo(isSignup ? 'signin' : 'signup')}
            className="w-full text-center text-sm text-fg/55 mt-4 py-2 active:text-fg/80"
          >
            {isSignup ? (
              <>Already have an account? <span className="font-bold text-blaze-label">Sign in</span></>
            ) : (
              <>New here? <span className="font-bold text-blaze-label">Create an account</span></>
            )}
          </button>

          {isSignup && (
            <p className="mt-2 text-center text-[11px] leading-snug text-fg/40">
              By creating an account you agree to our{' '}
              <a href="/terms" className="text-fg/65 underline">Terms</a> and{' '}
              <a href="/privacy" className="text-fg/65 underline">Privacy Policy</a>.
            </p>
          )}
          <p className="mt-3 text-center text-[11px] text-fg/35 leading-snug">
            Your workouts sync securely across all your devices.
          </p>
        </div>
      </div>
    </div>
  )
}
