// @vitest-environment jsdom
/**
 * `createSessionCache` sits behind the brief and stats caches on Home, and the
 * plan records it having already caused a real outage: when `StatsOut` grew
 * `due_forecast`, `composition` and `daily_goal`, every session already
 * holding the old shape in `sessionStorage` kept being served it — and Home
 * crashed reading `.map` off an absent array. `test_isValid_rejects...` below
 * is that regression, pinned so it cannot come back unnoticed.
 *
 * The other property worth locking down is what this module is *for*: TTL
 * freshness and request dedup are the two real bugs its docstring says it
 * fixes, and persistence across a fresh module instance (a reload, not just
 * in-app navigation) is the whole reason it writes to `sessionStorage` at all
 * rather than staying an in-memory cache.
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

describe('dedup', () => {
  it('collapses two concurrent gets into one fetch', async () => {
    let calls = 0
    const cache = createSessionCache<string>({
      key: 'sl:test:dedup',
      ttlMs: 60_000,
      fetcher: async () => {
        calls++
        return 'value'
      },
    })

    const [a, b] = await Promise.all([cache.get(), cache.get()])
    expect(a).toBe('value')
    expect(b).toBe('value')
    expect(calls).toBe(1)
  })
})

describe('TTL freshness', () => {
  it('serves from memory within the TTL without refetching', async () => {
    let calls = 0
    const cache = createSessionCache<number>({
      key: 'sl:test:ttl',
      ttlMs: 60_000,
      fetcher: async () => ++calls,
    })

    expect(await cache.get()).toBe(1)
    vi.advanceTimersByTime(59_000)
    expect(await cache.get()).toBe(1)
    expect(calls).toBe(1)
  })

  it('refetches once the TTL has passed', async () => {
    let calls = 0
    const cache = createSessionCache<number>({
      key: 'sl:test:ttl-expire',
      ttlMs: 60_000,
      fetcher: async () => ++calls,
    })

    expect(await cache.get()).toBe(1)
    vi.advanceTimersByTime(60_001)
    expect(await cache.get()).toBe(2)
    expect(calls).toBe(2)
  })
})

describe('persists across a fresh instance — a reload, not just in-app navigation', () => {
  it('a new cache created with the same key reads the still-fresh persisted value', async () => {
    let firstFetcherCalls = 0
    const first = createSessionCache<string>({
      key: 'sl:test:persist',
      ttlMs: 60_000,
      fetcher: async () => {
        firstFetcherCalls++
        return 'from first instance'
      },
    })
    await first.get()
    expect(firstFetcherCalls).toBe(1)

    // A second instance with the same key, as module re-evaluation on a page
    // reload would produce — its OWN `memory` closure starts empty, so this
    // only passes if it actually reads sessionStorage rather than assuming
    // a cold start.
    let secondFetcherCalls = 0
    const second = createSessionCache<string>({
      key: 'sl:test:persist',
      ttlMs: 60_000,
      fetcher: async () => {
        secondFetcherCalls++
        return 'from second instance'
      },
    })
    const value = await second.get()
    expect(value).toBe('from first instance')
    expect(secondFetcherCalls).toBe(0)
  })

  it('a fresh instance still honours the TTL against the persisted timestamp', async () => {
    const first = createSessionCache<string>({
      key: 'sl:test:persist-ttl',
      ttlMs: 60_000,
      fetcher: async () => 'stale',
    })
    await first.get()
    vi.advanceTimersByTime(60_001)

    let secondFetcherCalls = 0
    const second = createSessionCache<string>({
      key: 'sl:test:persist-ttl',
      ttlMs: 60_000,
      fetcher: async () => {
        secondFetcherCalls++
        return 'fresh'
      },
    })
    expect(await second.get()).toBe('fresh')
    expect(secondFetcherCalls).toBe(1)
  })
})

describe('isValid rejects a stale shape — the actual outage', () => {
  it('does not serve a persisted payload missing fields the current build requires', async () => {
    // Simulate a session that cached the OLD `StatsOut` shape before
    // `due_forecast`/`composition` existed, sitting in sessionStorage from
    // before today's deploy.
    sessionStorage.setItem(
      'sl:test:shape',
      JSON.stringify({ at: Date.now(), value: { badges: [] } }),
    )

    let calls = 0
    const cache = createSessionCache<{ badges: unknown[]; due_forecast?: unknown[] }>({
      key: 'sl:test:shape',
      ttlMs: 60_000,
      fetcher: async () => {
        calls++
        return { badges: [], due_forecast: [] }
      },
      isValid: (v) => Array.isArray(v.badges) && Array.isArray(v.due_forecast),
    })

    const value = await cache.get()
    // Must have refetched the real shape rather than handing back the old one
    // — returning the stale `{ badges: [] }` here is exactly what crashed
    // Home reading `.due_forecast.map(...)`.
    expect(calls).toBe(1)
    expect(value.due_forecast).toEqual([])
  })

  it('accepts a persisted payload that does satisfy isValid, with no refetch', async () => {
    sessionStorage.setItem(
      'sl:test:shape-ok',
      JSON.stringify({ at: Date.now(), value: { badges: [], due_forecast: [] } }),
    )
    let calls = 0
    const cache = createSessionCache<{ badges: unknown[]; due_forecast: unknown[] }>({
      key: 'sl:test:shape-ok',
      ttlMs: 60_000,
      fetcher: async () => {
        calls++
        return { badges: [], due_forecast: [] }
      },
      isValid: (v) => Array.isArray(v.badges) && Array.isArray(v.due_forecast),
    })
    await cache.get()
    expect(calls).toBe(0)
  })
})

describe('degrades to "just refetch" rather than failing the page', () => {
  it('corrupt JSON in sessionStorage is treated as a cache miss', async () => {
    sessionStorage.setItem('sl:test:corrupt', '{not json')
    let calls = 0
    const cache = createSessionCache<string>({
      key: 'sl:test:corrupt',
      ttlMs: 60_000,
      fetcher: async () => {
        calls++
        return 'recovered'
      },
    })
    expect(await cache.get()).toBe('recovered')
    expect(calls).toBe(1)
  })

  it('a setItem failure (quota / private mode) does not stop get() from resolving', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    const cache = createSessionCache<string>({
      key: 'sl:test:quota',
      ttlMs: 60_000,
      fetcher: async () => 'value despite quota',
    })
    await expect(cache.get()).resolves.toBe('value despite quota')
  })
})

describe('failed fetch', () => {
  it('rejects the caller and does not wedge future gets behind a dead inflight promise', async () => {
    let attempt = 0
    const cache = createSessionCache<string>({
      key: 'sl:test:retry',
      ttlMs: 60_000,
      fetcher: async () => {
        attempt++
        if (attempt === 1) throw new Error('network down')
        return 'recovered'
      },
    })

    await expect(cache.get()).rejects.toThrow('network down')
    // If `inflight` were left set after a rejection, this would hang or
    // resolve to the same broken promise instead of retrying.
    expect(await cache.get()).toBe('recovered')
    expect(attempt).toBe(2)
  })
})

describe('clear', () => {
  it('forces a refetch even within the TTL', async () => {
    let calls = 0
    const cache = createSessionCache<number>({
      key: 'sl:test:clear',
      ttlMs: 60_000,
      fetcher: async () => ++calls,
    })
    expect(await cache.get()).toBe(1)
    cache.clear()
    expect(await cache.get()).toBe(2)
  })

  it('removes the persisted entry, so a fresh instance also misses', async () => {
    const first = createSessionCache<string>({
      key: 'sl:test:clear-persist',
      ttlMs: 60_000,
      fetcher: async () => 'value',
    })
    await first.get()
    first.clear()

    let calls = 0
    const second = createSessionCache<string>({
      key: 'sl:test:clear-persist',
      ttlMs: 60_000,
      fetcher: async () => {
        calls++
        return 'refetched'
      },
    })
    await second.get()
    expect(calls).toBe(1)
  })
})
