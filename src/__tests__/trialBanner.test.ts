import { describe, it, expect } from 'vitest'
import { shouldShowTrialBanner, TRIAL_BANNER_URGENT_DAYS } from '../lib/billing'

describe('shouldShowTrialBanner', () => {
  it('hides when not in trial regardless of dismissal', () => {
    expect(shouldShowTrialBanner(false, 30, null)).toBe(false)
    expect(shouldShowTrialBanner(false, 1, null)).toBe(false)
  })

  it('shows in trial when never dismissed', () => {
    expect(shouldShowTrialBanner(true, 30, null)).toBe(true)
    expect(shouldShowTrialBanner(true, 1, null)).toBe(true)
  })

  it('stays hidden after dismissal outside the urgent window', () => {
    // Dismissed at 30 days; still well outside the urgent window at 5 days → hidden.
    expect(shouldShowTrialBanner(true, 5, 30)).toBe(false)
  })

  it('re-appears once the trial enters the urgent window after an outside-window dismissal', () => {
    // Dismissed at 30 days; now 2 days left (urgent) → last-chance reminder returns.
    expect(shouldShowTrialBanner(true, 2, 30)).toBe(true)
  })

  it('stays hidden when re-dismissed inside the urgent window', () => {
    // Re-dismissed at 2 days, still 2 days left → the X sticks.
    expect(shouldShowTrialBanner(true, 2, 2)).toBe(false)
    // And on the genuine last day after that re-dismiss.
    expect(shouldShowTrialBanner(true, 1, 2)).toBe(false)
  })

  it('honors the urgent-day boundary (<= 2 reappears, 3 does not)', () => {
    expect(TRIAL_BANNER_URGENT_DAYS).toBe(2)
    // Dismissed outside the window (30); exactly at the boundary (2) → reappears.
    expect(shouldShowTrialBanner(true, 2, 30)).toBe(true)
    // One day above the boundary (3) → still hidden.
    expect(shouldShowTrialBanner(true, 3, 30)).toBe(false)
  })
})
