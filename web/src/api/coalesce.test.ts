// @vitest-environment jsdom

/**
 * Two parts of a screen asking for the same thing at the same moment cost one
 * request, and a write in between means the second asker starts its own.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from './client'

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

afterEach(() => vi.unstubAllGlobals())

describe('identical GETs in flight', () => {
  it('share one request', async () => {
    const fetchMock = vi.fn(async () => ok([1]))
    vi.stubGlobal('fetch', fetchMock)
    const [a, b] = await Promise.all([apiFetch('/subspaces/x/skills'), apiFetch('/subspaces/x/skills')])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(a).toEqual([1])
    expect(b).toEqual([1])
  })

  it('are separate once the first has finished', async () => {
    const fetchMock = vi.fn(async () => ok([1]))
    vi.stubGlobal('fetch', fetchMock)
    await apiFetch('/notes')
    await apiFetch('/notes')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('are not shared across different paths', async () => {
    const fetchMock = vi.fn(async () => ok([]))
    vi.stubGlobal('fetch', fetchMock)
    await Promise.all([apiFetch('/notes'), apiFetch('/quizzes')])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('never merge a request that can be cancelled by its own caller', async () => {
    const fetchMock = vi.fn(async () => ok([]))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await Promise.all([
      apiFetch('/notes', { signal: controller.signal }),
      apiFetch('/notes', { signal: new AbortController().signal }),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('are not handed to a read that starts after a write', async () => {
    const fetchMock = vi.fn(async () => ok([]))
    vi.stubGlobal('fetch', fetchMock)
    const before = apiFetch('/notes')
    const write = apiFetch('/notes', { method: 'POST', body: { title: 't' } })
    const after = apiFetch('/notes')
    await Promise.all([before, write, after])
    // the read, the write, and a fresh read: not two reads sharing the stale one
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
