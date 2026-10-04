// @vitest-environment jsdom

/**
 * The agent run card is told by the agent doing the work. What must hold:
 * the right bot for the job, its mood tracking the run (working → thinking
 * once slow → happy | oops), and — with the bots switched off — every fact
 * and button still there, just without the character.
 */

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setBotsEnabled } from '../../lib/botPreference'
import { AgentRunCard, SLOW_AFTER_S } from './AgentRunCard'
import type { AgentRun } from './useAgentRuns'

const run = (over: Partial<AgentRun> = {}): AgentRun => ({
  id: 1,
  agent: 'flashcards',
  status: 'running',
  startedAt: Date.now(),
  title: 'Making 8 flashcards from this answer…',
  ...over,
})
const noop = () => {}
const bot = () => document.querySelector<SVGSVGElement>('svg.bot')

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  act(() => setBotsEnabled(true))
})

describe('AgentRunCard bots', () => {
  it.each([
    ['flashcards', 'cards'],
    ['quiz', 'quiz'],
    ['notes', 'notes'],
  ] as const)('%s runs are shown by the %s bot', (agent, id) => {
    render(<AgentRunCard run={run({ agent })} onOpen={noop} onRetry={noop} onDismiss={noop} />)
    expect(bot()?.dataset.agent).toBe(id)
    expect(bot()?.dataset.mood).toBe('working')
  })

  it('speaks a generating line that only states the requested count, then thinks once slow', () => {
    vi.useFakeTimers()
    render(<AgentRunCard run={run()} onOpen={noop} onRetry={noop} onDismiss={noop} />)
    const line = document.querySelector('.bot-progress-line')!.textContent ?? ''
    expect(line.length).toBeGreaterThan(0)
    for (const n of line.match(/\d+/g) ?? []) expect(n).toBe('8')
    act(() => void vi.advanceTimersByTime((SLOW_AFTER_S + 1) * 1000))
    expect(bot()?.dataset.mood).toBe('thinking')
    expect(screen.getByText(/server can be slow to wake up/i)).toBeInTheDocument()
  })

  it('is happy on success, with the real count and the Open button', () => {
    render(
      <AgentRunCard
        run={run({ status: 'done', doneText: '6 cards ready', href: '/x', count: 6 })}
        onOpen={noop}
        onRetry={noop}
        onDismiss={noop}
      />,
    )
    expect(bot()?.dataset.mood).toBe('done')
    for (const n of document.querySelector('.bot-progress-line')!.textContent?.match(/\d+/g) ?? []) expect(n).toBe('6')
    expect(screen.getByRole('button', { name: /open deck/i })).toBeInTheDocument()
    // No clock on a finished run.
    expect(document.querySelector('.bot-progress-time')).toBeNull()
  })

  it('says oops (never blaming the student) beside Retry on failure', () => {
    render(
      <AgentRunCard run={run({ status: 'error', error: 'The AI is busy.' })} onOpen={noop} onRetry={noop} onDismiss={noop} />,
    )
    expect(bot()?.dataset.mood).toBe('oops')
    expect(document.querySelector('.bot-progress-line')!.textContent).not.toMatch(/your fault|you broke/i)
    expect(screen.getByText('The AI is busy.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('keeps every fact and button with the bots switched off', () => {
    act(() => setBotsEnabled(false))
    const { rerender } = render(<AgentRunCard run={run()} onOpen={noop} onRetry={noop} onDismiss={noop} />)
    expect(bot()).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Making 8 flashcards from this answer…')
    expect(document.querySelector('.bot-progress-bar')).not.toBeNull()
    rerender(
      <AgentRunCard run={run({ status: 'error', error: 'Nope.' })} onOpen={noop} onRetry={noop} onDismiss={noop} />,
    )
    expect(bot()).toBeNull()
    expect(screen.getByText('Nope.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument()
  })
})
