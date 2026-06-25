import { describe, it, expect } from 'vitest'
import { CHARGE_BOLT_PATH } from '../components/BrandLogo'

describe('BrandLogo', () => {
  it('exports the Charge Bolt path exactly matching the design mark', () => {
    // guards the brand geometry against accidental edits (same path used by public/icon.svg)
    expect(CHARGE_BOLT_PATH).toBe('M58 8 L28 54 H46 L42 92 L74 42 H54 Z')
  })
})
