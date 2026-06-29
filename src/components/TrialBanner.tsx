'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useEntitlement } from '@/store/useEntitlement'
import { FlameIcon, XIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import {
  readTrialBannerDismissal,
  shouldShowTrialBanner,
  writeTrialBannerDismissal,
} from '@/lib/billing'

/**
 * Slim free-trial nudge for the Home screen. Renders only while the user is on the card-free trial and
 * hasn't subscribed yet; tapping it opens Settings → Membership to choose a plan. Hidden once they
 * subscribe (or after the trial lapses, when the AppShell paywall takes over instead).
 *
 * Dismissible: tapping the X hides it. A dismissal made outside the final-window re-asserts once the trial
 * reaches its last few days (a last-chance urgency reminder); a dismissal made inside that window sticks.
 * The dismissal marker is a per-DEVICE preference (localStorage), not part of the synced store.
 */
export default function TrialBanner() {
  const router = useRouter()
  const inTrial = useEntitlement((s) => s.inTrial)
  const daysLeft = useEntitlement((s) => s.trialDaysLeft)

  // `undefined` = not yet read from localStorage. Reading in an effect keeps SSR/first-client render
  // identical (no hydration mismatch) and avoids a show-then-hide flash before the marker is known.
  const [dismissedAtDaysLeft, setDismissedAtDaysLeft] = useState<number | null | undefined>(undefined)

  useEffect(() => {
    setDismissedAtDaysLeft(readTrialBannerDismissal())
  }, [])

  // Hold the render until we've read the persisted dismissal.
  if (dismissedAtDaysLeft === undefined) return null

  if (!shouldShowTrialBanner(inTrial, daysLeft, dismissedAtDaysLeft)) return null

  // `trialDaysLeft` is ceil()'d and `inTrial` implies > 0, so the final day reads as "Last day".
  const headline =
    daysLeft <= 1 ? 'Last day of your free trial' : `${daysLeft} days left in your free trial`

  const dismiss = () => {
    writeTrialBannerDismissal(daysLeft)
    setDismissedAtDaysLeft(daysLeft)
  }

  return (
    <div className="relative w-full rounded-2xl border border-blaze/30 bg-blaze/10 px-4 py-3.5">
      {/* Icon + copy. `pr-9` keeps the headline clear of the corner dismiss button. */}
      <div className="flex items-start gap-3 pr-9">
        <span className="grid place-items-center h-9 w-9 rounded-full bg-blaze/15 text-blaze-label shrink-0">
          <FlameIcon size={18} />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-snug">{headline}</div>
          <div className="mt-0.5 text-xs text-fg/50">Keep your full training access after the trial ends.</div>
        </div>
      </div>

      {/* Subscribe — primary CTA, full-width along the bottom. */}
      <Button
        variant="primary"
        size="sm"
        fullWidth
        onClick={() => router.push('/subscribe')}
        className="mt-3"
      >
        Subscribe
      </Button>

      {/* Dismiss — absolute top-right corner. */}
      <button
        onClick={dismiss}
        aria-label="Dismiss trial reminder"
        className="absolute top-1 right-1 z-10 grid place-items-center h-10 w-10 rounded-full text-fg/45 active:text-fg/75 transition"
      >
        <XIcon size={16} />
      </button>
    </div>
  )
}
