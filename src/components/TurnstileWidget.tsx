'use client'

import { useEffect, useRef } from 'react'
import { TURNSTILE_SITE_KEY } from '@/lib/captcha'

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id?: string) => void
  remove: (id: string) => void
}
declare global {
  // eslint-disable-next-line no-var
  interface Window {
    turnstile?: TurnstileApi
  }
}

/**
 * Renders the Cloudflare Turnstile widget when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set; renders nothing
 * otherwise (so dev/preview with no key is unaffected). Calls `onToken` with the solved token, or null
 * on expiry/error/timeout. No npm dependency — the Turnstile script is injected once and driven via the
 * explicit-render API. Remount (via a changing React `key`) to force a fresh challenge after a failed
 * attempt, since Turnstile tokens are single-use.
 */
export default function TurnstileWidget({ onToken }: { onToken: (token: string | null) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken // always call the latest callback without re-running the effect

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return
    let cancelled = false

    const renderWidget = () => {
      if (cancelled || widgetIdRef.current || !containerRef.current || !window.turnstile) return
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token: string) => onTokenRef.current(token),
        'error-callback': () => onTokenRef.current(null),
        'expired-callback': () => onTokenRef.current(null),
        'timeout-callback': () => onTokenRef.current(null),
      })
    }

    // track the script we attach the load listener to, so cleanup can remove it (a remount — via the
    // `key`-change for a fresh challenge — would otherwise pile another listener onto the shared script)
    let scriptEl: HTMLScriptElement | null = null
    if (window.turnstile) {
      renderWidget()
    } else {
      const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile]')
      if (existing) {
        scriptEl = existing
      } else {
        const s = document.createElement('script')
        s.src = SCRIPT_SRC
        s.async = true
        s.defer = true
        s.setAttribute('data-turnstile', '')
        document.head.appendChild(s)
        scriptEl = s
      }
      scriptEl.addEventListener('load', renderWidget)
    }

    return () => {
      cancelled = true
      scriptEl?.removeEventListener('load', renderWidget) // don't leak the load listener across remounts
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          /* widget already torn down — ignore */
        }
        widgetIdRef.current = null
      }
    }
  }, [])

  if (!TURNSTILE_SITE_KEY) return null
  return <div ref={containerRef} className="flex justify-center" />
}
