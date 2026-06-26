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
  const signInWithProvider = useAuth((s) => s.signInWithProvider)
  const signInWithMagicLink = useAuth((s) => s.signInWithMagicLink)
  const resetPassword = useAuth((s) => s.resetPassword)
  const pending = useAuth((s) => s.pending)

  // default to Sign in (returning users are the common case); new users tap "Create account"
  const [mode, setMode] = useState<'signup' | 'signin'>('signin')
  // 'auth' = the sign-in/up sheet; 'reset' = the "forgot password" email-a-link panel
  const [view, setView] = useState<'auth' | 'reset'>('auth')
  const [resetSent, setResetSent] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [linkBusy, setLinkBusy] = useState(false)
  const [socialBusy, setSocialBusy] = useState<'google' | 'apple' | null>(null)
  // CAPTCHA (only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set). `nonce` bumps to remount the widget for
  // a fresh challenge after a failed attempt, since Turnstile tokens are single-use.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaNonce, setCaptchaNonce] = useState(0)

  const isSignup = mode === 'signup'
  const isReset = view === 'reset'
  const needsCaptcha = captchaEnabled && !captchaToken

  const freshCaptcha = () => {
    if (captchaEnabled) {
      setCaptchaToken(null)
      setCaptchaNonce((n) => n + 1)
    }
  }

  // switch sign-up ↔ sign-in, clearing the error and forcing a fresh CAPTCHA challenge
  const switchTo = (m: 'signup' | 'signin') => {
    setMode(m)
    setError(null)
    freshCaptcha()
  }

  // open / leave the "forgot password" panel, resetting its transient state + the CAPTCHA challenge
  const openReset = () => {
    setView('reset')
    setResetSent(false)
    setError(null)
    freshCaptcha()
  }
  const backToSignIn = () => {
    setView('auth')
    setMode('signin')
    setResetSent(false)
    setError(null)
    freshCaptcha()
  }

  const sendReset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || needsCaptcha) return
    setBusy(true)
    setError(null)
    try {
      const err = await resetPassword(email, captchaToken ?? undefined)
      if (err) {
        setError(err)
        freshCaptcha()
      } else {
        // Supabase never reveals whether the address exists → always show the same generic confirmation
        setResetSent(true)
      }
    } catch (e) {
      reportError(e, { scope: 'auth.reset' })
      setError('Something went wrong. Please check your connection and try again.')
      freshCaptcha()
    } finally {
      setBusy(false)
    }
  }

  // Passwordless sign-in — emails a magic link; the success notice surfaces via the `pending` banner.
  const sendMagicLink = async () => {
    if (busy || linkBusy || needsCaptcha) return
    if (!email) {
      setError('Enter your email first')
      return
    }
    setLinkBusy(true)
    setError(null)
    try {
      const err = await signInWithMagicLink(email, captchaToken ?? undefined)
      if (err) setError(err)
      // the token (if any) was consumed → force a fresh challenge before the next attempt
      freshCaptcha()
    } catch (e) {
      reportError(e, { scope: 'auth.magicLink' })
      setError('Couldn’t send the link. Please try again.')
      freshCaptcha()
    } finally {
      setLinkBusy(false)
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

  // OAuth sign-in — clicking redirects to the provider; we only land back here on an error.
  const social = async (provider: 'google' | 'apple') => {
    if (busy || socialBusy) return
    setSocialBusy(provider)
    setError(null)
    try {
      const err = await signInWithProvider(provider)
      if (err) {
        setError(err)
        setSocialBusy(null)
      }
      // success → the browser is redirecting; keep the spinner state until it navigates away
    } catch (e) {
      reportError(e, { scope: 'auth.social', mode })
      setError('Couldn’t start sign-in. Please try again.')
      setSocialBusy(null)
    }
  }

  const providerBtn = (provider: 'google' | 'apple', label: string, dark: boolean, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => social(provider)}
      disabled={busy || socialBusy !== null}
      className={`w-full inline-flex items-center justify-center gap-2.5 rounded-xl py-3.5 text-[15px] font-extrabold transition active:scale-[0.99] disabled:opacity-50 ${
        dark ? 'bg-fg text-bg' : 'bg-card border border-hairline/[0.12] text-fg'
      }`}
    >
      {socialBusy === provider ? (
        'Connecting…'
      ) : (
        <>
          {icon}
          {label}
        </>
      )}
    </button>
  )

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
          {isReset ? 'Reset password' : isSignup ? 'Daily Rep' : 'Welcome back'}
        </h1>
        <p className="mt-2 text-[12px] font-extrabold uppercase tracking-[0.16em] text-on-accent/70">
          {isReset ? "We'll email you a link" : isSignup ? 'Strength, measured' : 'Pick up where you left off'}
        </p>
      </div>

      {/* form sheet — overlaps the hero */}
      <div className="flex-1 bg-bg rounded-t-[28px] -mt-[22px] px-[22px] pt-6 pb-8 safe-bottom">
        <div className="mx-auto w-full max-w-sm">
          {isReset ? (
            <div className="mt-2 animate-fade-in">
              {resetSent ? (
                <>
                  <div role="status" className="rounded-2xl bg-blaze/10 border border-blaze/30 px-4 py-4 text-sm text-fg/80 leading-relaxed">
                    If an account exists for <span className="font-bold text-fg">{email}</span>, we&rsquo;ve sent a link to reset your password. Check your inbox &mdash; and your spam folder.
                  </div>
                  <Button type="button" variant="secondary" size="lg" fullWidth className="mt-4" onClick={backToSignIn}>
                    Back to sign in
                  </Button>
                  <button onClick={() => { setResetSent(false); freshCaptcha() }} className="w-full text-center text-sm text-fg/55 mt-3 py-2 active:text-fg/80">
                    Didn&rsquo;t get it? <span className="font-bold text-blaze-label">Try again</span>
                  </button>
                </>
              ) : (
                <form onSubmit={sendReset} className="space-y-4">
                  <p className="text-sm text-fg/60 leading-relaxed">
                    Enter the email for your account and we&rsquo;ll send you a link to set a new password.
                  </p>
                  <div>
                    <label htmlFor="reset-email" className="block text-xs font-semibold text-fg/60 mb-1.5">Email</label>
                    <input
                      id="reset-email"
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full rounded-xl bg-card border border-hairline/10 px-4 py-3.5 text-[15px] outline-none focus:border-blaze"
                    />
                  </div>
                  {captchaEnabled && (
                    <div className="pt-1">
                      <TurnstileWidget key={captchaNonce} onToken={setCaptchaToken} />
                    </div>
                  )}
                  {error && (
                    <div role="alert" className="rounded-xl bg-rose-400/10 border border-rose-400/30 px-3 py-2.5 text-sm text-rose-300">
                      {error}
                    </div>
                  )}
                  <Button type="submit" variant="primary" size="lg" fullWidth disabled={busy || !email || needsCaptcha}>
                    {busy ? 'Sending…' : 'Send reset link'}
                  </Button>
                  <button type="button" onClick={backToSignIn} className="w-full text-center text-sm text-fg/55 py-1 active:text-fg/80">
                    Remembered it? <span className="font-bold text-blaze-label">Back to sign in</span>
                  </button>
                </form>
              )}
            </div>
          ) : (
          <>
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

          {/* social sign-in (Google / Apple via Supabase OAuth) */}
          <div className="mt-4 space-y-2.5">
            {providerBtn(
              'apple',
              'Continue with Apple',
              true,
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M16.4 12.8c0-2.2 1.8-3.3 1.9-3.4-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.6.8-3.3.8s-1.7-.8-2.8-.8c-1.4 0-2.8.8-3.5 2.1-1.5 2.6-.4 6.5 1.1 8.6.7 1 1.5 2.2 2.6 2.1 1-.04 1.4-.7 2.7-.7s1.6.7 2.7.66c1.1-.02 1.8-1 2.5-2 .5-.8.8-1.5.8-1.6 0-.01-2.3-.9-2.3-3.36zM14.3 6.3c.6-.7 1-1.7.9-2.7-.9.04-1.9.6-2.5 1.3-.5.6-1 1.6-.9 2.6 1 .08 1.9-.5 2.5-1.2z" />
              </svg>,
            )}
            {providerBtn(
              'google',
              'Continue with Google',
              false,
              <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.5 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-2 3.2-4.9 3.2-7.9z" />
                <path fill="#34A853" d="M12 23c2.9 0 5.4-1 7.2-2.6l-3.6-2.7c-1 .7-2.3 1.1-3.6 1.1-2.8 0-5.2-1.9-6-4.4H2.3v2.8A11 11 0 0 0 12 23z" />
                <path fill="#FBBC05" d="M6 14.3a6.6 6.6 0 0 1 0-4.2V7.3H2.3a11 11 0 0 0 0 9.8z" />
                <path fill="#EA4335" d="M12 5.4c1.6 0 3 .5 4.1 1.6l3.1-3.1A11 11 0 0 0 2.3 7.3L6 10.1c.9-2.6 3.3-4.5 6-4.5z" />
              </svg>,
            )}
          </div>

          {/* shared error (covers both social + email/password) */}
          {error && (
            <div role="alert" className="mt-3 rounded-xl bg-rose-400/10 border border-rose-400/30 px-3 py-2.5 text-sm text-rose-300">
              {error}
            </div>
          )}

          {/* divider */}
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-hairline/[0.08]" />
            <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-fg/35">or</span>
            <div className="flex-1 h-px bg-hairline/[0.08]" />
          </div>

          <form onSubmit={submit} className="space-y-4">
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

            {!isSignup && (
              <div className="-mt-1.5 flex justify-end">
                <button type="button" onClick={openReset} className="text-[13px] font-semibold text-blaze-label active:opacity-80 py-1">
                  Forgot password?
                </button>
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

          {!isSignup && (
            <button
              type="button"
              onClick={sendMagicLink}
              disabled={linkBusy || busy || needsCaptcha}
              className="w-full text-center text-[13.5px] font-semibold text-fg/60 mt-3 py-2 active:text-fg/85 disabled:opacity-50"
            >
              {linkBusy ? 'Sending link…' : <>Or <span className="text-blaze-label font-bold">email me a sign-in link</span></>}
            </button>
          )}

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
          </>
          )}
        </div>
      </div>
    </div>
  )
}
