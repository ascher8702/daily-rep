import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { KeyboardEvent } from 'react'
import { radioKeyDown } from '../lib/a11y'

// radioKeyDown reads document.activeElement and calls focus()/click() on DOM nodes. We mock
// just that surface (no jsdom): a focusable stub whose focus() updates a shared activeElement.
type Radio = { i: number; clicked: boolean; focus: () => void; click: () => void }

let active: Radio | null = null

function group(n: number, checkedIdx: number) {
  const radios: Radio[] = Array.from({ length: n }, (_, i) => {
    const el: Radio = {
      i,
      clicked: false,
      focus() {
        active = el
      },
      click() {
        el.clicked = true
      },
    }
    return el
  })
  active = radios[checkedIdx]
  const currentTarget = { querySelectorAll: () => radios } as unknown as HTMLDivElement
  return { radios, currentTarget }
}

function press(key: string, currentTarget: HTMLDivElement): KeyboardEvent<HTMLDivElement> {
  return { key, currentTarget, preventDefault() {} } as unknown as KeyboardEvent<HTMLDivElement>
}

beforeEach(() => {
  ;(globalThis as { document?: unknown }).document = {
    get activeElement() {
      return active
    },
  }
})
afterEach(() => {
  delete (globalThis as { document?: unknown }).document
  active = null
})

describe('radioKeyDown — radiogroup arrow-key navigation', () => {
  it('ArrowDown / ArrowRight move focus and selection to the next radio', () => {
    const { radios, currentTarget } = group(3, 0)
    radioKeyDown(press('ArrowDown', currentTarget))
    expect(active).toBe(radios[1])
    expect(radios[1].clicked).toBe(true)
  })

  it('ArrowUp from the first radio wraps to the last', () => {
    const { radios, currentTarget } = group(3, 0)
    radioKeyDown(press('ArrowUp', currentTarget))
    expect(active).toBe(radios[2])
    expect(radios[2].clicked).toBe(true)
  })

  it('ArrowDown from the last radio wraps to the first', () => {
    const { radios, currentTarget } = group(3, 2)
    radioKeyDown(press('ArrowRight', currentTarget))
    expect(active).toBe(radios[0])
    expect(radios[0].clicked).toBe(true)
  })

  it('ignores non-arrow keys (no focus move, no selection)', () => {
    const { radios, currentTarget } = group(3, 1)
    radioKeyDown(press('Tab', currentTarget))
    radioKeyDown(press('Enter', currentTarget))
    expect(active).toBe(radios[1])
    expect(radios.some((r) => r.clicked)).toBe(false)
  })

  it('is a safe no-op for an empty group', () => {
    const currentTarget = { querySelectorAll: () => [] } as unknown as HTMLDivElement
    expect(() => radioKeyDown(press('ArrowDown', currentTarget))).not.toThrow()
  })
})
