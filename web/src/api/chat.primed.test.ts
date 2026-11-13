// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

const apiFetch = vi.fn(async () => [{ id: 'm1' }])
vi.mock('./client', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...(a as [])), apiFetchRaw: vi.fn() }))

import { listMessages, prefetchMessages } from './chat'

afterEach(() => {
  apiFetch.mockClear()
  vi.useRealTimers()
})

describe('a history asked for ahead of the visit', () => {
  it('is handed to the page instead of being requested again, once', async () => {
    prefetchMessages('t1')
    await listMessages('t1')
    expect(apiFetch).toHaveBeenCalledTimes(1)
    await listMessages('t1')
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })

  it('is not trusted once it is old', async () => {
    vi.useFakeTimers()
    prefetchMessages('t2')
    vi.advanceTimersByTime(25_000)
    await listMessages('t2')
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })
})
