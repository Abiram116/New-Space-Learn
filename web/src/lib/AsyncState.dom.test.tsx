// @vitest-environment jsdom

/**
 * `AsyncState` is the generic wrapper a simple screen gets the whole
 * resilience treatment from for free — see its own doc comment for the five
 * states it has to get right. Each one gets its own case: the skeleton must
 * not linger once the wait is worth naming, the stalled state must offer a
 * real way out, a hard failure must pick copy that matches what actually
 * went wrong, and stale data must survive a failed background refresh
 * instead of being wiped.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AsyncState } from './AsyncState'
import { SLOW_MS, STALLED_MS } from './useSlowState'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('AsyncState — first load', () => {
  it('shows the caller skeleton while the wait is still ordinary', () => {
    render(
      <AsyncState
        data={null}
        error={null}
        loading
        onRetry={vi.fn()}
        skeleton={<div data-testid="skeleton" />}
      >
        {() => <div>content</div>}
      </AsyncState>,
    )
    expect(screen.getByTestId('skeleton')).toBeInTheDocument()
  })

  it('names the wait once it crosses SLOW_MS', () => {
    render(
      <AsyncState data={null} error={null} loading onRetry={vi.fn()} skeleton={<div />}>
        {() => <div>content</div>}
      </AsyncState>,
    )
    act(() => {
      vi.advanceTimersByTime(SLOW_MS)
    })
    expect(screen.getByText(/waking up the server/i)).toBeInTheDocument()
  })

  it('offers a manual retry once the wait is stalled', () => {
    const onRetry = vi.fn()
    render(
      <AsyncState data={null} error={null} loading onRetry={onRetry} skeleton={<div />}>
        {() => <div>content</div>}
      </AsyncState>,
    )
    act(() => {
      vi.advanceTimersByTime(STALLED_MS)
    })
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe('AsyncState — hard failure, no data yet', () => {
  it('picks offline copy for an unreachable server', () => {
    render(
      <AsyncState
        data={null}
        error="Can't reach the server. Check your connection and try again."
        errorKind="offline"
        loading={false}
        onRetry={vi.fn()}
        skeleton={<div />}
      >
        {() => <div>content</div>}
      </AsyncState>,
    )
    expect(screen.getByText("Can't reach the server")).toBeInTheDocument()
  })

  it('picks "the AI is busy" copy for a rate-limited error', () => {
    render(
      <AsyncState
        data={null}
        error="The AI is at capacity right now."
        errorKind="rate_limited"
        loading={false}
        onRetry={vi.fn()}
        skeleton={<div />}
      >
        {() => <div>content</div>}
      </AsyncState>,
    )
    expect(screen.getByText('The AI is busy')).toBeInTheDocument()
  })

  it('offers no retry for an auth failure — the session is already ending', () => {
    render(
      <AsyncState
        data={null}
        error="Your session has expired. Sign in again."
        errorKind="auth"
        loading={false}
        onRetry={vi.fn()}
        skeleton={<div />}
      >
        {() => <div>content</div>}
      </AsyncState>,
    )
    expect(screen.getByText('Session expired')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
  })
})

describe('AsyncState — stale-while-revalidate', () => {
  it('keeps rendering the data during a background refresh, with a quiet indicator', () => {
    render(
      <AsyncState data={{ n: 1 }} error={null} loading={false} validating onRetry={vi.fn()} skeleton={<div />}>
        {(d) => <div>value {d.n}</div>}
      </AsyncState>,
    )
    expect(screen.getByText('value 1')).toBeInTheDocument()
  })

  it('keeps the stale data on screen when a background refresh fails, with an inline notice', () => {
    const onRetry = vi.fn()
    render(
      <AsyncState
        data={{ n: 1 }}
        error="Can't reach the server."
        errorKind="offline"
        loading={false}
        validating={false}
        onRetry={onRetry}
        skeleton={<div />}
      >
        {(d) => <div>value {d.n}</div>}
      </AsyncState>,
    )
    expect(screen.getByText('value 1')).toBeInTheDocument()
    expect(screen.getByText(/couldn't refresh/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Try again'))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
