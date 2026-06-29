// Deno test for the CORS helper. Run with `deno test --allow-env supabase/functions/`.
// Named *_test.ts (Deno convention) so the repo's vitest runner ignores it.
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { corsHeaders } from './cors.ts'

const req = (origin?: string) =>
  new Request('https://fn.example/test', { headers: origin ? { Origin: origin } : {} })

Deno.test('corsHeaders: restricts Allow-Origin to APP_URL origin when set', () => {
  Deno.env.set('APP_URL', 'https://app.dailyrep.com/some/path')
  try {
    const h = corsHeaders(req('https://evil.example'))
    assertEquals(h['Access-Control-Allow-Origin'], 'https://app.dailyrep.com')
    assertEquals(h['Vary'], 'Origin')
    assertEquals(h['Access-Control-Allow-Methods'], 'POST, OPTIONS')
  } finally {
    Deno.env.delete('APP_URL')
  }
})

Deno.test('corsHeaders: same-origin request still gets the app origin', () => {
  Deno.env.set('APP_URL', 'https://app.dailyrep.com')
  try {
    assertEquals(corsHeaders(req('https://app.dailyrep.com'))['Access-Control-Allow-Origin'], 'https://app.dailyrep.com')
  } finally {
    Deno.env.delete('APP_URL')
  }
})

Deno.test('corsHeaders: falls back to wildcard when APP_URL is unset (dev)', () => {
  Deno.env.delete('APP_URL')
  assertEquals(corsHeaders(req('https://anything'))['Access-Control-Allow-Origin'], '*')
})

Deno.test('corsHeaders: unparseable APP_URL falls back to wildcard', () => {
  Deno.env.set('APP_URL', 'not a url')
  try {
    assertEquals(corsHeaders(req())['Access-Control-Allow-Origin'], '*')
  } finally {
    Deno.env.delete('APP_URL')
  }
})
