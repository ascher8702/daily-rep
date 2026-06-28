import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MUSCLES } from '../data/muscles'

// Drift guard for §7.22: the TS muscle→region map (src/data/muscles.ts) MUST equal the SQL CASE in
// public.exercise_region (the analytics projection's embedded copy). The DB has no standalone map, so
// these two definitions can silently diverge — this test fails the build if they do.
//
// tsconfig EXCLUDES supabase/, so we read the migration as a STRING (node:fs) rather than importing it
// (pattern: support.test.ts). The SQL is parsed, not executed.
const SQL_PATH = join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20260628200000_sync_exercise_facts_trigger.sql',
)

function parseSqlRegionMap(sql: string): Record<string, string> {
  // Scope to the exercise_region function body so we don't accidentally match WHEN/THENs elsewhere.
  const fnStart = sql.indexOf('FUNCTION public.exercise_region')
  expect(fnStart, 'exercise_region function not found in the migration').toBeGreaterThanOrEqual(0)
  const body = sql.slice(fnStart, sql.indexOf('$$;', fnStart))
  const map: Record<string, string> = {}
  const re = /WHEN\s+'([a-z]+)'\s+THEN\s+'(push|pull|legs|core)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) map[m[1]] = m[2]
  return map
}

describe('region map drift (TS MUSCLES ↔ SQL exercise_region CASE)', () => {
  const sql = readFileSync(SQL_PATH, 'utf8')
  const sqlMap = parseSqlRegionMap(sql)
  const tsMap = Object.fromEntries(Object.entries(MUSCLES).map(([id, m]) => [id, m.region]))

  it('§7.22 the parsed SQL CASE covers exactly the 14 muscles (ELSE NULL = not in the map)', () => {
    expect(Object.keys(sqlMap)).toHaveLength(14)
    expect(Object.keys(tsMap)).toHaveLength(14)
  })

  it('§7.22 both maps cover the SAME muscle keys (no muscle in one map only)', () => {
    expect(Object.keys(sqlMap).sort()).toEqual(Object.keys(tsMap).sort())
  })

  it('§7.22 every muscle maps to the SAME region on both sides', () => {
    // a divergence (e.g. SQL says traps→push) fails here with a readable diff
    expect(sqlMap).toEqual(tsMap)
  })
})
