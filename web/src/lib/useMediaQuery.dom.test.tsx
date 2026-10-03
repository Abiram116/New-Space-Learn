// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useMediaQuery } from './useMediaQuery'

type Listener = () => void

/** A controllable stand-in for `matchMedia`, so a width change can be simulated. */
function installMatchMedia(initial: boolean) {
  let matches = initial
  const listeners = new Set<Listener>()
  window.matchMedia = ((query: string) => ({
    get matches() {
      return matches
    },
    media: query,
    addEventListener: (_: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia
  return {
    set(next: boolean) {
      matches = next
      listeners.forEach((fn) => fn())
    },
    listenerCount: () => listeners.size,
  }
}

afterEach(() => {
  cleanup()
  // @ts-expect-error — restore jsdom's default (no matchMedia).
  delete window.matchMedia
})

describe('useMediaQuery', () => {
  it('reads the current match and follows it as the window changes', () => {
    const media = installMatchMedia(false)
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'))
    expect(result.current).toBe(false)

    act(() => media.set(true))
    expect(result.current).toBe(true)
    act(() => media.set(false))
    expect(result.current).toBe(false)
  })

  it('stops listening when the component goes away', () => {
    const media = installMatchMedia(true)
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 1024px)'))
    expect(media.listenerCount()).toBe(1)
    unmount()
    expect(media.listenerCount()).toBe(0)
  })

  it('reads as false where matchMedia does not exist', () => {
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'))
    expect(result.current).toBe(false)
  })
})
