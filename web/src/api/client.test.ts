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
import { apiFetch, apiFetchRaw, setUnauthorizedHandler } from './client'
import { clearCache, readCache, writeCache } from '../lib/asyncCache'

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

/* ── Cache invalidation ──────────────────────────────────────────────── */

/**
 * The cache is what stops page switches flashing; this is what stops it lying.
 * Deriving invalidation from the request means a mutation written next year,
 * by someone who has never read `asyncCache.ts`, still leaves the UI correct.
 */
describe('cache invalidation from writes', () => {
  beforeEach(() => {
    clearCache()
  })

  it('drops the matching family after a successful write', async () => {
    writeCache('notes:sub-1', ['stale'])
    vi.stubGlobal('fetch', vi.fn(async () => ok({ id: 'n1' })))

    await apiFetch('/notes', { method: 'POST', body: { title: 'x' } })

    expect(readCache('notes:sub-1')).toBeUndefined()
  })

  it('leaves unrelated families alone', async () => {
    writeCache('decks:sub-1', ['keep'])
    vi.stubGlobal('fetch', vi.fn(async () => ok({})))

    await apiFetch('/notes/n1', { method: 'DELETE' })

    expect(readCache('decks:sub-1')?.data).toEqual(['keep'])
  })

  it('does NOT invalidate on a read', async () => {
    writeCache('notes:sub-1', ['keep'])
    vi.stubGlobal('fetch', vi.fn(async () => ok([])))

    await apiFetch('/notes')

    // A GET returning the same list must not evict it — that would make every
    // revalidation blank the screen it was meant to keep filled.
    expect(readCache('notes:sub-1')?.data).toEqual(['keep'])
  })

  it('does NOT invalidate when the write fails', async () => {
    writeCache('notes:sub-1', ['keep'])
    vi.stubGlobal('fetch', vi.fn(async () => status(500)))

    await apiFetch('/notes', { method: 'POST', body: {} }).catch(() => null)

    // Nothing changed server-side, so throwing away good data would be a
    // self-inflicted refetch and a visible flash for no reason.
    expect(readCache('notes:sub-1')?.data).toEqual(['keep'])
  })

  it('reaches every shape that changes a deck', async () => {
    for (const path of [
      '/decks/d1',
      '/decks/d1/cards',
      '/cards/c1/grade',
      '/subspaces/s1/cards/generate',
    ]) {
      writeCache('decks:s1', ['stale'])
      writeCache('cards:d1', ['stale'])
      vi.stubGlobal('fetch', vi.fn(async () => ok({})))

      await apiFetch(path, { method: 'POST', body: {} })

      expect(readCache('decks:s1'), `${path} should clear decks`).toBeUndefined()
      expect(readCache('cards:d1'), `${path} should clear cards`).toBeUndefined()
    }
  })
})

/* ── Timeout and retry ───────────────────────────────────────────────── */

/**
 * Only GET is ever retried, and only for a network failure or a
 * 502/503/504 — the exact set of failures a cold-starting backend or a
 * flaky connection produce, where nothing suggests the request itself was
 * wrong. See `apiFetchRaw`'s own comments for why writes are excluded
 * outright: a write that times out might already have reached the server.
 */
describe('retry', () => {
  it('retries a GET once after a 503 and succeeds', async () => {
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++
        return calls === 1 ? status(503) : ok({ id: 1 })
      }),
    )
    await expect(apiFetch('/me')).resolves.toEqual({ id: 1 })
    expect(calls).toBe(2)
  })

  it('retries a GET once after a network error and succeeds', async () => {
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++
        if (calls === 1) throw new TypeError('Failed to fetch')
        return ok({ id: 2 })
      }),
    )
    await expect(apiFetch('/me')).resolves.toEqual({ id: 2 })
    expect(calls).toBe(2)
  })

  it('does not retry a write on a 503 — it might already have landed', async () => {
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++
        return status(503)
      }),
    )
    await expect(apiFetch('/notes', { method: 'POST', body: {} })).rejects.toThrow()
    expect(calls).toBe(1)
  })

  it('does not retry a plain 500 — not one of the transient-infra codes', async () => {
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++
        return status(500)
      }),
    )
    await expect(apiFetch('/x')).rejects.toThrow()
    expect(calls).toBe(1)
  })

  it('gives up after exhausting retries and reports the last failure', async () => {
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++
        return status(503)
      }),
    )
    await expect(apiFetch('/me')).rejects.toThrow()
    // Three attempts total: the first, plus the two retries `RETRY_DELAYS_MS` allows.
    expect(calls).toBe(3)
  })
})

describe('timeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('aborts a hung request and reports it distinctly from a network failure', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            )
          }),
      ),
    )
    const pending = expect(apiFetch('/slow')).rejects.toThrow(/taking too long/)
    await vi.advanceTimersByTimeAsync(35_000)
    await pending
  })

  it('does not fire for a call that opts out with timeoutMs: 0', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => ok({ streaming: true })))
    const res = await apiFetchRaw('/stream', { timeoutMs: 0 })
    expect(res.ok).toBe(true)
    // Nothing to advance past — if a timer had been armed despite
    // `timeoutMs: 0`, this call would already be hanging above.
  })
})

describe('cancellation', () => {
  it('rethrows a caller-initiated abort without wrapping or retrying it', async () => {
    const controller = new AbortController()
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            calls++
            // Real `fetch` checks `signal.aborted` synchronously as well as
            // listening for a future `abort` event — by the time this mock
            // runs (after the `await buildInit(...)` inside `apiFetchRaw`
            // yields once), the signal aborted below has often already
            // fired, so a listener alone would never see it and this
            // promise would hang forever.
            if (init?.signal?.aborted) {
              reject(new DOMException('aborted', 'AbortError'))
              return
            }
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            )
          }),
      ),
    )
    const promise = apiFetch('/me', { signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toThrow()
    expect(calls).toBe(1)
  })
})
