import { describe, it, expect } from 'vitest'
import { findPlaceholders } from '../../scripts/check-legal-placeholders.mjs'

describe('check:legal placeholder detection', () => {
  it('finds single-line bracket placeholders with the right line number', () => {
    const text = 'line one\n<p>owned by [Legal Entity].</p>\nline three'
    const hits = findPlaceholders(text)
    expect(hits).toEqual([{ line: 2, text: '[Legal Entity]' }])
  })

  it('finds a placeholder that spans multiple lines (the regression the line-by-line scan missed)', () => {
    const text = [
      '<h2>Subscriptions</h2>',
      '<p>',
      '  [If and when paid plans are offered: describe pricing, the billing cycle,',
      '  automatic renewal, and the refund policy.]',
      '</p>',
    ].join('\n')
    const hits = findPlaceholders(text)
    expect(hits).toHaveLength(1)
    expect(hits[0].line).toBe(3) // reported at the line where the bracket opens
    expect(hits[0].text).toMatch(/^\[If and when paid plans/)
  })

  it('flags TODO(legal) markers', () => {
    expect(findPlaceholders('// TODO(legal): fill me')).toEqual([{ line: 1, text: 'TODO(legal)' }])
  })

  it('returns nothing for fully-filled legal prose', () => {
    const text = '<p>owned by Daily Rep, Inc. and governed by the laws of California.</p>'
    expect(findPlaceholders(text)).toEqual([])
  })
})
