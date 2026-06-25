'use client'

import { useEffect, useId, useRef } from 'react'
import { XIcon } from './icons'

interface SheetProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  /** full height vs auto */
  full?: boolean
}

export default function Sheet({ open, onClose, title, children, full }: SheetProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  // keep onClose in a ref so the effect doesn't re-run (and re-focus) on every parent render
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current()
        return
      }
      // keep Tab focus contained within the dialog
      if (e.key === 'Tab') {
        const panel = panelRef.current
        if (!panel) return
        const focusable = panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        if (focusable.length === 0) {
          e.preventDefault()
          panel.focus()
          return
        }
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || active === panel)) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    // move focus into the dialog, and restore it to the trigger on close. Prefer a focusable
    // input inside the panel (e.g. the exercise-picker search) so its autoFocus / the mobile
    // keyboard isn't stolen by focusing the bare panel div.
    const previouslyFocused = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const auto = panel?.querySelector<HTMLElement>(
      '[autofocus], input:not([disabled]):not([type=checkbox]):not([type=radio])',
    )
    ;(auto ?? panel)?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      // Only restore focus to the trigger if it's still in the DOM. When a sheet action closes the
      // sheet AND navigates (the trigger unmounts), focusing the now-detached node silently drops focus
      // to <body> — leaving keyboard/SR users stranded at the top. Skip it then and let the new view
      // own focus. `isConnected` is the cheap, synchronous "still attached?" check.
      if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus?.()
    }
  }, [open])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60 animate-fade-in" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'Dialog'}
        tabIndex={-1}
        className={`relative bg-card border-t border-hairline/[0.08] rounded-t-2xl animate-slide-up flex flex-col outline-none ${
          full ? 'h-[92vh]' : 'max-h-[88vh]'
        }`}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 shrink-0">
          <div className="absolute left-1/2 -translate-x-1/2 top-2 h-1 w-10 rounded-full bg-fg/20" />
          <h2 id={titleId} className="text-lg font-extrabold">
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 -mr-1.5 rounded-full bg-raised text-fg/70"
          >
            <XIcon size={18} />
          </button>
        </div>
        <div className="overflow-y-auto no-scrollbar px-5 pb-8 safe-bottom">{children}</div>
      </div>
    </div>
  )
}
