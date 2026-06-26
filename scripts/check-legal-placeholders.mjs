#!/usr/bin/env node
/**
 * Fails if the legal pages still contain unfilled placeholders. The Privacy Policy and Terms ship with
 * `[Legal Entity]`, `[Jurisdiction]`, `[13/16]`-style tokens and `TODO(legal)` markers that counsel must
 * resolve before the app charges money or is submitted to the app stores.
 *
 * Usage: `node scripts/check-legal-placeholders.mjs` (exit 1 = placeholders remain).
 * This is wired into CI as an ADVISORY step today and is a BLOCKING pre-deploy gate at go-live
 * (see docs/runbook-deploy.md). Run it locally with `pnpm check:legal`.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// Only the prose legal pages. LegalPage.tsx (the shared layout) is intentionally excluded: it uses
// Tailwind arbitrary-value classes like `min-h-[44px]`, which are not placeholders.
const FILES = ['src/app/privacy/page.tsx', 'src/app/terms/page.tsx']

// A bracketed token that starts with a letter or digit, e.g. [Legal Entity], [Jurisdiction], [13/16].
const PLACEHOLDER = /\[[A-Za-z0-9][^\]]*\]/
const TODO = /TODO\(legal\)/

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
  text.split('\n').forEach((line, i) => {
    if (PLACEHOLDER.test(line) || TODO.test(line)) {
      console.error(`${rel}:${i + 1}  ${line.trim()}`)
      failures++
    }
  })
}

if (failures > 0) {
  console.error(`\ncheck:legal — ${failures} unresolved legal placeholder(s)/marker(s). ` +
    `Counsel must fill these before production launch (charging users / app-store submission).`)
  process.exit(1)
}
console.log('check:legal — no legal placeholders remain. ✓')
