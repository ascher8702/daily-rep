import { describe, it, expect } from 'vitest'
import { ACCENTS, DEFAULT_ACCENT, accentDef, accentVars } from '../lib/theme'

describe('theme accent → brand', () => {
  it('defaults the brand to the original Blaze (so the out-of-box look is unchanged)', () => {
    expect(DEFAULT_ACCENT).toBe('blaze')
    expect(accentDef(undefined).id).toBe('blaze') // unknown/missing falls back to the default brand
    expect(accentDef('nope').id).toBe('blaze')
  })

  it('Blaze reproduces the original red-orange → orange gradient exactly', () => {
    const v = accentVars('blaze', true)
    expect(v['--color-accent']).toBe('255 90 44') // #FF5A2C fill
    expect(v['--color-accent-hot']).toBe('255 77 46') // #FF4D2E
    expect(v['--color-accent-warm']).toBe('255 122 30') // #FF7A1E
    expect(v['--color-on-accent']).toBe('26 10 4')
  })

  it('every accent has a real two-hue gradient (hot ≠ warm ≠ fill) in dark mode', () => {
    for (const a of ACCENTS) {
      const v = accentVars(a.id, true)
      expect(v['--color-accent-hot']).not.toBe(v['--color-accent-warm']) // it's a gradient, not flat
      expect(v['--color-accent']).toBe(a.dark)
      expect(v['--color-accent-hot']).toBe(a.hotDark)
      expect(v['--color-accent-warm']).toBe(a.warmDark)
    }
  })

  it('switching the accent changes the brand fill + gradient', () => {
    const blaze = accentVars('blaze', true)
    const blue = accentVars('blue', true)
    expect(blue['--color-accent']).not.toBe(blaze['--color-accent'])
    expect(blue['--color-accent-hot']).not.toBe(blaze['--color-accent-hot'])
  })

  it('light mode keeps both gradient stops deep (derived from the AA-safe light fill) + white on-fill text', () => {
    const v = accentVars('violet', false)
    const violet = ACCENTS.find((a) => a.id === 'violet')!
    expect(v['--color-accent']).toBe(violet.light)
    expect(v['--color-on-accent']).toBe('255 255 255')
    // both endpoints derive from the deep light fill, not the vivid dark gradient
    expect(v['--color-accent-hot']).not.toBe(violet.hotDark)
    expect(v['--color-accent-warm']).not.toBe(violet.warmDark)
  })

  it('every accent defines valid "r g b" triples for fills, gradient stops and on-fill text', () => {
    const triple = /^\d{1,3} \d{1,3} \d{1,3}$/
    for (const a of ACCENTS) {
      for (const t of [a.dark, a.light, a.hotDark, a.warmDark, a.onDark, a.onLight]) {
        expect(t).toMatch(triple)
      }
    }
  })
})
