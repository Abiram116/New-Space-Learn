// @vitest-environment jsdom
/**
 * The wait between sending and the first word is always said out loud —
 * on every turn, with or without sources, however long the server takes.
 */

import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import { SLOW_MS, STALLED_MS } from '../../lib/useSlowState'

vi.mock('../../api/documents', () => ({ getPassage: vi.fn() }))
vi.mock('../../api/notes', () => ({
  createNote: vi.fn(),
  updateNote: vi.fn(),
  listNotes: vi.fn().mockResolvedValue([]),
}))

import { ChatMessage } from './ChatMessage'
import { StreamingMessage } from './StreamingMessage'
import { StreamPacer } from './streamPacer'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const show = (pacer: StreamPacer) =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <StreamingMessage pacer={pacer} citations={[]} base="/s/a/b" onGrow={() => {}} />
      </ToastProvider>
    </MemoryRouter>,
  )

describe('thinking, between send and the first word', () => {
  it('shows at once on a turn with no sources, in words as well as dots', () => {
    show(new StreamPacer({ instant: true }))
    expect(screen.getByRole('status', { name: 'Thinking…' })).toBeInTheDocument()
    expect(screen.getByText('Thinking…')).toBeInTheDocument()
    expect(screen.queryByText(/Answered from/)).not.toBeInTheDocument()
  })

  it('stays while what has arrived cannot be shown yet, and goes with the first word', () => {
    const pacer = new StreamPacer({ instant: true })
    show(pacer)
    // Whitespace, then the start of a formula that is still held back.
    act(() => pacer.push('\n'))
    act(() => pacer.push('\\(E = m'))
    expect(screen.getByRole('status')).toBeInTheDocument()
    act(() => pacer.push('c^2\\) Hello'))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText(/Hello/)).toBeInTheDocument()
  })

  it('says so when the wait is long (a server waking up)', () => {
    vi.useFakeTimers()
    show(new StreamPacer({ instant: true }))
    act(() => void vi.advanceTimersByTime(SLOW_MS + 10))
    expect(screen.getByText('Still thinking…')).toBeInTheDocument()
    act(() => void vi.advanceTimersByTime(STALLED_MS))
    expect(screen.getByText('Still working. The server may be waking up.')).toBeInTheDocument()
  })
})

describe("maths in the student's own message", () => {
  const user = (content: string) =>
    render(
      <MemoryRouter>
        <ToastProvider>
          <ChatMessage message={{ id: 'u1', role: 'user', content, created_at: '' }} />
        </ToastProvider>
      </MemoryRouter>,
    )

  it('draws a formula with KaTeX', async () => {
    const { container } = user('Is $x^2 + 1$ right?')
    // Shown as its source until KaTeX has loaded.
    expect(container.querySelector('code')).toHaveTextContent('x^2 + 1')
    await vi.waitFor(() => expect(container.querySelector('.katex')).not.toBeNull(), { timeout: 5000 })
    expect(container).toHaveTextContent(/^Is .* right\?$/)
  })

  it('never treats what was typed as HTML, and leaves prices alone', () => {
    const { container } = user('<img src=x onerror=alert(1)> costs $5 and $10')
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('code')).toBeNull()
    expect(container).toHaveTextContent('<img src=x onerror=alert(1)> costs $5 and $10')
  })
})
