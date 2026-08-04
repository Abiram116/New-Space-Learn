/**
 * Env access with clear, actionable failure messages.
 *
 * Vite only exposes `VITE_*` to the browser. If a value is missing we don't
 * silently fail — we throw a `ConfigError` with a message that tells the user
 * exactly what to add to `.env`. Callers can render this as a config-missing
 * card instead of a raw exception.
 */

export class ConfigError extends Error {
  readonly key: string
  constructor(key: string, hint: string) {
    super(hint)
    this.name = 'ConfigError'
    this.key = key
  }
}

function readOptional(key: string): string | null {
  const value = (import.meta.env as Record<string, string | undefined>)[key]
  return value && value.trim() ? value.trim() : null
}

function readRequired(key: string, hint: string): string {
  const value = readOptional(key)
  if (!value) throw new ConfigError(key, hint)
  return value
}

/** URL of the FastAPI backend. Falls back to a sane local default. */
export const API_URL = readOptional('VITE_API_URL') ?? 'http://localhost:8000/api/v1'

/** True when Supabase env vars are present — auth features gate on this. */
export const SUPABASE_CONFIGURED =
  Boolean(readOptional('VITE_SUPABASE_URL')) &&
  Boolean(readOptional('VITE_SUPABASE_ANON_KEY'))

export function getSupabaseConfig() {
  return {
    url: readRequired(
      'VITE_SUPABASE_URL',
      'Add VITE_SUPABASE_URL to your .env file (Supabase project settings → API).',
    ),
    anonKey: readRequired(
      'VITE_SUPABASE_ANON_KEY',
      'Add VITE_SUPABASE_ANON_KEY to your .env file (Supabase project settings → API).',
    ),
  }
}
