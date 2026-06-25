'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useStore } from '@/store/useStore'
import { useAuth } from '@/store/useAuth'
import { useEntitlement } from '@/store/useEntitlement'
import { loadRemotePlans } from '@/lib/plansRemote'
import { applyTheme } from '@/lib/theme'
import BottomNav from '@/components/BottomNav'
import RestTimerBar from '@/components/RestTimerBar'
import ErrorBoundary from '@/components/ErrorBoundary'
import ToastHost from '@/components/ToastHost'
import HomeSkeleton from '@/components/HomeSkeleton'
import { ConfirmProvider } from '@/components/ConfirmProvider'
import Onboarding from '@/screens/Onboarding'
import Auth from '@/screens/Auth'
import Paywall from '@/screens/Paywall'
import TrialStart from '@/screens/TrialStart'

/** Routes that render without the auth gate / app chrome (readable signed-out). */
const PUBLIC_ROUTES = ['/privacy', '/terms']

export default function AppShell({ children }: { children: React.ReactNode }) {
  // Gate on mount so persisted (localStorage) state can't cause a hydration
  // mismatch between the server-rendered HTML and the client's first paint.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const onboarded = useStore((s) => s.profile.onboarded)
  const trialWelcomeSeen = useStore((s) => s.profile.trialWelcomeSeen)
  const updateProfile = useStore((s) => s.updateProfile)
  const inTrial = useEntitlement((s) => s.inTrial)
  const signedInEmail = useAuth((s) => s.email)
  const localOnly = useAuth((s) => s.localOnly)
  const authReady = useAuth((s) => s.initialized)
  const initAuth = useAuth((s) => s.init)
  const entitlementLoading = useEntitlement((s) => s.loading)
  const entitled = useEntitlement((s) => s.entitled)
  const startEntitlement = useEntitlement((s) => s.start)
  const stopEntitlement = useEntitlement((s) => s.stop)
  const theme = useStore((s) => s.profile.theme)
  const accent = useStore((s) => s.profile.accent)
  const pathname = usePathname()

  // bootstrap cloud auth/session once (offline-first: resolves quickly to local mode if unconfigured)
  useEffect(() => {
    initAuth()
  }, [initAuth])

  // track subscription/trial entitlement while signed in; tear it down on sign-out
  useEffect(() => {
    if (signedInEmail) startEntitlement()
    else stopEntitlement()
  }, [signedInEmail, startEntitlement, stopEntitlement])

  // load any DB-managed plans over the bundled catalogue (public-read; no-ops offline/unconfigured)
  useEffect(() => {
    void loadRemotePlans()
  }, [])

  // keep the live theme/accent in sync with the user's choice (and OS changes when 'system')
  useEffect(() => {
    applyTheme(theme, accent)
    if (theme === 'light' || theme === 'dark') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme(theme, accent)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme, accent])

  // Public, un-gated routes: the legal pages must be readable BEFORE sign-up (and are required as
  // public URLs by the app stores / Stripe), so they bypass the auth gate, onboarding, and chrome.
  if (PUBLIC_ROUTES.includes(pathname)) {
    return <div className="mx-auto max-w-md min-h-full">{children}</div>
  }

  // wait for both hydration and the auth bootstrap so the gate doesn't flash the sign-in screen
  if (!mounted || !authReady) {
    return (
      <div className="mx-auto max-w-md min-h-full">
        <HomeSkeleton />
      </div>
    )
  }

  // gate behind sign-in until the user has a cloud session OR has chosen to continue locally
  if (!signedInEmail && !localOnly) {
    return (
      <ErrorBoundary>
        <div className="mx-auto max-w-md min-h-full">
          <Auth />
        </div>
      </ErrorBoundary>
    )
  }

  // Authenticated checkout return: bypasses the entitlement/onboarding gates so a just-paid user
  // (whose webhook hasn't landed yet) sees the "confirming → welcome" flow instead of the paywall.
  if (signedInEmail && pathname === '/checkout/return') {
    return (
      <ErrorBoundary>
        <div className="mx-auto max-w-md min-h-full">{children}</div>
      </ErrorBoundary>
    )
  }

  // Paid product: once signed in, require an active subscription or a live free trial. While the
  // entitlement resolves, hold on the skeleton (don't flash the paywall); a lapsed user gets the
  // paywall in place of the app. (localOnly dev builds have no cloud and skip this gate.)
  if (signedInEmail) {
    if (entitlementLoading) {
      return (
        <div className="mx-auto max-w-md min-h-full">
          <HomeSkeleton />
        </div>
      )
    }
    if (!entitled) {
      return (
        <ErrorBoundary>
          <div className="mx-auto max-w-md min-h-full">
            <Paywall />
          </div>
        </ErrorBoundary>
      )
    }
  }

  if (!onboarded) {
    return (
      <ErrorBoundary>
        <div className="mx-auto max-w-md min-h-full">
          <Onboarding />
        </div>
      </ErrorBoundary>
    )
  }

  // One-time, card-free "30 days free" welcome — shown once to a brand-new trialing user after
  // onboarding, then dismissed into the app (the trial is already active; no payment is taken here).
  if (signedInEmail && inTrial && !trialWelcomeSeen) {
    return (
      <ErrorBoundary>
        <div className="mx-auto max-w-md min-h-full">
          <TrialStart context="welcome" onDone={() => updateProfile({ trialWelcomeSeen: true })} />
        </div>
      </ErrorBoundary>
    )
  }

  const isSession = pathname === '/session' || pathname.startsWith('/session/')
  // full-screen, chrome-less app routes (manage their own height + safe areas). Settings SUBpages
  // (/settings/*) are pushed views with a back chevron — the hub at /settings keeps the tab bar.
  const hideChrome =
    isSession || pathname === '/subscribe' || pathname === '/checkout/return' || pathname.startsWith('/settings/')

  return (
    <ErrorBoundary>
      <ConfirmProvider>
        <div className="mx-auto max-w-md min-h-full relative">
          <main className={hideChrome ? '' : 'pb-24'}>{children}</main>
          <RestTimerBar />
          {!hideChrome && <BottomNav />}
          <ToastHost />
        </div>
      </ConfirmProvider>
    </ErrorBoundary>
  )
}
