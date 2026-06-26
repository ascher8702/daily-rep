'use client'

import { useEffect } from 'react'
import { installGlobalErrorHandlers } from '@/lib/globalErrors'

/**
 * Mounts the global `error` / `unhandledrejection` handlers (see lib/globalErrors) for the lifetime of
 * the app, so async + event-handler failures that bypass React error boundaries still reach the
 * telemetry seam. Renders nothing.
 */
export default function GlobalErrorTracker() {
  useEffect(() => installGlobalErrorHandlers(), [])
  return null
}
