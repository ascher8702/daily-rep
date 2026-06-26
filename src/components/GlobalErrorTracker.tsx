'use client'

import { useEffect } from 'react'
import { installGlobalErrorHandlers } from '@/lib/globalErrors'
import { hasTelemetrySink } from '@/lib/telemetry'

/**
 * Mounts the global `error` / `unhandledrejection` handlers (see lib/globalErrors) for the lifetime of
 * the app, so async + event-handler failures that bypass React error boundaries still reach the
 * telemetry seam. Renders nothing.
 *
 * When a telemetry backend is active (e.g. Sentry, which installs its own global handlers and captures
 * uncaught errors natively with full context), we yield to it to avoid double-reporting — the app's
 * explicit catch sites still route through reportError → the same backend.
 */
export default function GlobalErrorTracker() {
  useEffect(() => {
    if (hasTelemetrySink()) return
    return installGlobalErrorHandlers()
  }, [])
  return null
}
