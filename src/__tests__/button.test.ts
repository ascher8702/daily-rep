import { describe, it, expect } from 'vitest'
import { buttonClasses, cx } from '../components/ui/Button'

describe('cx (class join)', () => {
  it('joins truthy fragments and drops falsy ones', () => {
    expect(cx('a', false, null, undefined, 'b')).toBe('a b')
    expect(cx()).toBe('')
  })
})

describe('buttonClasses (Blaze Button variant/size mapping)', () => {
  it('primary is the orange gradient action identity (token-driven, AA text)', () => {
    const c = buttonClasses('primary')
    expect(c).toContain('bg-gradient-blaze') // orange gradient fill
    expect(c).toContain('text-on-accent') // near-black text for AA on the fill
    expect(c).toContain('shadow-button')
    expect(c).toContain('uppercase')
    expect(c).toContain('font-black')
    // never a hard-coded hex
    expect(c).not.toMatch(/#[0-9a-f]{3,6}/i)
  })

  it('secondary is a neutral raised surface, not the orange action color', () => {
    const c = buttonClasses('secondary')
    expect(c).toContain('bg-raised')
    expect(c).toContain('text-fg')
    expect(c).not.toContain('bg-gradient-blaze')
    expect(c).not.toContain('uppercase')
  })

  it('ghost is transparent / low-emphasis', () => {
    const c = buttonClasses('ghost')
    expect(c).toContain('bg-transparent')
    expect(c).not.toContain('bg-gradient-blaze')
  })

  it('size md vs sm swap padding/text scale', () => {
    expect(buttonClasses('primary', 'md')).toContain('py-3.5')
    expect(buttonClasses('primary', 'sm')).toContain('text-sm')
    expect(buttonClasses('primary', 'sm')).not.toContain('py-3.5')
  })

  it('fullWidth adds w-full only when requested', () => {
    expect(buttonClasses('primary', 'md', true)).toContain('w-full')
    expect(buttonClasses('primary', 'md', false)).not.toContain('w-full')
  })

  it('always carries the shared base (focus ring + tap feedback) and appends caller className last', () => {
    const c = buttonClasses('primary', 'md', false, 'mt-5')
    expect(c).toContain('focus-visible:ring-blaze')
    expect(c).toContain('active:scale-[0.98]')
    expect(c.endsWith('mt-5')).toBe(true)
  })

  it('defaults to primary/md when called with no args', () => {
    expect(buttonClasses()).toContain('bg-gradient-blaze')
    expect(buttonClasses()).toContain('py-3.5')
  })
})
