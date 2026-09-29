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
  // Two codes `handle_http_exception` (api/app/errors.py) can also emit,
  // missing here until the end-to-end audit found them: a real backend code
  // with no frontend counterpart falls back to DEFAULTS.unknown silently —
  // no crash, no type error, just a generic message where a specific one
  // was available. errors.test.ts's exhaustiveness check is what would have
  // caught this originally.
  | 'method_not_allowed'
  | 'http_error'
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

/**
 * The coarse bucket a resilience surface (`AsyncState`, `OfflineBanner`)
 * picks its icon/tone/retry-copy from — distinct from `friendlyMessage`'s
 * one sentence per code, because several different codes want the identical
 * on-screen treatment (a 502 and a 503 both just mean "try again shortly").
 *
 * Render's free tier is the reason `timeout` gets its own bucket rather than
 * folding into `offline`: both surface as `ApiError('network', ...)` from
 * `client.ts` (there's no HTTP status for "the request never got a
 * response"), but "can't reach the server at all" and "reached it, and it's
 * just slow" call for different copy — the second one is a cold start, not
 * an outage.
 */
export type ErrorKind = 'offline' | 'timeout' | 'rate_limited' | 'auth' | 'server' | 'other'

export function classifyError(err: unknown): ErrorKind {
  if (isAuthError(err)) return 'auth'
  if (!(err instanceof ApiError)) return 'other'
  if (err.code === 'network') {
    // The only two messages `apiFetchRaw` ever attaches to `network` — see
    // its `timedOut` branch. Matched on substring rather than a third field
    // because adding a field to `ApiError` just for this one distinction
    // would outweigh the one string compare it replaces.
    return err.message.includes('taking too long') ? 'timeout' : 'offline'
  }
  if (err.code === 'rate_limited') return 'rate_limited'
  if (err.code === 'upstream_unavailable' || err.status >= 500) return 'server'
  return 'other'
}

const DEFAULTS: Record<ErrorCode, string> = {
  unauthorized: 'Your session has expired. Sign in again.',
  forbidden: "You don't have access to that.",
  not_found: "We couldn't find that.",
  validation_error: 'Some of the input needs a small fix.',
  rate_limited: 'Slow down for a moment and try again.',
  upstream_unavailable: 'A service we depend on is offline. Try again shortly.',
  not_configured: 'This feature is not connected yet.',
  // Was "Upload a document first" — stale since generation started accepting
  // chat history as material too (api/app/errors.py's NothingIndexed carries
  // the current wording, and friendlyMessage() prefers the server's own
  // message whenever it sends one, so this default is a fallback of last
  // resort rather than what's normally shown — still worth being correct).
  nothing_indexed: 'Nothing to build from yet. Upload a document or chat about this topic first.',
  method_not_allowed: "That action isn't available here.",
  http_error: 'That request failed. Try again.',
  internal_error: 'Something went wrong on our side.',
  network: "Can't reach the server. Check your connection and try again.",
  config: 'The app is missing a required setting.',
  unknown: 'Something went wrong.',
}

const GENERIC = new Set<string>(['', 'error', 'internal server error'])
function isGenericMessage(m: string): boolean {
  return GENERIC.has(m.trim().toLowerCase())
}
