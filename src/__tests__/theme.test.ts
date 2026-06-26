import { describe, it, expect } from 'vitest'
import { ACCENTS, DEFAULT_ACCENT, accentDef, accentVars } from '../lib/theme'

describe('theme accent → brand', () => {
  it('defaults the brand to orange (so the out-of-box look is unchanged)', () => {
    expect(DEFAULT_ACCENT).toBe('orange')
    expect(accentDef(undefined).id).toBe('orange') // unknown/missing falls back to the default brand
    expect(accentDef('nope').id).toBe('orange')
  })

  it('drives the whole brand ramp from the chosen accent fill (not just --accent)', () => {
    const orange = ACCENTS.find((a) => a.id === 'orange')!
    const v = accentVars('orange', true)
    // the brand fill + legacy accent var both follow the accent
    expect(v['--accent']).toBe(orange.dark)
    expect(v['--color-accent']).toBe(orange.dark)
    expect(v['--color-on-accent']).toBe(orange.onDark)
    // gradient endpoints are derived (deeper start, lighter end) and differ from the flat fill
    expect(v['--color-accent-hot']).not.toBe(orange.dark)
    expect(v['--color-accent-warm']).not.toBe(orange.dark)
    // dark-mode label is lightened off the fill for AA text on dark surfaces
    expect(v['--color-accent-label']).not.toBe(orange.dark)
  })

  it('switching the accent changes the brand fill', () => {
    const blue = ACCENTS.find((a) => a.id === 'blue')!
    const v = accentVars('blue', true)
    expect(v['--color-accent']).toBe(blue.dark)
    expect(v['--color-accent']).not.toBe(ACCENTS.find((a) => a.id === 'orange')!.dark)
  })

  it('uses the deeper light fill + white on-accent in light mode', () => {
    const violet = ACCENTS.find((a) => a.id === 'violet')!
    const v = accentVars('violet', false)
    expect(v['--color-accent']).toBe(violet.light)
    expect(v['--color-on-accent']).toBe(violet.onLight)
    expect(v['--color-on-accent']).toBe('255 255 255')
    // the light fill is already AA on white, so the label equals it (no extra lightening)
    expect(v['--color-accent-label']).toBe(violet.light)
  })

  it('every accent defines a full fill/on pair for both modes', () => {
    for (const a of ACCENTS) {
      for (const t of [a.dark, a.light, a.onDark, a.onLight]) {
        expect(t).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/) // valid "r g b" triple
      }
    }
  })
})
