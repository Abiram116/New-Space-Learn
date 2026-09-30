// @vitest-environment jsdom

/**
 * Nova tells the connectivity story: asleep while the server wakes, an oops
 * face when it can't be reached, and a short "we're back" beat (waking, then
 * happy) only after real trouble. With the bots off it is the same strip in
 * plain words.
 */

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setBotsEnabled } from '../../lib/botPreference'
import { LINES } from '../../lib/botVoice'

const checkReady = vi.fn()
vi.mock('../../api/client', () => ({ checkReady: (...a: unknown[]) => checkReady(...a) }))
vi.mock('../../lib/connectivity', () => ({ notifyBackendReady: vi.fn() }))

import { BACK_MS, OfflineBanner } from './OfflineBanner'

const flush = () =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
const bot = () => document.querySelector<SVGSVGElement>('svg.bot')
const WAKING = LINES.waking.any!

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
  act(() => setBotsEnabled(true))
})

describe('OfflineBanner bots', () => {
  it('shows a sleepy Nova with a waking line while the server wakes, then a short back beat', async () => {
    checkReady
      .mockResolvedValueOnce({ ready: false, database: true, embeddings: true })
      .mockResolvedValue({ ready: true, database: true, embeddings: true })
    render(<OfflineBanner />)
    await flush()
    expect(bot()?.dataset.mood).toBe('sleepy')
    const text = screen.getByRole('status').textContent ?? ''
    expect(WAKING.some((l) => text.includes(l))).toBe(true)
    expect(text).toMatch(/up to a minute/i)

    await act(async () => void (await vi.advanceTimersByTimeAsync(2_500)))
    expect(screen.getByRole('status')).toHaveTextContent(/connected again/i)
    expect(bot()?.dataset.mood).toBe('waking')
    await act(async () => void (await vi.advanceTimersByTimeAsync(2_400)))
    expect(bot()?.dataset.mood).toBe('happy')
    await act(async () => void (await vi.advanceTimersByTimeAsync(BACK_MS)))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('never shows the back beat when nothing was wrong', async () => {
    checkReady.mockResolvedValue({ ready: true, database: true, embeddings: true })
    const { container } = render(<OfflineBanner />)
    await flush()
    await act(async () => void (await vi.advanceTimersByTimeAsync(15_000)))
    expect(container).toBeEmptyDOMElement()
  })

  it('wears an oops face when the server cannot be reached', async () => {
    checkReady.mockResolvedValue(null)
    render(<OfflineBanner />)
    await flush()
    await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)))
    expect(bot()?.dataset.mood).toBe('oops')
  })

  it('keeps the words, not the character, with the bots off', async () => {
    act(() => setBotsEnabled(false))
    checkReady.mockResolvedValue({ ready: false, database: false, embeddings: true })
    render(<OfflineBanner />)
    await flush()
    expect(bot()).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(/reconnecting to the database/i)
  })
})
