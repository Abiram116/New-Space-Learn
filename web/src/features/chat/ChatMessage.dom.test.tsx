// @vitest-environment jsdom
/**
 * "Add to note" is wired into the real chat message, not just its own
 * standalone component — this confirms it actually shows up where a
 * student would see it, and stays off the transient streaming bubble
 * (which has no subspaceId and no finished content to add anywhere).
 */

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import type { ChatMessage as Message } from '../../api/types'

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

  it('the footer citation card links into Docs with the document preselected', () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <ChatMessage message={citedMessage} subspaceId="s1" base="/s/space-1/sub-1" />
        </ToastProvider>
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: /Attention Is All You Need/ })
    expect(link).toHaveAttribute('href', '/s/space-1/sub-1/docs?d=doc-9')
  })

  it('the inline [[1]] marker links to the same document', () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <ChatMessage message={citedMessage} subspaceId="s1" base="/s/space-1/sub-1" />
        </ToastProvider>
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: '1' })
    expect(link).toHaveAttribute('href', '/s/space-1/sub-1/docs?d=doc-9')
  })

  it('degrades to a plain, non-broken badge when base is not yet known (the streaming bubble)', () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <ChatMessage message={citedMessage} />
        </ToastProvider>
      </MemoryRouter>,
    )
    // Still visible, just not a link to `undefined/docs`.
    expect(screen.getByText('Attention Is All You Need.pdf')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Attention Is All You Need/ })).not.toBeInTheDocument()
  })
})
