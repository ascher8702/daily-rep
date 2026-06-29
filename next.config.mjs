import { withSentryConfig } from '@sentry/nextjs'

/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production'
const shouldUploadSourcemaps =
  !!process.env.SENTRY_AUTH_TOKEN && (process.env.CI === 'true' || process.env.VERCEL === '1')

// Hardened HTTP security headers. Applied in PRODUCTION only so they never interfere with the dev
// server / live preview (HMR websocket, iframe embedding). The nonce-based CSP is emitted per request
// from middleware.ts so Next's App Router and app/layout.tsx can share the same script nonce.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
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
