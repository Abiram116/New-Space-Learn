// @vitest-environment jsdom
/**
 * "Add to note" is wired into the real chat message, not just its own
 * standalone component — this confirms it actually shows up where a
 * student would see it, and stays off the transient streaming bubble
 * (which has no subspaceId and no finished content to add anywhere).
 */

import { cleanup, render, screen } from '@testing-library/react'
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
      <ToastProvider>
        <ChatMessage message={message()} subspaceId="s1" />
      </ToastProvider>,
    )
    expect(screen.getByRole('button', { name: 'Add to note' })).toBeInTheDocument()
  })

  it('does not show on the transient streaming bubble (no subspaceId passed)', () => {
    render(
      <ToastProvider>
        <ChatMessage message={message({ id: 'pending', content: '…' })} />
      </ToastProvider>,
    )
    expect(screen.queryByRole('button', { name: 'Add to note' })).not.toBeInTheDocument()
  })

  it('does not show on a user message', () => {
    render(
      <ToastProvider>
        <ChatMessage message={message({ role: 'user', content: 'What is self-attention?' })} subspaceId="s1" />
      </ToastProvider>,
    )
    expect(screen.queryByRole('button', { name: 'Add to note' })).not.toBeInTheDocument()
  })
})
