'use client'

import { useRouter } from 'next/navigation'
import { useEntitlement } from '@/store/useEntitlement'
import { FlameIcon, ChevronRight } from '@/components/icons'

/**
 * Slim free-trial nudge for the Home screen. Renders only while the user is on the card-free trial and
 * hasn't subscribed yet; tapping it opens Settings → Membership to choose a plan. Hidden once they
 * subscribe (or after the trial lapses, when the AppShell paywall takes over instead).
 */
export default function TrialBanner() {
  const router = useRouter()
  const inTrial = useEntitlement((s) => s.inTrial)
  const daysLeft = useEntitlement((s) => s.trialDaysLeft)

  if (!inTrial) return null

  // `trialDaysLeft` is ceil()'d and `inTrial` implies > 0, so the final day reads as "Last day".
  const headline =
    daysLeft <= 1 ? 'Last day of your free trial' : `${daysLeft} days left in your free trial`

  return (
    <button
      onClick={() => router.push('/subscribe')}
      className="w-full flex items-center gap-3 rounded-2xl border border-blaze/30 bg-blaze/10 px-4 py-3 text-left active:scale-[0.99] transition"
    >
      <span className="grid place-items-center h-9 w-9 rounded-full bg-blaze/15 text-blaze-label shrink-0">
        <FlameIcon size={18} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{headline}</div>
        <div className="text-xs text-fg/50">Subscribe to keep your training after the trial.</div>
      </div>
      <span className="shrink-0 inline-flex items-center gap-0.5 text-xs font-bold text-blaze-label">
        Subscribe <ChevronRight size={14} />
      </span>
    </button>
  )
}
