/**
 * Fetch wrapper the whole app funnels through.
 *
 * Responsibilities:
 *  - Prepend the API base URL.
 *  - Attach the Supabase access token if the user is signed in.
 *  - Parse the `{ error: { code, message } }` envelope into an `ApiError`.
 *  - Turn network failures into a friendly `ApiError('network', ...)`.
 *  - Give every request a timeout (see `DEFAULT_TIMEOUT_MS`), and retry GET
 *    requests once or twice on a network failure or a 502/503/504 — see
 *    `apiFetchRaw` for exactly what is and isn't retried, and why writes
 *    never are.
 *
 * Streaming responses (e.g. chat SSE) call `apiFetchRaw` and consume
 * `res.body` themselves.
 */

import { invalidate } from '../lib/asyncCache'
import { API_URL } from '../lib/env'
import { ApiError, type ErrorCode } from './errors'

type Init = Omit<RequestInit, 'body'> & {
  body?: unknown
  /** When true the payload is FormData — do NOT set Content-Type. */
  formData?: boolean
  /** Skip auth header (for the /health probe). */
  anonymous?: boolean
  /** Overrides `DEFAULT_TIMEOUT_MS`. `0` disables the timeout entirely —
   *  needed for `streamChat`, which is long-lived by design and already
   *  cancellable through its own `signal`. */
  timeoutMs?: number
}

let tokenProvider: () => string | null = () => null

/** Called once by the AuthProvider so the client can attach the JWT. */
export function setAuthTokenProvider(fn: () => string | null): void {
  tokenProvider = fn
}

async function buildInit(init: Init | undefined): Promise<RequestInit> {
  const headers = new Headers(init?.headers as HeadersInit | undefined)

  if (!init?.anonymous) {
    const token = tokenProvider()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }

  let body: BodyInit | undefined
  if (init?.body !== undefined && init?.body !== null) {
    if (init.formData) {
      body = init.body as FormData
    } else {
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
      body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body)
    }
  }

  return {
    ...init,
    headers,
    body,
  }
}

/**
 * Told when the server rejects our credentials.
 *
 * A 401 means this session is no longer good — the account was deleted (here
 * or on another device), the refresh token was revoked, the user was removed
 * from the project. Without somewhere to report that, the app kept the dead
 * session and every screen filled with "unauthorized" toasts over data that
 * would never arrive, with no route back to sign-in because the guards still
 * believed there was a session.
 *
 * A callback rather than an import so this module stays free of React and of
 * the auth layer that imports it.
 */
let onUnauthorized: (() => void) | null = null

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn
}

/**
 * Which cached families a path's mutations invalidate.
 *
 * `useAsync` serves a cached entry on mount so switching pages does not flash,
 * and the price of that is a cache that has to be told when it is wrong.
 * Deriving it here — from the method and path every request already carries —
 * means it happens once, for every caller, including ones written later that
 * have never heard of the cache. Doing it at each mutation's call site instead
 * is fifteen places to forget.
 *
 * Matched on segments rather than exact routes because the same family is
 * reachable by several shapes (`/decks/x/cards`, `/subspaces/x/cards/generate`,
 * `/cards/x/grade` all change what a deck list shows).
 */
const CACHE_FAMILIES: { match: RegExp; families: string[] }[] = [
  { match: /\/notes(\/|$)/, families: ['notes:'] },
  { match: /\/quizzes(\/|$)/, families: ['quizzes:'] },
  { match: /\/(decks|cards|flashcards)(\/|$)/, families: ['decks:', 'cards:'] },
  { match: /\/documents(\/|$)/, families: ['docs:'] },
  { match: /\/skills(\/|$)/, families: ['skills:'] },
]

function invalidateFor(path: string): void {
  for (const { match, families } of CACHE_FAMILIES) {
    if (match.test(path)) families.forEach(invalidate)
  }
}

/** No response, and no signal the server ever saw the request — worth one
 *  retry, since these are exactly the failures a cold-starting backend or a
 *  flaky connection produce. Anything else that reached the server and came
 *  back with an opinion (a 4xx, a 500) is not retried: retrying won't fix a
 *  validation error, and retrying a 500 risks repeating whatever caused it. */
const RETRYABLE_STATUSES = new Set([502, 503, 504])
/** Two retries (three attempts total), each waited out a little longer than
 *  the last — enough to ride out a brief blip without turning a real outage
 *  into a long hang the user is sitting through with no feedback. */
const RETRY_DELAYS_MS = [400, 1200]
/** Generous on purpose: `docs/operations/performance-and-cost.md` documents
 *  a real ~30s cold start on the current Render plan, and a timeout shorter
 *  than that would fire on perfectly healthy requests every time the
 *  backend has been idle. */
