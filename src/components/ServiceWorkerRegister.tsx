'use client'

import { useEffect } from 'react'
import { emitToast } from '@/lib/toast'

/**
 * Registers the service worker (public/sw.js) so the installed PWA loads offline, and surfaces a
 * "new version — reload" prompt when a deploy ships a new worker. Production-only — registering in dev
 * would cache dev assets and fight HMR. Renders nothing.
 *
 * Update flow: a new worker installs and WAITS (sw.js no longer auto-skipWaiting). When a waiting
 * worker exists while a controller already drives the page (i.e. an update, not a first install), we
 * toast a "Reload" action → postMessage SKIP_WAITING → the worker activates + claims the page →
 * `controllerchange` → reload once. This moves a returning user off a stale shell (whose hashed chunk
 * refs a deploy may have purged → ChunkLoadError) only on their consent, so a deploy never reloads the
 * page mid-action. The reload is gated on `accepted` so the `controllerchange` that fires from
 * `clients.claim()` on the FIRST install doesn't reload the page out from under a brand-new visitor.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    let accepted = false
    let reloading = false

    const onControllerChange = () => {
      if (!accepted || reloading) return // ignore the first-install claim; only reload on user consent
      reloading = true
      window.location.reload()
    }

    const promptUpdate = (worker: ServiceWorker) => {
      emitToast('A new version is ready', {
        label: 'Reload',
        onAction: () => {
          accepted = true
          worker.postMessage({ type: 'SKIP_WAITING' })
        },
      })
    }

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js')

        // A worker that installed on a prior visit and is still waiting (last prompt missed/dismissed).
        if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting)

        reg.addEventListener('updatefound', () => {
          const installing = reg.installing
          if (!installing) return
          installing.addEventListener('statechange', () => {
            // A new worker finished installing while an old one controls the page → an update is ready.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              promptUpdate(installing)
            }
          })
        })
      } catch {
        /* registration failures are non-fatal — the app still works online */
      }
    }

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    window.addEventListener('load', register)
    return () => {
      window.removeEventListener('load', register)
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])
  return null
}
