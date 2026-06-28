/**
 * Cloudflare Turnstile (CAPTCHA) config — bot-abuse protection for the public sign-up / sign-in.
 *
 * Enabled ONLY when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set at build time, so dev/preview (no key)
 * behaves exactly as before — no widget, no submit gating. The token the widget produces is passed to
 * supabase.auth via `options.captchaToken`; the matching SECRET key must be configured in the Supabase
 * dashboard (Auth → Attack Protection → enable CAPTCHA = Turnstile) for the server to verify it.
 * Both the dashboard enable and the secret are `[HUMAN]` steps — see docs/runbook-deploy.md.
 *
 * NEXT_PUBLIC_* vars are inlined at build, so `captchaEnabled` is a build-time constant.
 */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ''

/** Whether the sign-up/sign-in screen should render a CAPTCHA and require its token. */
export const captchaEnabled = TURNSTILE_SITE_KEY.length > 0
