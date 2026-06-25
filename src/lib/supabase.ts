import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

/**
 * Browser Supabase client (singleton). Returns null when the env isn't configured, so the app
 * keeps working LOCAL-ONLY (offline-first) — cloud sync + auth are additive, never required.
 * The anon key is a publishable key; all data is protected by per-user Row-Level Security.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Account-required product: a PRODUCTION build MUST have Supabase configured. Fail fast (at build /
// startup) rather than silently shipping an unauthenticated app in localOnly mode. In development the
// null fallback is kept so the app still runs without a .env.local.
if (process.env.NODE_ENV === 'production' && (!url || !anonKey)) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY — both are required in production (auth + cloud sync).',
  )
}

export const supabase: SupabaseClient<Database> | null =
  url && anonKey
    ? createClient<Database>(url, anonKey, {
        auth: {
          // persist the session in localStorage and refresh it automatically
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: 'daily-rep-sb-auth',
        },
      })
    : null

/** Whether cloud features (auth + sync) are available in this build. */
export const cloudEnabled = !!supabase

/** The per-user state row table — one JSONB blob mirroring the local Zustand store. */
export const STATE_TABLE = 'daily_rep_state'
