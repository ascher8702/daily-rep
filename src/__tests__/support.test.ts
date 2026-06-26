import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '../lib/support'

describe('support contact', () => {
  it('uses the canonical hyphenated domain', () => {
    expect(SUPPORT_EMAIL).toBe('support@daily-rep.app')
    expect(SUPPORT_MAILTO).toBe('mailto:support@daily-rep.app')
  })

  it('no source file hardcodes the wrong (un-hyphenated) support domain', () => {
    const srcDir = join(__dirname, '..')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
          if (entry === '__tests__' || entry === 'node_modules') continue
          walk(full)
          continue
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue
        // The bug was the missing hyphen: `dailyrep.app` rather than `daily-rep.app`.
        if (/@dailyrep\.app/.test(readFileSync(full, 'utf8'))) offenders.push(full)
      }
    }
    walk(srcDir)
    expect(offenders).toEqual([])
  })
})
