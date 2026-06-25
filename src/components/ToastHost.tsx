'use client'

import { useEffect, useRef, useState } from 'react'
import { subscribeToast, type ToastData } from '@/lib/toast'
import { CheckIcon, TrophyIcon } from '@/components/icons'

/** App-wide transient status messages. The outer wrapper is a persistent aria-live region so a
 *  screen reader announces each message; the visual pill slides in at the top and auto-dismisses.
 *  A toast may carry an action (e.g. Undo) — then it stays up longer and exposes a tap target. */
export default function ToastHost() {
  const [toast, setToast] = useState<{ id: number; data: ToastData } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const unsub = subscribeToast((data) => {
      setToast({ id: Date.now() + Math.random(), data })
      if (timer.current) clearTimeout(timer.current)
      // give an actionable toast (Undo) the most time to be tapped; let a PR linger a beat longer
      // than a plain status message so the celebration registers
      timer.current = setTimeout(() => setToast(null), data.action ? 5200 : data.tone === 'pr' ? 3800 : 2800)
    })
    return () => {
      unsub()
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const dismiss = () => {
    if (timer.current) clearTimeout(timer.current)
    setToast(null)
  }

  const action = toast?.data.action
  const isPR = toast?.data.tone === 'pr'
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center safe-top px-4"
    >
      {toast && (
        <div
          key={toast.id}
          role="status"
          className={`mt-3 flex items-center gap-2 rounded-full backdrop-blur py-2.5 text-sm font-medium text-fg shadow-lg animate-slide-down ${
            isPR ? 'bg-blaze/15 border border-blaze/40' : 'bg-card/95 border border-hairline/[0.12]'
          } ${action ? 'pointer-events-auto pl-4 pr-1.5' : 'px-4'}`}
        >
          {isPR ? (
            <TrophyIcon size={15} className="text-blaze-label shrink-0" strokeWidth={2} />
          ) : (
            <CheckIcon size={15} className="text-blaze-label shrink-0" strokeWidth={3} />
          )}
          <span>{toast.data.message}</span>
          {action && (
            <button
              onClick={() => {
                action.onAction()
                dismiss()
              }}
              className="ml-1 shrink-0 rounded-full bg-blaze/15 px-3 py-1 text-[13px] font-bold text-blaze-label active:scale-95 transition"
            >
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
