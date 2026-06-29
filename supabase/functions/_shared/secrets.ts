/**
 * Constant-time secret comparison shared by the attacker-reachable Edge Functions. A plain `a !== b`
 * short-circuits on the first differing byte, leaking the length of the matching prefix through response
 * timing — enough to recover a shared secret byte-by-byte. We compare in time independent of the contents
 * by hashing both sides (so unequal lengths don't early-return either) and diffing the digests with
 * `crypto.subtle.timingSafeEqual` semantics.
 *
 * Deliberately tiny + dependency-free (only Web Crypto, available in the Deno edge runtime) so it stays
 * unit-testable and drops into any function unchanged, like ./rateLimit.ts and ./subscription.ts.
 */

/**
 * True iff `a` and `b` are byte-identical, compared in constant time w.r.t. the secret contents. An
 * empty/missing `expected` (`''`) is treated as "no secret configured" and ALWAYS returns false, so a
 * function can't be left unauthenticated by a blank env var. Both inputs are SHA-256'd first so the
 * length-equality of the raw strings never leaks and the final compare is always over fixed-width (32B)
 * digests.
 */
export async function secretEquals(provided: string | null | undefined, expected: string | null | undefined): Promise<boolean> {
  // Missing/empty configured secret is a hard fail (never authenticate against a blank secret).
  if (!expected) return false
  if (provided == null) return false

  const enc = new TextEncoder()
  const [pa, pb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(provided)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ])
  return timingSafeEqualBytes(new Uint8Array(pa), new Uint8Array(pb))
}

/**
 * Constant-time byte compare. Both arrays here are SHA-256 digests, so they are always the same length;
 * the length guard is belt-and-suspenders. The loop XOR-accumulates every byte difference so its running
 * time does not depend on WHERE the first mismatch is.
 */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}
