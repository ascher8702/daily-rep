'use client'

import { createContext, useCallback, useContext, useState } from 'react'
import Sheet from './Sheet'

export interface ConfirmOptions {
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 'danger' uses a red primary button for destructive/irreversible actions */
  tone?: 'default' | 'danger'
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn>(async () => false)

/** Themed replacement for window.confirm — `const ok = await confirm({ title, body, tone })`. */
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext)
}

interface ConfirmReq {
  id: number
  opts: ConfirmOptions
  resolve: (v: boolean) => void
}

let reqId = 0

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  // a QUEUE, not a single slot: a second confirm() opened while one is pending must not overwrite
  // (and orphan the promise of) the first — they show one after another and each promise resolves
  const [queue, setQueue] = useState<ConfirmReq[]>([])

  const confirm = useCallback<ConfirmFn>(
    (opts) =>
      new Promise<boolean>((resolve) => {
        reqId += 1
        const req: ConfirmReq = { id: reqId, opts, resolve }
        setQueue((q) => [...q, req])
      }),
    [],
  )

  const settle = (value: boolean) => {
    setQueue((q) => {
      const [head, ...rest] = q
      head?.resolve(value) // Promise.resolve is idempotent, so a StrictMode double-invoke is safe
      return rest
    })
  }

  const head = queue[0]
  const opts = head?.opts
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Sheet open={!!head} onClose={() => settle(false)} title={opts?.title ?? ''}>
        {opts && (
          <div key={head.id} className="pt-1">
            {opts.body && <p className="text-[15px] leading-snug text-fg/70">{opts.body}</p>}
            <div className="mt-5 flex flex-col gap-2.5">
              <button
                onClick={() => settle(true)}
                className={`btn-primary w-full ${opts.tone === 'danger' ? '!bg-red-500 !text-white' : ''}`}
                autoFocus
              >
                {opts.confirmLabel ?? 'Confirm'}
              </button>
              <button onClick={() => settle(false)} className="btn-ghost w-full">
                {opts.cancelLabel ?? 'Cancel'}
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </ConfirmContext.Provider>
  )
}
