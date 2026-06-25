'use client'

import { useEffect } from 'react'
import { reportError } from '@/lib/telemetry'

// Route-level error boundary (renders inside the root layout, so the app chrome + CSS are available).
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    reportError(error, { scope: 'route-error-boundary', digest: error.digest })
  }, [error])

  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-6 animate-fade-in">
      <div className="text-4xl" aria-hidden>
        ⚠️
      </div>
      <h1 className="text-xl font-extrabold mt-3">Something went wrong</h1>
      <p className="text-sm text-fg/55 mt-1.5 max-w-xs leading-snug">
        An unexpected error occurred. Your workout data is safe on this device.
      </p>
      <button onClick={() => reset()} className="btn-primary mt-5">
        Try again
      </button>
    </div>
  )
}
