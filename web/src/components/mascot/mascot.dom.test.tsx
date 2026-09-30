// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENT_IDS, AGENTS, BOT_MOODS, BOT_NAME, Bot, BotProgress, BotSays, formatElapsed, useBotMood, type BotSituation } from '.'

afterEach(cleanup)

describe('Bot', () => {
  it('is decorative by default', () => {
    const { container } = render(<Bot />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).not.toHaveAttribute('role')
  })

  it('becomes an image when labelled', () => {
    render(<Bot agent="quiz" mood="celebrate" label="Pop is celebrating" />)
    expect(screen.getByRole('img', { name: 'Pop is celebrating' })).toBeInTheDocument()
  })

  it('renders every mood for every agent', () => {
    for (const agent of AGENT_IDS)
      for (const mood of BOT_MOODS) {
        const { container, unmount } = render(<Bot agent={agent} mood={mood} size={48} />)
        const svg = container.querySelector('svg')!
        expect(svg.dataset.mood).toBe(mood)
        expect(svg.dataset.agent).toBe(agent)
        unmount()
      }
  })

  it('names the tutor from BOT_NAME', () => {
    expect(AGENTS.tutor.name).toBe(BOT_NAME)
  })
})

describe('BotSays / BotProgress', () => {
  it('speaks in real text', () => {
    render(
      <BotSays agent="notes" showName live>
        No notes yet.
      </BotSays>,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Jot')
    expect(screen.getByText('No notes yet.')).toBeInTheDocument()
  })

  it('shows the line as a status and counts elapsed time', () => {
    render(<BotProgress agent="cards" line="Dealing you a fresh deck." startedAt={Date.now() - 65_000} />)
    expect(screen.getByRole('status')).toHaveTextContent('Dealing you a fresh deck.')
    expect(document.querySelector('.bot-progress-time')).toHaveTextContent('1m 05s')
  })

  it('formats elapsed time', () => {
    expect([formatElapsed(0), formatElapsed(9_400), formatElapsed(125_000)]).toEqual(['0s', '9s', '2m 05s'])
  })
})

describe('useBotMood', () => {
  it('maps situations, wakes before answering, and settles after a win', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ s }: { s: BotSituation }) => useBotMood(s, { ambient: false }), {
      initialProps: { s: 'asleep' as BotSituation },
    })
    expect(result.current).toBe('sleepy')
    rerender({ s: 'loading' })
    expect(result.current).toBe('waking')
    act(() => void vi.advanceTimersByTime(2400))
    expect(result.current).toBe('working')
    rerender({ s: 'error' })
    expect(result.current).toBe('oops')
    rerender({ s: 'success' })
    expect(result.current).toBe('happy')
    act(() => void vi.advanceTimersByTime(3600))
    expect(result.current).toBe('idle')
    vi.useRealTimers()
  })
})
