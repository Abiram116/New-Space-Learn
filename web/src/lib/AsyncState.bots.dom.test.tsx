// @vitest-environment jsdom

/**
 * Nova carries AsyncState's full-size states — thinking while slow, asleep
 * once stalled, an oops face with a non-blaming line beside Retry on a hard
 * failure — and every one of them still reads (and still has its button)
 * with the bots switched off.
 */

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AsyncState } from './AsyncState'
import { setBotsEnabled } from './botPreference'
import { LINES } from './botVoice'
import { SLOW_MS, STALLED_MS } from './useSlowState'

const bot = () => document.querySelector<SVGSVGElement>('svg.bot')
const loading = () => (
  <AsyncState data={null} error={null} loading onRetry={vi.fn()} skeleton={<div data-testid="sk" />}>
    {() => <div />}
  </AsyncState>
)

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  act(() => setBotsEnabled(true))
})

describe('AsyncState bots', () => {
  it('stays out of an ordinary load, thinks once slow, sleeps once stalled', () => {
    render(loading())
    expect(bot()).toBeNull()
    act(() => void vi.advanceTimersByTime(SLOW_MS))
    expect(bot()?.dataset.mood).toBe('thinking')
    act(() => void vi.advanceTimersByTime(STALLED_MS - SLOW_MS))
    expect(bot()?.dataset.mood).toBe('sleepy')
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('says a non-blaming error line beside Retry', () => {
    render(
      <AsyncState data={null} error="Server error." errorKind="server" loading={false} onRetry={vi.fn()} skeleton={<div />}>
        {() => <div />}
      </AsyncState>,
    )
    expect(bot()?.dataset.mood).toBe('oops')
    const retry = screen.getByRole('button', { name: /retry/i })
    const beside = retry.parentElement!.textContent ?? ''
    expect(LINES.error.any!.some((l) => beside.includes(l))).toBe(true)
  })

  it('falls back to the plain glyphs with the bots off, words and Retry intact', () => {
    act(() => setBotsEnabled(false))
    render(
      <AsyncState data={null} error="Server error." errorKind="server" loading={false} onRetry={vi.fn()} skeleton={<div />}>
        {() => <div />}
      </AsyncState>,
    )
    expect(bot()).toBeNull()
    expect(screen.getByText('Something went wrong on our side')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})
