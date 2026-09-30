// @vitest-environment jsdom

/**
 * The drawn face is a lazy chunk: before it arrives a bot holds its exact box
 * (nothing around it moves when it pops in), then it renders for real. And a
 * slow list only gets its working bot once the wait is worth naming.
 */

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SLOW_MS, STALLED_MS } from '../../lib/useSlowState'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('lazy face', () => {
  it('holds a size-exact slot until the face loads, then draws it', async () => {
    vi.resetModules()
    const { Bot, loadBotFace } = await import('./Bot')
    const { container } = render(<Bot agent="quiz" size={64} />)
    const slot = container.querySelector<HTMLElement>('.bot-slot')
    // Either still pending (slot) or already resolved from the module cache —
    // when pending, the slot must be the bot's exact size.
    if (slot) {
      expect(slot.style.width).toBe('64px')
      expect(slot.style.height).toBe('64px')
      expect(slot).toHaveAttribute('aria-hidden', 'true')
    }
    await act(async () => {
      await loadBotFace()
    })
    expect(container.querySelector('.bot-slot')).toBeNull()
    expect(container.querySelector('svg.bot')?.getAttribute('width')).toBe('64')
  })
})

describe('SlowBot', () => {
  it('is silent for an ordinary load, works once slow, sleeps once stalled', async () => {
    vi.useFakeTimers()
    const { SlowBot } = await import('./SlowBot')
    const { container, rerender } = render(<SlowBot pending agent="notes" />)
    expect(container).toBeEmptyDOMElement()
    act(() => void vi.advanceTimersByTime(SLOW_MS))
    expect(container.querySelector<SVGSVGElement>('svg.bot')?.dataset.mood).toBe('working')
    expect(container.querySelector('[role="status"]')?.textContent).not.toBe('')
    act(() => void vi.advanceTimersByTime(STALLED_MS - SLOW_MS))
    expect(container.querySelector<SVGSVGElement>('svg.bot')?.dataset.mood).toBe('sleepy')
    rerender(<SlowBot pending={false} agent="notes" />)
    expect(container).toBeEmptyDOMElement()
  })
})
