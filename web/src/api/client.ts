/**
 * Fetch wrapper the whole app funnels through.
 *
 * Responsibilities:
 *  - Prepend the API base URL.
 *  - Attach the Supabase access token if the user is signed in.
 *  - Parse the `{ error: { code, message } }` envelope into an `ApiError`.
 *  - Turn network failures into a friendly `ApiError('network', ...)`.
 *
 * Streaming responses (e.g. chat SSE) call `apiFetchRaw` and consume
 * `res.body` themselves.
 */

import { API_URL } from '../lib/env'
import { ApiError, type ErrorCode } from './errors'

type Init = Omit<RequestInit, 'body'> & {
  body?: unknown
  /** When true the payload is FormData — do NOT set Content-Type. */
  formData?: boolean
  /** Skip auth header (for the /health probe). */
  anonymous?: boolean
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

/** Low-level fetch that returns the raw Response — used by streamers. */
export async function apiFetchRaw(path: string, init?: Init): Promise<Response> {
  const finalInit = await buildInit(init)
  try {
    const res = await fetch(joinUrl(API_URL, path), finalInit)
    if (!res.ok) throw await parseError(res)
    return res
  } catch (e) {
    if (e instanceof ApiError) throw e
    throw new ApiError('network', "Can't reach the server.", 0)
  }
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
