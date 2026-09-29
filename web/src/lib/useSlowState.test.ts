// @vitest-environment jsdom

/**
 * The three thresholds this hook draws are the whole point of it — a screen
 * that shows "waking up the server" at 200ms or never shows it at all until
 * 25s would defeat the reason it exists. Pinned against the exported
 * constants rather than magic numbers, so a deliberate threshold change here
 * doesn't also require editing the test.
 */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SLOW_MS, STALLED_MS, useSlowState } from './useSlowState'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useSlowState', () => {
  it('is idle when nothing is pending', () => {
    const { result } = renderHook(() => useSlowState(false))
    expect(result.current).toBe('idle')
  })

  it('starts fast the instant something becomes pending', () => {
    const { result } = renderHook(({ pending }) => useSlowState(pending), {
      initialProps: { pending: true },
    })
    expect(result.current).toBe('fast')
  })

  it('moves to slow at SLOW_MS, and not a moment before', () => {
    const { result } = renderHook(({ pending }) => useSlowState(pending), {
      initialProps: { pending: true },
    })
    act(() => {
      vi.advanceTimersByTime(SLOW_MS - 1)
    })
    expect(result.current).toBe('fast')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe('slow')
  })

  it('moves to stalled at STALLED_MS', () => {
    const { result } = renderHook(({ pending }) => useSlowState(pending), {
      initialProps: { pending: true },
    })
    act(() => {
      vi.advanceTimersByTime(STALLED_MS)
    })
    expect(result.current).toBe('stalled')
  })

  it('resets to idle the moment pending goes false, even mid-wait', () => {
    const { result, rerender } = renderHook(({ pending }) => useSlowState(pending), {
      initialProps: { pending: true },
    })
    act(() => {
      vi.advanceTimersByTime(SLOW_MS + 500)
    })
    expect(result.current).toBe('slow')

    rerender({ pending: false })
    expect(result.current).toBe('idle')

    // A stray timer from the first pending window must not fire late and
    // resurrect a phase after the wait it described has already ended.
    act(() => {
      vi.advanceTimersByTime(STALLED_MS)
    })
    expect(result.current).toBe('idle')
  })

  it('starts a fresh fast→slow→stalled run for each new pending window', () => {
    const { result, rerender } = renderHook(({ pending }) => useSlowState(pending), {
      initialProps: { pending: true },
    })
    act(() => {
      vi.advanceTimersByTime(STALLED_MS)
    })
    expect(result.current).toBe('stalled')

    rerender({ pending: false })
    rerender({ pending: true })
    expect(result.current).toBe('fast')
  })
})
