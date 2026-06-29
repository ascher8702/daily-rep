// Deno test for the constant-time secret comparison. Run with `deno test supabase/functions/`.
// Named *_test.ts (Deno convention) so the repo's vitest runner ignores it. Uses only Web Crypto +
// std/assert — no esm.sh imports — so it stays runnable in the edge runtime toolchain.
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { secretEquals, timingSafeEqualBytes } from './secrets.ts'

Deno.test('secretEquals: identical non-empty secrets match', async () => {
  assertEquals(await secretEquals('s3cr3t-value', 's3cr3t-value'), true)
})

Deno.test('secretEquals: differing secrets do not match', async () => {
  assertEquals(await secretEquals('s3cr3t-value', 's3cr3t-valuX'), false)
})

Deno.test('secretEquals: different lengths do not match (no early return leak)', async () => {
  assertEquals(await secretEquals('short', 'a-much-longer-secret'), false)
})

Deno.test('secretEquals: empty/missing configured secret always rejects', async () => {
  assertEquals(await secretEquals('anything', ''), false)
  assertEquals(await secretEquals('anything', undefined), false)
  assertEquals(await secretEquals('anything', null), false)
  // even when the provided value is also empty, a blank configured secret must not authenticate
  assertEquals(await secretEquals('', ''), false)
})

Deno.test('secretEquals: missing provided value rejects', async () => {
  assertEquals(await secretEquals(null, 'configured'), false)
  assertEquals(await secretEquals(undefined, 'configured'), false)
})

Deno.test('timingSafeEqualBytes: equal and unequal byte arrays', () => {
  assertEquals(timingSafeEqualBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true)
  assertEquals(timingSafeEqualBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false)
  assertEquals(timingSafeEqualBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2])), false)
})
