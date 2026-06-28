import { withSentryConfig } from '@sentry/nextjs'

/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production'
const shouldUploadSourcemaps =
  !!process.env.SENTRY_AUTH_TOKEN && (process.env.CI === 'true' || process.env.VERCEL === '1')

// Hardened HTTP security headers. Applied in PRODUCTION only so they never interfere with the dev
// server / live preview (HMR websocket, iframe embedding). CSP allows 'unsafe-inline' for scripts to
// cover the pre-paint no-flash theme bootstrap in app/layout.tsx (a static literal, no user data) and
// for styles to cover Tailwind/styled-jsx; tighten to a per-request nonce later if needed.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // challenges.cloudflare.com: the Cloudflare Turnstile CAPTCHA (script + iframe + verify XHR).
      // Inert unless NEXT_PUBLIC_TURNSTILE_SITE_KEY is set (the widget only loads then); listed here so
      // the prod CSP is ready when CAPTCHA is enabled. See src/lib/captcha.ts.
      "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
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
    ].join('; '),
  },
]

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: {
    // we lint separately; don't block production builds on lint
    ignoreDuringBuilds: true,
  },
  async headers() {
    if (!isProd) return []
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

// Wrap with Sentry. Source-map upload runs only on CI/Vercel when SENTRY_AUTH_TOKEN is set; local builds
// with a token in .env.local still skip upload so they don't depend on reaching sentry.io. When upload is
// enabled, maps are deleted after upload. tunnelRoute proxies Sentry ingest through a same-origin route,
// so the CSP connect-src ('self') already covers it AND ad-blockers don't drop events — no CSP change
// needed. If you remove tunnelRoute, add https://*.sentry.io to connect-src.
export default withSentryConfig(nextConfig, {
  org: 'daily-reps',
  project: 'daily-reps',
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: '/monitoring',
  sourcemaps: {
    disable: !shouldUploadSourcemaps,
    deleteSourcemapsAfterUpload: true,
  },
  webpack: {
    // Avoid the SDK pulling in optional instrumentation that isn't used here.
    automaticVercelMonitors: false,
    // Tree-shake code we don't use (Session Replay is disabled above) to claw back client bundle weight.
    treeshake: {
      removeDebugLogging: true,
      excludeReplayShadowDOM: true,
      excludeReplayIframe: true,
      excludeReplayCompressionWorker: true,
    },
  },
})
