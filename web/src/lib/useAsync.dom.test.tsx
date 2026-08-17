// @vitest-environment jsdom
/**
 * The 2026-08 end-to-end audit found a real, systemic bug: `setData`'s
 * keyed branch read `prev` straight from the cache — but `client.ts`
 * invalidates a mutation's cache family *synchronously*, inside the fetch
 * call itself, before the caller's own `await` even resumes. So by the time
 * a component did `cards.setData(prev => [...(prev ?? []), created])` right
 * after `await createCard(...)`, the cache for that key was already empty:
 * `prev` was `null`, and "append one card" silently became "replace the
 * whole list with just this one card". The same shape hit editing (list
 * became empty) and deleting (list also became empty) across
 * `FlashcardsView.tsx`'s deck/card CRUD.
 *
 * This drives the real hook end to end — write the cache, invalidate it the
 * way a mutation genuinely would, then call `setData` — rather than testing
 * the fix in isolation from the bug it was fixing.
 */

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAsync } from './useAsync'
import { invalidate, readCache, writeCache } from './asyncCache'

afterEach(() => {
  // The cache is a module-level singleton — leaking an entry between tests
  // would make one test's fixture pollute the next.
  vi.restoreAllMocks()
})

describe('setData survives its own key being invalidated out from under it', () => {
  it('appends onto the real list, not onto null, when the cache was just cleared', async () => {
    const key = `test-cards:${Math.random()}`
    const { result } = renderHook(() => useAsync(() => Promise.resolve(['existing']), [], key))

    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.data).toEqual(['existing'])

    // Both inside one `act()`, on purpose: in production, `invalidateFor`
    // runs synchronously inside the fetch call, and the caller's own
    // `.setData()` runs as the very next line after `await` resumes — no
    // React render lands in between the two. Splitting these across two
    // separate `act()` calls would let the test harness flush a render
    // between them that the real race never gets, and the bug would
    // disappear from the test without the fix actually being exercised.
    act(() => {
      invalidate('test-cards:')
      expect(readCache(key)).toBeUndefined() // confirms the race is real, not assumed
      result.current.setData((prev) => [...(prev ?? []), 'created'])
    })

    expect(result.current.data).toEqual(['existing', 'created'])
  })

  it('replaces the right item, not nothing, when editing races the same invalidation', async () => {
    const key = `test-cards:${Math.random()}`
    const { result } = renderHook(() =>
      useAsync(() => Promise.resolve([{ id: 'a', text: 'old' }]), [], key),
    )
    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      invalidate('test-cards:')
      result.current.setData((prev) =>
        prev ? prev.map((c) => (c.id === 'a' ? { id: 'a', text: 'new' } : c)) : prev,
      )
    })

    expect(result.current.data).toEqual([{ id: 'a', text: 'new' }])
  })

  it('still prefers a genuinely fresher cache write over the stale render, when there is one', async () => {
    // Not every `readCache` miss is this race — a real revalidation landing
    // in between must still win. The fallback only matters when the cache
    // is actually empty.
    const key = `test-cards:${Math.random()}`
    const { result } = renderHook(() => useAsync(() => Promise.resolve(['first']), [], key))
    await act(async () => {
      await Promise.resolve()
    })

    // A background revalidation (or another tab) wrote a newer value —
    // this is NOT the invalidation race, so it must be respected.
    act(() => writeCache(key, ['revalidated']))

    act(() => {
      result.current.setData((prev) => [...(prev ?? []), 'appended'])
    })

    expect(result.current.data).toEqual(['revalidated', 'appended'])
  })

  it('the un-keyed path is untouched — still lets React supply the latest local state', async () => {
    const { result } = renderHook(() => useAsync(() => Promise.resolve(['a'])))
    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      result.current.setData((prev) => [...(prev ?? []), 'b'])
      result.current.setData((prev) => [...(prev ?? []), 'c'])
    })

    // Two synchronous setData calls in the same act() — only correct if
    // each one really does see the other's result, which is what routing
    // straight through setState (rather than a ref read twice) guarantees.
    expect(result.current.data).toEqual(['a', 'b', 'c'])
  })
})
