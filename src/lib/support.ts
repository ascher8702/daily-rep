/**
 * Single source of truth for the user-facing support address. Previously the legal pages and the
 * checkout-return screen used the un-hyphenated domain (dailyrep dot app) while the canonical domain
 * everywhere else (layout metadata, email templates, APP_URL) is daily-rep.app — so a paying user in
 * trouble was mailing a dead address. Import this constant instead of hardcoding the address anywhere.
 */
export const SUPPORT_EMAIL = 'support@daily-rep.app'

/** Ready-to-use `mailto:` href for the support address. */
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`
