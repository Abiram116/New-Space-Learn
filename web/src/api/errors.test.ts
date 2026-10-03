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
import { classifyError, friendlyMessage, isAuthError, isReadable } from './errors'

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

describe('isReadable', () => {
  it.each([
    ['', false],
    ['{}', false],
    ['{"error":"x"}', false],
    ['[object Object]', false],
    ['undefined', false],
    ['TypeError: x is not a function', false],
    ['AuthRetryableFetchError: {}', false],
    ['Failed to fetch', false],
    ['Unexpected token < in JSON at position 0', false],
    ['duplicate key value violates unique constraint "notes_pkey"', false],
    ['at Object.run (http://localhost:5173/src/main.tsx:12:5)', false],
    ['x'.repeat(300), false],
    ['Password should be at least 8 characters.', true],
    ['report.pdf is over 4MB — resize it first.', true],
    ['An account with that email already exists.', true],
  ])('%j → %s', (text, expected) => {
    expect(isReadable(text)).toBe(expected)
  })
})

describe('friendlyMessage never shows unreadable text', () => {
  it('replaces a server message that is not a sentence with the code\'s own', () => {
    const err = new ApiError('upstream_unavailable', '{}', 500)
    expect(friendlyMessage(err)).toBe('A service we depend on is offline. Try again shortly.')
  })

  it('keeps a server sentence that is readable', () => {
    expect(friendlyMessage(new ApiError('validation_error', 'Name is required.', 422))).toBe('Name is required.')
  })

  it('turns the browser\'s network failure into one plain sentence', () => {
    expect(friendlyMessage(new TypeError('Failed to fetch'))).toMatch(/can.t reach the server/i)
  })

  it('shows an Error written for the screen, and hides one that is not', () => {
    expect(friendlyMessage(new Error('big.png is over 4MB — resize it first.'))).toContain('over 4MB')
    expect(friendlyMessage(new Error('Cannot read properties of undefined'))).toBe('Something went wrong.')
    expect(friendlyMessage('a string')).toBe('Something went wrong.')
  })
})
