// @vitest-environment jsdom
/**
 * "Add to note" is wired into the real chat message, not just its own
 * standalone component — this confirms it actually shows up where a
 * student would see it, and stays off the transient streaming bubble
 * (which has no subspaceId and no finished content to add anywhere).
 */

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import type { ChatMessage as Message } from '../../api/types'

const getPassage = vi.hoisted(() => vi.fn())
vi.mock('../../api/documents', () => ({ getPassage }))
vi.mock('../../api/notes', () => ({
  createNote: vi.fn(),
  updateNote: vi.fn(),
  listNotes: vi.fn().mockResolvedValue([]),
}))

import { ChatMessage } from './ChatMessage'

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    role: 'assistant',
    content: 'Self-attention lets tokens weigh each other.',
    citations: null,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

afterEach(() => cleanup())
beforeEach(() => vi.clearAllMocks())

describe('Add to note, wired into a real chat message', () => {
  it('shows on a finished assistant answer that has a subspace to add to', () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <ChatMessage message={message()} subspaceId="s1" />
        </ToastProvider>
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: 'Add to note' })).toBeInTheDocument()
  })

  it('does not show on the transient streaming bubble (no subspaceId passed)', () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <ChatMessage message={message({ id: 'pending', content: '…' })} />
        </ToastProvider>
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: 'Add to note' })).not.toBeInTheDocument()
  })

  it('does not show on a user message', () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <ChatMessage message={message({ role: 'user', content: 'What is self-attention?' })} subspaceId="s1" />
        </ToastProvider>
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: 'Add to note' })).not.toBeInTheDocument()
  })
})

describe('citations are actually clickable, not just styled to look like it', () => {
  // Regression: both the footer citation cards and the inline `[[n]]`
  // marker were plain, unlinked `<span>`/`<div>` elements — a student
  // could see exactly which document backed a claim but had no way to
  // actually get there, even though the identical "click a citation, land
  // on the right document in Docs" capability already existed and worked
  // in the note editor.
  const citedMessage = message({
    content: 'Self-attention lets tokens weigh each other [[1]].',
    citations: [
      {
        marker: 1,
        document_id: 'doc-9',
        document_name: 'Attention Is All You Need.pdf',
        locator: 'p. 3',
        snippet: 'Scaled dot-product attention...',
      },
    ],
  })

  it('the footer citation card opens the passage, with the cited text highlighted', async () => {
    getPassage.mockResolvedValue({
      document_id: 'doc-9',
      name: 'Attention Is All You Need',
      chunks: [
        { index: 4, locator: 'p. 3', content: 'Before the cited text.', cited: false },
        { index: 5, locator: 'p. 3', content: 'The cited text itself.', cited: true },
      ],
    })
    render(
      <MemoryRouter>
        <ToastProvider>
          <ChatMessage message={citedMessage} subspaceId="s1" base="/s/space-1/sub-1" />
        </ToastProvider>
      </MemoryRouter>,
    )
    const user = userEvent.setup()
    // Closed until asked for.
    expect(screen.queryByRole('button', { name: /Attention Is All You Need/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Sources · 1/ }))
    await user.click(screen.getByRole('button', { name: /Attention Is All You Need/ }))
    const cited = await screen.findByText('The cited text itself.')
    expect(cited).toHaveAttribute('data-cited')
    expect(screen.getByText('Before the cited text.')).not.toHaveAttribute('data-cited')
    expect(getPassage).toHaveBeenCalledWith('doc-9', expect.any(String), expect.any(String))
    // And the file itself is one step further.
    expect(screen.getByRole('link', { name: /Open the file/ })).toHaveAttribute('href', '/s/space-1/sub-1/docs?d=doc-9')
  })

  it('the inline [[1]] marker opens the same passage', async () => {
    getPassage.mockResolvedValue({ document_id: 'doc-9', name: 'x', chunks: [{ index: 1, locator: 'p. 3', content: 'Cited.', cited: true }] })
    render(
      <MemoryRouter>
        <ToastProvider>
          <ChatMessage message={citedMessage} subspaceId="s1" base="/s/space-1/sub-1" />
        </ToastProvider>
      </MemoryRouter>,
    )
    await userEvent.setup().click(screen.getByRole('button', { name: '1' }))
    expect(await screen.findByText('Cited.')).toBeInTheDocument()
  })

  it('degrades to a plain, non-broken badge when base is not yet known (the streaming bubble)', async () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <ChatMessage message={citedMessage} />
        </ToastProvider>
      </MemoryRouter>,
    )
    // Still listed once opened, just not something to click through to a file we cannot name.
    await userEvent.setup().click(screen.getByRole('button', { name: /Sources · 1/ }))
    expect(screen.getByText('Attention Is All You Need.pdf')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Attention Is All You Need/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Attention Is All You Need/ })).not.toBeInTheDocument()
  })
})

describe('reply typography and streaming', () => {
  const wrap = (node: React.ReactNode) => (
    <MemoryRouter>
      <ToastProvider>{node}</ToastProvider>
    </MemoryRouter>
  )

  it('renders replies in the chat-reply prose scope, animated only while streaming', () => {
    const { container, rerender } = render(
      wrap(<ChatMessage message={message({ content: '## Heading\n\nBody text.' })} subspaceId="s1" />),
    )
    expect(container.querySelector('.chat-reply')).not.toBeNull()
    expect(container.querySelector('.chat-reply.is-streaming')).toBeNull()
    expect(container.querySelector('h2')).toHaveTextContent('Heading')

    rerender(wrap(<ChatMessage message={message({ id: 'pending', content: 'Body' })} streaming />))
    expect(container.querySelector('.chat-reply.is-streaming')).not.toBeNull()
  })

  it('shows the typing indicator until the first token', () => {
    render(wrap(<ChatMessage message={message({ id: 'pending', content: '\u2026' })} streaming />))
    expect(screen.getByRole('status', { name: 'Thinking' })).toBeInTheDocument()
  })

  it('wraps tables so they scroll instead of squashing', () => {
    const { container } = render(
      wrap(<ChatMessage message={message({ content: '| a | b |\n| - | - |\n| 1 | 2 |' })} subspaceId="s1" />),
    )
    expect(container.querySelector('.chat-table > table')).not.toBeNull()
  })

  it('renders LaTeX delimiters without leaking backslashes', async () => {
    const { container } = render(
      wrap(<ChatMessage message={message({ content: 'Energy is \\(E = mc^2\\) here.' })} subspaceId="s1" />),
    )
    // Placeholder first (raw source), KaTeX once lazily loaded.
    expect(container.textContent).not.toContain('\\(')
    await vi.waitFor(() => expect(container.querySelector('.katex')).not.toBeNull())
  })
})
