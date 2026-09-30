// @vitest-environment jsdom
/**
 * The stale-while-revalidate half of `createSessionCache` — what lets Home
 * render from cache instantly and still describe the student as they are now.
 * The plain TTL behaviour is pinned in `sessionCache.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionCache } from './sessionCache'

beforeEach(() => {
  sessionStorage.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function make(over: Partial<Parameters<typeof createSessionCache<number>>[0]> = {}) {
  let calls = 0
  const cache = createSessionCache<number>({
    key: `sl:test:swr:${Math.random()}`,
    ttlMs: 180_000,
    revalidateAfterMs: 60_000,
    staleWaitMs: 1_500,
    fetcher: async () => ++calls,
    ...over,
  })
  return { cache, calls: () => calls }
}

describe('revalidateAfterMs', () => {
  it('serves an aging value instantly and refreshes behind it', async () => {
    const { cache, calls } = make()
    expect(await cache.get()).toBe(1)
    vi.advanceTimersByTime(61_000)

    expect(await cache.get()).toBe(1) // instant, still the old one
    await vi.advanceTimersByTimeAsync(0)
    expect(calls()).toBe(2) // …but a refresh was started
    expect(await cache.get()).toBe(2) // and the next read has it
  })

  it('does not refetch a young value', async () => {
    const { cache, calls } = make()
    await cache.get()
    vi.advanceTimersByTime(30_000)
    await cache.get()
    expect(calls()).toBe(1)
  })
})

describe('invalidate', () => {
  it('makes the next read fetch, and waits for it', async () => {
    const { cache, calls } = make()
    await cache.get()
    cache.invalidate()
    expect(await cache.get()).toBe(2)
    expect(calls()).toBe(2)
  })

  it('falls back to the old value if the refetch is slower than staleWaitMs', async () => {
    let n = 0
    const { cache } = make({
      fetcher: () =>
        ++n === 1 ? Promise.resolve(1) : new Promise((r) => setTimeout(() => r(2), 10_000)),
    })
    await cache.get()
    cache.invalidate()

    const read = cache.get()
    await vi.advanceTimersByTimeAsync(1_600)
    expect(await read).toBe(1) // did not block the page

    await vi.advanceTimersByTimeAsync(10_000) // the refresh still lands…
    expect(await cache.get()).toBe(2) // …and is used next time
  })

  it('falls back to the old value when the refetch fails', async () => {
    let n = 0
    const { cache } = make({
      fetcher: async () => {
        if (++n > 1) throw new Error('backend down')
        return 1
      },
    })
    await cache.get()
    cache.invalidate()
    expect(await cache.get()).toBe(1)
  })

  it('never stores an answer that was requested before the change', async () => {
    let release: (v: number) => void = () => {}
    let n = 0
    const { cache } = make({
      fetcher: () => (++n === 1 ? new Promise<number>((r) => (release = r)) : Promise.resolve(99)),
    })
    const first = cache.get() // asked before the change…
    cache.invalidate() // …the student then did something
    release(1)
    await first
    expect(cache.peek()).toBeUndefined() // the pre-change answer was not kept
    expect(await cache.get()).toBe(99)
  })

  it('survives a reload still marked out of date', async () => {
    const key = 'sl:test:swr:persist'
    const a = createSessionCache<number>({ key, ttlMs: 180_000, fetcher: async () => 1 })
    await a.get()
    a.invalidate()

    let calls = 0
    const b = createSessionCache<number>({
      key,
      ttlMs: 180_000,
      fetcher: async () => {
        calls++
        return 2
      },
    })
    expect(b.peek()).toBe(1) // still there to show
    expect(await b.get()).toBe(2) // but not trusted as current
    expect(calls).toBe(1)
  })
})

describe('revalidateIfOlderThan', () => {
  it('never starts a first load', async () => {
    const { cache, calls } = make()
    cache.revalidateIfOlderThan(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(calls()).toBe(0)
  })

  it('refreshes an old or invalidated value in the background', async () => {
    const { cache, calls } = make()
    await cache.get()
    cache.revalidateIfOlderThan(60_000)
    await vi.advanceTimersByTimeAsync(0)
    expect(calls()).toBe(1) // young: left alone

    cache.invalidate()
    cache.revalidateIfOlderThan(60_000)
    await vi.advanceTimersByTimeAsync(0)
    expect(calls()).toBe(2)
  })
})

describe('clear', () => {
  it('drops an answer still in flight, so a sign-out cannot be followed by the old account', async () => {
    let release: (v: number) => void = () => {}
    const { cache } = make({ fetcher: () => new Promise<number>((r) => (release = r)) })
    const pending = cache.get()
    cache.clear()
    release(7)
    await pending
    expect(cache.peek()).toBeUndefined()
  })
})

describe('onUpdate', () => {
  it('reports each stored value, not one that was discarded', async () => {
    const seen: number[] = []
    const { cache } = make({ onUpdate: (v) => seen.push(v) })
    await cache.get()
    cache.invalidate()
    await cache.get()
    expect(seen).toEqual([1, 2])
  })
})
