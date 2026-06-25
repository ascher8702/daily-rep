'use client'

import { useEffect } from 'react'
import { reportError } from '@/lib/telemetry'

// Top-level safety net: catches crashes in the ROOT layout itself, where the normal error.tsx and the
// app's CSS bundle aren't available — so it renders its own <html>/<body> with inline styles (no
// dependency on AppShell or globals.css). Without this, a root crash shows Next's unbranded page.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    reportError(error, { scope: 'global-error-boundary', digest: error.digest })
  }, [error])
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          background: '#0b0f17',
          color: '#e7ecf3',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          <div style={{ fontSize: 40 }} aria-hidden>
            🏋️
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: '12px 0 6px' }}>Something went wrong</h1>
          <p style={{ color: '#9aa4b2', fontSize: 14, lineHeight: 1.5 }}>
            Daily Rep hit an unexpected error. Your workout data is safe on this device.
          </p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: 16,
              minHeight: 44,
              background: '#bef264',
              color: '#0b0f17',
              fontWeight: 700,
              border: 0,
              borderRadius: 12,
              padding: '0 22px',
              fontSize: 15,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
