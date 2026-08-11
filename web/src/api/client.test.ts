// @vitest-environment jsdom

/**
 * A rejected token has to be *reported*, or a dead session is invisible.
 *
 * Deleting your account left the app running on a JWT the server had stopped
 * honouring: the guards still saw a session, `/signin` bounced back to `/home`,
 * and every request answered 401 into a toast over a UI with nothing left to
 * load. Nothing in the client noticed, because nothing was listening.
 *
 * The handler is deliberately fired on the *status*, before the error is parsed
 * and thrown — a caller that swallows the rejection must not also swallow the
 * signal that the session is gone.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, setUnauthorizedHandler } from './client'

const ok = (body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const status = (code: number) =>
  new Response(JSON.stringify({ error: { code: 'x', message: 'no' } }), {
    status: code,
    headers: { 'content-type': 'application/json' },
  })

let onUnauthorized: ReturnType<typeof vi.fn<() => void>>

beforeEach(() => {
  onUnauthorized = vi.fn<() => void>()
  setUnauthorizedHandler(onUnauthorized)
})

afterEach(() => {
  setUnauthorizedHandler(null)
  vi.unstubAllGlobals()
})

describe('unauthorized reporting', () => {
  it('reports a 401 so the session can be ended', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(401)))
    await expect(apiFetch('/me')).rejects.toThrow()
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('stays quiet on a successful request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ id: 1 })))
    await apiFetch('/me')
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('does not confuse other failures for a dead session', async () => {
    // 403 is a real resource you may not touch; 404 is the ownership guard's
    // deliberate anti-enumeration answer; 500 is the server's problem. Signing
    // someone out for any of these would throw them out over a bad link.
    for (const code of [403, 404, 422, 429, 500]) {
      vi.stubGlobal('fetch', vi.fn(async () => status(code)))
      await expect(apiFetch('/x')).rejects.toThrow()
    }
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('reports before throwing, so a swallowed error still ends the session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => status(401)))
    // Exactly what a `.catch(() => null)` call site does.
    await apiFetch('/me').catch(() => null)
    expect(onUnauthorized).toHaveBeenCalled()
  })

  it('survives having no handler registered', async () => {
    setUnauthorizedHandler(null)
    vi.stubGlobal('fetch', vi.fn(async () => status(401)))
    await expect(apiFetch('/me')).rejects.toThrow()
  })
})
