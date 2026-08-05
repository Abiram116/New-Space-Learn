/**
 * Error normalization for the whole app.
 *
 * The backend always returns `{ error: { code, message } }`. Network failures
 * (server offline, DNS, etc.) don't have that shape, so we synthesize one so
 * every downstream `catch` sees the same object.
 */

export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation_error'
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'not_configured'
  | 'nothing_indexed'
  | 'internal_error'
  | 'network'
  | 'config'
  | 'unknown'

export class ApiError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly detail: unknown
  constructor(code: ErrorCode, message: string, status = 0, detail?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.detail = detail
  }
}

/** Map a code to a short, user-facing sentence. Kept in one place. */
export function friendlyMessage(err: unknown): string {
  if (err instanceof ApiError) {
    // If the server gave us a specific message, prefer it — it's usually
    // more informative than the generic mapping below.
    if (err.message && !isGenericMessage(err.message)) return err.message
    return DEFAULTS[err.code] ?? DEFAULTS.unknown
  }
  if (err instanceof Error && err.message) return err.message
  return DEFAULTS.unknown
}

/** True when the code means "the user needs to sign in again". */
export function isAuthError(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'unauthorized'
}

const DEFAULTS: Record<ErrorCode, string> = {
  unauthorized: 'Your session has expired. Sign in again.',
  forbidden: "You don't have access to that.",
  not_found: "We couldn't find that.",
  validation_error: 'Some of the input needs a small fix.',
  rate_limited: 'Slow down for a moment and try again.',
  upstream_unavailable: 'A service we depend on is offline. Try again shortly.',
  not_configured: 'This feature is not connected yet.',
  nothing_indexed: 'Nothing indexed on this topic yet. Upload a document first.',
  internal_error: 'Something went wrong on our side.',
  network: "Can't reach the server. Check your connection and try again.",
  config: 'The app is missing a required setting.',
  unknown: 'Something went wrong.',
}

const GENERIC = new Set<string>(['', 'error', 'internal server error'])
function isGenericMessage(m: string): boolean {
  return GENERIC.has(m.trim().toLowerCase())
}
