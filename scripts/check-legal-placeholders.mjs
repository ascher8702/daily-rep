#!/usr/bin/env node
/**
 * Fails if the legal pages still contain unfilled placeholders. The Privacy Policy and Terms ship with
 * `[Legal Entity]`, `[Jurisdiction]`, `[13/16]`-style tokens, multi-line `[If and when paid plans … ]`
 * blocks, and `TODO(legal)` markers that counsel must resolve before the app charges money or is
 * submitted to the app stores.
 *
 * Usage: `node scripts/check-legal-placeholders.mjs` (exit 1 = placeholders remain).
 * Wired into CI as an ADVISORY step today; BLOCKING pre-deploy gate at go-live (the Vercel build runs
 * it before `pnpm build`, and docs/runbook-deploy.md lists it as a required gate). Run via `pnpm check:legal`.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// A bracketed token starting with a letter or digit (e.g. [Legal Entity], [Jurisdiction], [13/16]) — the
// inner class also matches newlines, so a placeholder split across lines is caught too. Plus TODO(legal).
const PATTERNS = [/\[[A-Za-z0-9][^\]]*\]/g, /TODO\(legal\)/g]

/** Find every placeholder/marker in `text`, with 1-based line numbers. Exported for unit tests. */
export function findPlaceholders(text) {
  const hits = []
  const lineOf = (idx) => text.slice(0, idx).split('\n').length
  for (const re of PATTERNS) {
    for (const m of text.matchAll(re)) {
      hits.push({ line: lineOf(m.index), text: m[0].replace(/\s+/g, ' ').trim() })
    }
  }
  return hits.sort((a, b) => a.line - b.line)
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  // Only the prose legal pages. LegalPage.tsx (the shared layout) is intentionally excluded: it uses
  // Tailwind arbitrary-value classes like `min-h-[44px]`, which are not placeholders.
  const FILES = ['src/app/privacy/page.tsx', 'src/app/terms/page.tsx']

  let failures = 0
  for (const rel of FILES) {
    let text
    try {
      text = readFileSync(join(root, rel), 'utf8')
    } catch {
      console.error(`check:legal — missing expected legal file: ${rel}`)
      failures++
      continue
    }
    for (const hit of findPlaceholders(text)) {
      console.error(`${rel}:${hit.line}  ${hit.text}`)
      failures++
    }
  }

  if (failures > 0) {
    console.error(`\ncheck:legal — ${failures} unresolved legal placeholder(s)/marker(s). ` +
      `Counsel must fill these before production launch (charging users / app-store submission).`)
    process.exit(1)
  }
  console.log('check:legal — no legal placeholders remain. ✓')
}

// Run only when invoked directly (not when imported by a test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
