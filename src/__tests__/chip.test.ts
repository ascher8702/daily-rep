import { describe, it, expect } from 'vitest'
import { chipClass, CHIP_VARIANT } from '../components/ui/Chip'

describe('chipClass (Blaze Chip variant → token mapping)', () => {
  it('solid is the orange gradient fill with AA text', () => {
    expect(chipClass('solid')).toContain('bg-gradient-blaze')
    expect(chipClass('solid')).toContain('text-on-accent')
  })
  it('accent is an orange tint, recovery is a lime tint, neutral is raised', () => {
    expect(chipClass('accent')).toContain('bg-blaze/[0.12]')
    expect(chipClass('accent')).toContain('text-blaze-label')
    expect(chipClass('recovery')).toContain('recovery-fresh')
    expect(chipClass('neutral')).toContain('bg-raised')
  })
  it('no variant uses a hard-coded hex (token-driven)', () => {
    for (const v of Object.values(CHIP_VARIANT)) {
      expect(v).not.toMatch(/#[0-9a-f]{3,6}/i)
    }
  })
})
