// @vitest-environment jsdom
/**
 * "Add to note" — the chat-to-notes bridge. Mounts the real button + modal
 * and drives the actual contract with the notes API, not just internal
 * component state: which endpoint gets called, with what body, for each of
 * the two paths (new note vs. appending to an existing one).
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import type { Note } from '../../api/types'

const createNote = vi.fn()
const updateNote = vi.fn()
const listNotes = vi.fn()

vi.mock('../../api/notes', () => ({
  createNote: (...args: unknown[]) => createNote(...args),
  updateNote: (...args: unknown[]) => updateNote(...args),
  listNotes: (...args: unknown[]) => listNotes(...args),
}))

import { AddToNoteButton } from './AddToNote'

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    title: 'Existing note',
    body_md: 'Already written content.',
    origin: 'user',
    source_ids: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function renderButton(content = 'The answer, in full.') {
  return render(
    <ToastProvider>
      <AddToNoteButton subspaceId="subspace-1" content={content} />
    </ToastProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  listNotes.mockResolvedValue([])
  createNote.mockResolvedValue(note())
  updateNote.mockResolvedValue(note())
})

afterEach(() => cleanup())

describe('adding a new note', () => {
  it('creates a note with the message content as its body', async () => {
    const user = userEvent.setup()
    renderButton('Self-attention lets tokens weigh each other.')

    await user.click(screen.getByRole('button', { name: 'Add to note' }))
    await screen.findByText('Add to note', { selector: 'h2' })
    // "New note" is the default selection — no extra click needed.
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(createNote).toHaveBeenCalledWith('subspace-1', {
        title: 'Untitled note',
        body_md: 'Self-attention lets tokens weigh each other.',
      }),
    )
  })

  it('tells you an empty topic will get its first note this way', async () => {
    const user = userEvent.setup()
    renderButton()
    await user.click(screen.getByRole('button', { name: 'Add to note' }))

    expect(await screen.findByText(/this'll start one/)).toBeInTheDocument()
  })
})

describe('adding to an existing note', () => {
  it('appends the content to the end of the chosen note, separated from what was already there', async () => {
    listNotes.mockResolvedValue([
      note({ id: 'n1', title: 'Attention', body_md: 'What I already knew.' }),
      note({ id: 'n2', title: 'Transformers', body_md: 'Other stuff.' }),
    ])
    const user = userEvent.setup()
    renderButton('New fact from chat.')
    await user.click(screen.getByRole('button', { name: 'Add to note' }))

    const existingRadio = await screen.findByRole('radio', { name: 'Existing note' })
    await waitFor(() => expect(existingRadio).not.toBeDisabled())
    await user.click(existingRadio)

    const select = screen.getByLabelText('Choose a note')
    await user.selectOptions(select, 'n2')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(updateNote).toHaveBeenCalledWith('n2', {
        body_md: 'Other stuff.\n\nNew fact from chat.',
      }),
    )
  })

  it('disables the existing-note option when the topic has no notes yet', async () => {
    listNotes.mockResolvedValue([])
    const user = userEvent.setup()
    renderButton()
    await user.click(screen.getByRole('button', { name: 'Add to note' }))

    const existingRadio = await screen.findByRole('radio', { name: 'Existing note' })
    await waitFor(() => expect(existingRadio).toBeDisabled())
  })
})
