// @vitest-environment jsdom

/**
 * The request cache is what removes the flash on every page switch, and it
 * buys that by keeping data around after the screen that fetched it is gone.
 * Everything worth testing here is about that trade being safe:
 *
 * - it must serve the previous value (that is the whole point),
 * - it must stop serving it once a mutation makes it wrong,
 * - and it must not survive a sign-out, because the next person to use this
 *   browser would be handed the last person's notes instantly and silently.
 *
 * The last one is the reason this file exists at all. A cache that leaks
 * across accounts is not a performance bug, it is a data-exposure bug, and it
 * would look exactly like the feature working correctly.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCache, invalidate, readCache, subscribe, writeCache } from './asyncCache'

beforeEach(() => {
  clearCache()
})

describe('reading and writing', () => {
  it('serves what was written', () => {
    writeCache('notes:a', [{ id: '1' }])
    expect(readCache<{ id: string }[]>('notes:a')?.data).toEqual([{ id: '1' }])
  })

  it('returns undefined for a key it has never seen', () => {
    expect(readCache('notes:never')).toBeUndefined()
  })

  it('keeps keys independent', () => {
    writeCache('notes:a', 'A')
    writeCache('notes:b', 'B')
    expect(readCache('notes:a')?.data).toBe('A')
    expect(readCache('notes:b')?.data).toBe('B')
  })
})

describe('invalidation', () => {
  it('drops a whole family by prefix', () => {
    writeCache('notes:a', 'A')
    writeCache('notes:b', 'B')
    writeCache('decks:a', 'D')

    invalidate('notes:')

    expect(readCache('notes:a')).toBeUndefined()
    expect(readCache('notes:b')).toBeUndefined()
    // A different family is untouched — invalidating everything on any write
    // would throw away the benefit entirely.
    expect(readCache('decks:a')?.data).toBe('D')
  })

  it('notifies a mounted screen so it refetches rather than sitting on stale data', () => {
    const seen = vi.fn()
    writeCache('notes:a', 'A')
    subscribe('notes:a', seen)

    invalidate('notes:')

    expect(seen).toHaveBeenCalled()
  })

  it('notifies subscribers when a key is rewritten', () => {
    const seen = vi.fn()
    subscribe('notes:a', seen)
    writeCache('notes:a', 'A')
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('stops notifying after unsubscribe', () => {
    const seen = vi.fn()
    const off = subscribe('notes:a', seen)
    off()
    writeCache('notes:a', 'A')
    expect(seen).not.toHaveBeenCalled()
  })
})

describe('account isolation', () => {
  it('clearCache leaves nothing behind for the next account', () => {
    writeCache('notes:a', 'A')
    writeCache('decks:b', 'B')
    writeCache('quizzes:c', 'C')

    clearCache()

    // Signing out and back in as someone else must not surface any of this.
    expect(readCache('notes:a')).toBeUndefined()
    expect(readCache('decks:b')).toBeUndefined()
    expect(readCache('quizzes:c')).toBeUndefined()
  })

  it('wakes mounted screens on clear, so none keeps rendering the old account', () => {
    const seen = vi.fn()
    subscribe('notes:a', seen)
    writeCache('notes:a', 'A')
    seen.mockClear()

    clearCache()

    expect(seen).toHaveBeenCalled()
  })
})

describe('bounded growth', () => {
  it('evicts rather than growing without limit across a long session', () => {
    for (let i = 0; i < 200; i += 1) writeCache(`k:${i}`, i)
    // The earliest keys are gone; the most recent are kept.
    expect(readCache('k:0')).toBeUndefined()
    expect(readCache('k:199')?.data).toBe(199)
  })

  it('rewriting an existing key does not evict anything', () => {
    writeCache('keep', 1)
    for (let i = 0; i < 50; i += 1) writeCache('keep', i)
    expect(readCache('keep')?.data).toBe(49)
  })
})
