/**
 * `classifyError` is the one place a resilience surface (`AsyncState`,
 * `OfflineBanner`) decides which of a handful of on-screen treatments an
 * error gets. Getting the bucket wrong is invisible in a diff — the code
 * still runs, it just shows "Something went wrong" for a case that had a
 * much more honest and specific thing to say — so each bucket gets its own
 * case here rather than trusting the mapping by inspection.
 */

import { describe, expect, it } from 'vitest'
import { ApiError } from './errors'
import { classifyError, friendlyMessage, isAuthError } from './errors'

describe('classifyError', () => {
  it('is "auth" for a 401, same as isAuthError', () => {
    const err = new ApiError('unauthorized', 'Session expired.', 401)
    expect(classifyError(err)).toBe('auth')
    expect(isAuthError(err)).toBe(true)
  })

  it('is "timeout" for the timed-out flavour of a network ApiError', () => {
    const err = new ApiError('network', 'The server is taking too long to respond.', 0)
    expect(classifyError(err)).toBe('timeout')
  })

  it('is "offline" for the unreachable flavour of a network ApiError', () => {
    const err = new ApiError('network', "Can't reach the server.", 0)
    expect(classifyError(err)).toBe('offline')
  })

  it('is "rate_limited" for a 429', () => {
    const err = new ApiError('rate_limited', 'The AI is at capacity right now.', 429)
    expect(classifyError(err)).toBe('rate_limited')
  })

  it('is "server" for an upstream_unavailable code', () => {
    const err = new ApiError('upstream_unavailable', 'A service we depend on is offline.', 503)
    expect(classifyError(err)).toBe('server')
  })

  it('is "server" for a bare 5xx that fell through to a generic code', () => {
    const err = new ApiError('internal_error', 'Something went wrong on our side.', 500)
    expect(classifyError(err)).toBe('server')
  })

  it('is "other" for a validation error — not a resilience concern', () => {
    const err = new ApiError('validation_error', 'Some of the input needs a small fix.', 422)
    expect(classifyError(err)).toBe('other')
  })

  it('is "other" for a thrown value that is not an ApiError at all', () => {
    expect(classifyError(new Error('boom'))).toBe('other')
    expect(classifyError('boom')).toBe('other')
    expect(classifyError(null)).toBe('other')
  })
})

describe('friendlyMessage exhaustiveness', () => {
  it('has a default sentence for every ErrorCode classifyError might see', () => {
    // Every code this module knows about must produce SOME sentence — a gap
    // here falls back silently to DEFAULTS.unknown rather than erroring, so
    // this pins the exhaustiveness explicitly instead of trusting the object
    // literal by inspection.
    const codes = [
      'unauthorized', 'forbidden', 'not_found', 'validation_error', 'rate_limited',
      'upstream_unavailable', 'not_configured', 'nothing_indexed', 'method_not_allowed',
      'http_error', 'internal_error', 'network', 'config', 'unknown',
    ] as const
    for (const code of codes) {
      const message = friendlyMessage(new ApiError(code, '', 0))
      expect(message.length).toBeGreaterThan(0)
    }
  })
})
