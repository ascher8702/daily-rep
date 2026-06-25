import type { KeyboardEvent } from 'react'

/**
 * Arrow-key navigation for a WAI-ARIA `role="radiogroup"`: move focus to the
 * next/previous `role="radio"` and select it (so the group behaves like a native
 * radio group under the keyboard). Pair this with roving tabindex on the options
 * (`tabIndex={checked ? 0 : -1}`) so the group is a single Tab stop.
 */
export function radioKeyDown(e: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(e.key)) return
  e.preventDefault()
  const radios = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'))
  if (radios.length === 0) return
  const idx = radios.indexOf(document.activeElement as HTMLElement)
  const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1
  const next = radios[((idx === -1 ? 0 : idx) + dir + radios.length) % radios.length]
  next?.focus()
  next?.click()
}
