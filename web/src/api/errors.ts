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
  | 'payload_too_large'
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

/**
 * Is this text something a person can be shown?
 *
 * Errors reach the screen from many sources — our server, the database behind
 * it, the browser, the auth service — and not all of them write for people. The
 * unreadable ones have recognisable shapes: a stringified object (`{}`,
 * `[object Object]`), a class name, "Failed to fetch", a half-parsed JSON error,
 * a SQL constraint name. Those are never shown; the code's own sentence is.
 */
export function isReadable(message: string | null | undefined): boolean {
  const text = (message ?? '').trim()
  if (!text || text.length > 240) return false
  if (/^[[{]/.test(text)) return false
  if (/\[object \w+\]|\bundefined\b|\bNaN\b|\bnull\b/.test(text)) return false
  if (/^(TypeError|ReferenceError|SyntaxError|RangeError|Error:|Auth\w*Error|Postgrest\w*Error)/.test(text)) return false
  if (/failed to fetch|networkerror|load failed|fetch failed|unexpected token|not valid json|econn|etimedout|\bat .*:\d+:\d+\)?$/i.test(text)) return false
  if (/\b(sql|postgres|postgrest|pgrst|constraint|duplicate key|violates)\b/i.test(text)) return false
  return true
}

/** The browser's own "the network failed" wording, for errors that never became an ApiError. */
const NETWORK_WORDS = /failed to fetch|networkerror|load failed|fetch failed|network request failed/i

/** Map a code to a short, user-facing sentence. Kept in one place. */
export function friendlyMessage(err: unknown): string {
  if (err instanceof ApiError) {
    // The server's own sentence is usually more specific than the generic
    // mapping below — when it is something a person can read.
    if (isReadable(err.message) && !isGenericMessage(err.message)) return err.message
    return DEFAULTS[err.code] ?? DEFAULTS.unknown
  }
  if (err instanceof Error) {
    if (NETWORK_WORDS.test(err.message)) return DEFAULTS.network
    // A thrown Error is sometimes written for the screen on purpose ("report.pdf
    // is over 4MB"); anything that is not is replaced rather than shown.
    if (isReadable(err.message) && !isGenericMessage(err.message)) return err.message
  }
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
  unauthorized: 'You were signed out. Please sign in again.',
  forbidden: "You can't open that.",
  not_found: "We couldn't find that.",
  validation_error: 'Something needs a quick fix. Please check and try again.',
  rate_limited: 'That was a lot at once. Wait a moment, then try again.',
  payload_too_large: "That's too big to send. Try a smaller file or less text.",
  upstream_unavailable: "Something we rely on isn't working right now. Please try again soon.",
  not_configured: "This isn't ready yet.",
  // Was "Upload a document first" — stale since generation started accepting
  // chat history as material too (api/app/errors.py's NothingIndexed carries
  // the current wording, and friendlyMessage() prefers the server's own
  // message whenever it sends one, so this default is a fallback of last
  // resort rather than what's normally shown — still worth being correct).
  nothing_indexed: 'There is nothing to use yet. Add a file or chat about this topic first.',
  method_not_allowed: "You can't do that here.",
  http_error: "That didn't work. Please try again.",
  internal_error: 'Something went wrong on our side. Please try again.',
  network: "We can't reach the server. Check your internet and try again.",
  config: "The app isn't set up right. Please let us know.",
  unknown: 'Something went wrong. Please try again.',
}

const GENERIC = new Set<string>(['', 'error', 'internal server error'])
function isGenericMessage(m: string): boolean {
  return GENERIC.has(m.trim().toLowerCase())
}
