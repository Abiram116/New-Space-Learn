// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentRunCard, SLOW_AFTER_S } from './AgentRunCard'
import { ActiveAgentsStrip } from './ContextDock'
import type { AgentRun } from './useAgentRuns'

const base: AgentRun = {
  id: 1,
  agent: 'flashcards',
  status: 'running',
  startedAt: Date.now(),
  title: 'Making 8 flashcards from this answer…',
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const noop = () => {}

describe('AgentRunCard', () => {
  it('shows the progress title and a live elapsed counter, then the slow hint', () => {
    vi.useFakeTimers()
    const startedAt = Date.now()
    render(
      <AgentRunCard run={{ ...base, startedAt }} onOpen={noop} onRetry={noop} onDismiss={noop} />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Making 8 flashcards from this answer…')
    expect(screen.getByRole('status')).toHaveTextContent('0s')
    expect(screen.queryByText(/still working/i)).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime((SLOW_AFTER_S + 1) * 1000)
    })
    expect(screen.getByRole('status')).toHaveTextContent(`${SLOW_AFTER_S + 1}s`)
    expect(screen.getByText(/still working — the server can be slow to wake up/i)).toBeInTheDocument()
  })

  it('shows the result with an Open button when done', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const run: AgentRun = { ...base, status: 'done', doneText: '8 cards ready', href: '/x' }
    render(<AgentRunCard run={run} onOpen={onOpen} onRetry={noop} onDismiss={noop} />)
    expect(screen.getByText('8 cards ready')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /open deck/i }))
    expect(onOpen).toHaveBeenCalledWith(run)
  })

  it('shows the error with Retry and Dismiss on failure', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const onDismiss = vi.fn()
    const run: AgentRun = { ...base, status: 'error', error: 'Rate limited, try again.' }
    render(<AgentRunCard run={run} onOpen={noop} onRetry={onRetry} onDismiss={onDismiss} />)
    expect(screen.getByText('Rate limited, try again.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledWith(run)
    await user.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(onDismiss).toHaveBeenCalledWith(run)
  })
})

describe('busy agent buttons', () => {
  it('switches to a disabled busy state with the running label', () => {
    render(<ActiveAgentsStrip onRunAgent={noop} busy={{ flashcards: true }} />)
    const busy = screen.getByRole('button', { name: /making cards/i })
    expect(busy).toBeDisabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')
    // Others stay usable.
    expect(screen.getByRole('button', { name: /make a quiz/i })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /^make cards$/i })).not.toBeInTheDocument()
  })
})
