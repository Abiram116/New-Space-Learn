// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { isPageLocked, SCROLL_LOCK_EVENT, setPageScrollLocked } from './scrollLock'

describe('page lock (a card covering the landing page)', () => {
  it('tells the scroller by event and the animation loops by flag', () => {
    const heard = vi.fn()
    window.addEventListener(SCROLL_LOCK_EVENT, (e) => heard((e as CustomEvent<boolean>).detail))
    setPageScrollLocked(true)
    expect(isPageLocked()).toBe(true)
    setPageScrollLocked(false)
    expect(isPageLocked()).toBe(false)
    expect(heard.mock.calls).toEqual([[true], [false]])
  })
})
