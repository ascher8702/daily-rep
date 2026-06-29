import { NextResponse, type NextRequest } from 'next/server'

function nonce(): string {
  return crypto.randomUUID().replaceAll('-', '')
}

function contentSecurityPolicy(n: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${n}' https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com",
    "frame-src 'self' https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ')
}

export function middleware(req: NextRequest) {
  if (process.env.NODE_ENV !== 'production') return NextResponse.next()

  const n = nonce()
  const csp = contentSecurityPolicy(n)
  const requestHeaders = new Headers(req.headers)

  // Next's App Router extracts the script nonce from this request CSP and applies it to framework
  // scripts. x-nonce lets app/layout.tsx apply the same nonce to the pre-paint theme bootstrap.
  requestHeaders.set('Content-Security-Policy', csp)
  requestHeaders.set('x-nonce', n)

  const res = NextResponse.next({ request: { headers: requestHeaders } })
  res.headers.set('Content-Security-Policy', csp)
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.*|apple-touch-icon.png|manifest.webmanifest|sw.js).*)'],
}
