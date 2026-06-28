/**
 * `@/lib/rateLimit` surface: re-exports the canonical pure rate limiter that lives in the Edge
 * Function `_shared` folder (so it's bundled on `supabase functions deploy` and Deno-importable),
 * mirroring how src/__tests__/rateLimit.test.ts imports it. Gives Next.js/app code a `@/`-aliased
 * import path and lets `tsc` type-check the `_shared` source (which is otherwise excluded from tsc).
 */
export * from '../../supabase/functions/_shared/rateLimit'