const DEFAULT_TIMEOUT_MS = 35_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Low-level fetch that returns the raw Response — used by streamers. */
export async function apiFetchRaw(path: string, init?: Init): Promise<Response> {
  const finalInit = await buildInit(init)
  const method = (finalInit.method ?? 'GET').toUpperCase()
  const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  // Only GET is ever retried automatically. A write that times out or drops
  // mid-flight might have already reached and been applied by the server —
  // silently sending it again risks a duplicate note, a duplicate charge,
  // whatever the request was. GET has no such risk, so it's the only method
  // this can be safe-by-default for; a caller doing something unusual with a
  // write can still retry deliberately at its own call site.
  const retryable = method === 'GET'
  const attempts = retryable ? RETRY_DELAYS_MS.length + 1 : 1
  const callerSignal = finalInit.signal ?? undefined

  let lastErr: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    // A fresh controller every attempt: reusing one that a previous
    // iteration's timeout already fired on would make every subsequent
    // attempt abort instantly.
    const controller = new AbortController()
    let timedOut = false
    const onCallerAbort = () => controller.abort(callerSignal?.reason)
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort(callerSignal.reason)
      else callerSignal.addEventListener('abort', onCallerAbort)
    }
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true
            controller.abort()
          }, timeoutMs)
        : undefined

    try {
      const res = await fetch(joinUrl(API_URL, path), { ...finalInit, signal: controller.signal })
      if (res.status === 401) onUnauthorized?.()
      if (!res.ok) {
        if (retryable && RETRYABLE_STATUSES.has(res.status) && attempt < attempts - 1) {
          lastErr = await parseError(res)
          await sleep(RETRY_DELAYS_MS[attempt])
          continue
        }
        throw await parseError(res)
      }
      // Only after a *successful* write: invalidating on a failed request would
      // throw away good data to reflect a change that never happened.
      if (method !== 'GET') invalidateFor(path)
      return res
    } catch (e) {
      if (e instanceof ApiError) throw e
      const isAbort = e instanceof DOMException && e.name === 'AbortError'
      // The caller cancelled on purpose (navigated away, hit stop, started a
      // regenerate) — this isn't a failure to report or retry, it's the
      // caller getting exactly what it asked for. Existing callers (e.g.
      // `ChatView`) already check their own `signal.aborted` before showing
      // an error, so rethrowing the raw abort rather than wrapping it in an
      // `ApiError` doesn't change what the user sees.
      if (isAbort && !timedOut) throw e
      lastErr = timedOut
        ? new ApiError('network', 'The server is taking too long to respond.', 0)
        : new ApiError('network', "Can't reach the server.", 0)
      // A timeout is deliberately NOT retried, unlike a fast network error or
      // a fast 502/503/504: it already cost the full `timeoutMs` to find out,
      // and retrying would mean another full wait on top before failing for
      // good — up to 3× the timeout instead of a quick couple of retries.
      if (retryable && !timedOut && attempt < attempts - 1) {
        await sleep(RETRY_DELAYS_MS[attempt])
        continue
      }
      throw lastErr
    } finally {
      if (timer) clearTimeout(timer)
      if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort)
    }
  }
  // Unreachable — the loop above always either returns or throws — but
  // TypeScript can't see that, and `lastErr` is always an Error by the time
  // any iteration falls through, so this is just satisfying the compiler.
  throw lastErr
}

/** JSON convenience: parses `res.json()` for you and returns `T`. */
export async function apiFetch<T = unknown>(path: string, init?: Init): Promise<T> {
  const res = await apiFetchRaw(path, init)
  if (res.status === 204) return undefined as T
  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return undefined as T
  return (await res.json()) as T
}

async function parseError(res: Response): Promise<ApiError> {
  const status = res.status
  const contentType = res.headers.get('content-type') ?? ''
  let code: ErrorCode = 'unknown'
  let message = `Request failed (${status}).`
  let detail: unknown
  if (contentType.includes('application/json')) {
    try {
      const body = await res.json()
      const env = body?.error
      if (env?.code) code = env.code as ErrorCode
      else code = codeFromStatus(status)
      message = env?.message ?? message
      detail = env?.detail
    } catch {
      code = codeFromStatus(status)
    }
  } else {
    code = codeFromStatus(status)
  }
  return new ApiError(code, message, status, detail)
}

function codeFromStatus(status: number): ErrorCode {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 422) return 'validation_error'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'upstream_unavailable'
  return 'unknown'
}

function joinUrl(base: string, path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  const b = base.endsWith('/') ? base.slice(0, -1) : base
  const p = path.startsWith('/') ? path : `/${path}`
  return b + p
}

/** Simple health probe used by the offline banner. */
export async function ping(): Promise<boolean> {
  try {
    await apiFetch('/health', { anonymous: true, method: 'GET' })
    return true
  } catch {
    return false
  }
}
