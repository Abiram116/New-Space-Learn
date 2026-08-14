/**
 * The error-code contract with the backend.
 *
 * Found by the 2026-08 end-to-end audit: `api/app/errors.py`'s
 * `handle_http_exception` can emit `method_not_allowed` and `http_error`,
 * and neither existed in `errors.ts`'s `ErrorCode` union. `client.ts` parses
 * the server's code with a raw `as ErrorCode` — no runtime validation — so a
 * missing code doesn't throw or type-error, it just silently falls back to
 * `DEFAULTS.unknown` instead of a real message.
 *
 * Same discipline as `limits.test.ts`: read the actual Python rather than a
 * hand-copied list, so the two can't drift without this failing.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ApiError, friendlyMessage, type ErrorCode } from '../src/api/errors.js'

const ERRORS_PY = readFileSync(resolve(__dirname, '../../api/app/errors.py'), 'utf8')

/** Every literal code string `api/app/errors.py` can actually put in a
 * response — both the `ApiError` subclasses' `code = "..."` and the two
 * dict-driven codes in `handle_http_exception`. */
function backendCodes(): string[] {
  const fromClasses = [...ERRORS_PY.matchAll(/^\s{4}code = "([a-z_]+)"/gm)].map((m) => m[1])
  const dictCodes = ['unauthorized', 'forbidden', 'not_found', 'method_not_allowed', 'rate_limited', 'http_error']
  const fromDict = dictCodes.filter((c) => ERRORS_PY.includes(`"${c}"`))
  return [...new Set([...fromClasses, ...fromDict, 'internal_error'])]
}

// Codes that exist only on this side — synthesized when there's no server
// response to read a code from at all (network failure, malformed config).
const CLIENT_ONLY: ErrorCode[] = ['network', 'config', 'unknown']

describe('DEFAULTS has a real entry for every code the backend can send', () => {
  it('never silently falls through to DEFAULTS.unknown for a real backend code', () => {
    // '' forces friendlyMessage to consult DEFAULTS rather than preferring a
    // (nonexistent) server message — this is the actual failure mode a
    // missing ErrorCode entry produces: not a crash, a silent generic message.
    const codes = backendCodes()
    expect(codes.length).toBeGreaterThan(5) // guard against the parser finding nothing
    expect(codes).not.toContain('unknown') // sanity: this scan must not invent codes
    for (const code of codes) {
      const message = friendlyMessage(new ApiError(code as ErrorCode, '', 0))
      expect(message, `${code} resolved to the generic unknown fallback`).not.toBe(
        'Something went wrong.',
      )
    }
  })

  it('has a real entry for every client-only synthetic code too', () => {
    for (const code of CLIENT_ONLY.filter((c) => c !== 'unknown')) {
      const message = friendlyMessage(new ApiError(code, '', 0))
      expect(message, `${code} resolved to the generic unknown fallback`).not.toBe(
        'Something went wrong.',
      )
    }
  })

  // unknown is the one legitimate exception — it IS the fallback target.
  it('unknown itself still resolves to a real message', () => {
    expect(friendlyMessage(new ApiError('unknown', '', 0))).toBe('Something went wrong.')
  })
})

describe('friendlyMessage', () => {
  it('prefers a specific server message over the generic default', () => {
    expect(friendlyMessage(new ApiError('not_found', 'That deck was deleted.', 404))).toBe(
      'That deck was deleted.',
    )
  })

  it('falls back to DEFAULTS when the server message is generic', () => {
    expect(friendlyMessage(new ApiError('not_found', 'Error', 404))).not.toBe('Error')
    expect(friendlyMessage(new ApiError('not_found', '', 404))).not.toBe('')
  })

  it('handles a plain Error with no code at all', () => {
    expect(friendlyMessage(new Error('boom'))).toBe('boom')
  })

  it('never throws on a completely unrecognised value', () => {
    expect(() => friendlyMessage('not an error')).not.toThrow()
    expect(() => friendlyMessage(null)).not.toThrow()
  })
})
