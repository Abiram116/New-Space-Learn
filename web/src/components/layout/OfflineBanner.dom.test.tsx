// @vitest-environment jsdom

/**
 * The banner has to get three things right: stay quiet through one blip
 * (debounced against `REQUIRED_FAILURES`), say something DIFFERENT once the
 * server answers but isn't ready yet versus once it can't be reached at all,
 * and tell the rest of the app the moment it recovers so a dead screen can
 * retry itself — see `lib/connectivity.ts`.
 */

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const checkReady = vi.fn()
const notifyBackendReady = vi.fn()

vi.mock('../../api/client', () => ({
  checkReady: (...args: unknown[]) => checkReady(...args),
}))
vi.mock('../../lib/connectivity', () => ({
  notifyBackendReady: (...args: unknown[]) => notifyBackendReady(...args),
}))

import { OfflineBanner } from './OfflineBanner'

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('OfflineBanner', () => {
  it('renders nothing while the backend is healthy', async () => {
    checkReady.mockResolvedValue({ ready: true, database: true, embeddings: true })
    const { container } = render(<OfflineBanner />)
    await flush()
    expect(container).toBeEmptyDOMElement()
  })

  it('stays quiet through a single unreachable poll', async () => {
    checkReady.mockResolvedValue(null)
    const { container } = render(<OfflineBanner />)
    await flush()
    expect(checkReady).toHaveBeenCalledTimes(1)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows "offline" copy once failures clear REQUIRED_FAILURES', async () => {
    checkReady.mockResolvedValue(null)
    render(<OfflineBanner />)
    await flush()
    // First retry is scheduled at the shortest backoff step (3s).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    expect(screen.getByRole('status').textContent).toMatch(/can't reach the server/i)
  })

  it('shows a distinct "waking up" note when the server answers but is not ready', async () => {
    checkReady.mockResolvedValue({ ready: false, database: false, embeddings: true })
    render(<OfflineBanner />)
    await flush()
    expect(screen.getByRole('status').textContent).toMatch(/reconnecting to the database/i)
  })

  it('notifies the app to retry failed loads on recovery, and only once', async () => {
    checkReady
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ ready: true, database: true, embeddings: true })

    render(<OfflineBanner />)
    await flush() // 1st call: null
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000) // 2nd call: null -> now "offline"
    })
    expect(screen.getByRole('status')).toBeTruthy()
    expect(notifyBackendReady).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000) // 3rd call: ready -> recovery
    })
    expect(notifyBackendReady).toHaveBeenCalledTimes(1)
    expect(checkReady).toHaveBeenCalledTimes(3)
  })

  it('does not notify on a poll that was already healthy', async () => {
    checkReady.mockResolvedValue({ ready: true, database: true, embeddings: true })
    render(<OfflineBanner />)
    await flush()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(notifyBackendReady).not.toHaveBeenCalled()
  })
})
