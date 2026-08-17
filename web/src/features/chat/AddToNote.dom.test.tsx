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
    touched_by_user: true,
    touched_by_agent: false,
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
        origin: 'agent',
      }),
    )
  })

  it('marks the new note as AI-created, not user-created', async () => {
    // Regression: this button only ever appears on an assistant's own
    // message — the whole body is a verbatim AI answer, none of it typed —
    // but the note was being created with no `origin`, which defaults to
    // 'user' and showed "Created by you" on a note the student never wrote
    // a word of.
    const user = userEvent.setup()
    renderButton()
    await user.click(screen.getByRole('button', { name: 'Add to note' }))
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(createNote).toHaveBeenCalledWith(
        'subspace-1',
        expect.objectContaining({ origin: 'agent' }),
      ),
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
        ai_touched: true,
      }),
    )
  })

  it('marks the note as AI-touched, not attributed only to the student who clicked Add', async () => {
    // Regression: appending a verbatim AI answer went through the same
    // PATCH ordinary typing does, with no `ai_touched` flag — the save only
    // ever marked `touched_by_user`, so an AI-written paragraph pasted in
    // this way credited the student alone.
    listNotes.mockResolvedValue([note({ id: 'n1', title: 'Attention' })])
    const user = userEvent.setup()
    renderButton('New fact from chat.')
    await user.click(screen.getByRole('button', { name: 'Add to note' }))

    const existingRadio = await screen.findByRole('radio', { name: 'Existing note' })
    await waitFor(() => expect(existingRadio).not.toBeDisabled())
    await user.click(existingRadio)
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(updateNote).toHaveBeenCalledWith(
        'n1',
        expect.objectContaining({ ai_touched: true }),
      ),
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

  it('inserts after the line matching the optional marker instead of the end', async () => {
    listNotes.mockResolvedValue([
      note({ id: 'n1', title: 'Attention', body_md: '## Encoder\nEncoder notes.\n\n## Decoder\nDecoder notes.' }),
    ])
    const user = userEvent.setup()
    renderButton('New fact about encoders.')
    await user.click(screen.getByRole('button', { name: 'Add to note' }))

    const existingRadio = await screen.findByRole('radio', { name: 'Existing note' })
    await waitFor(() => expect(existingRadio).not.toBeDisabled())
    await user.click(existingRadio)
    await user.type(await screen.findByLabelText('Insert after (optional)'), 'Encoder')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(updateNote).toHaveBeenCalledWith('n1', {
        body_md: '## Encoder\n\nNew fact about encoders.\n\nEncoder notes.\n\n## Decoder\nDecoder notes.',
        ai_touched: true,
      }),
    )
  })

  it('falls back to appending at the end when the marker has no match', async () => {
    listNotes.mockResolvedValue([note({ id: 'n1', title: 'Attention', body_md: 'Other stuff.' })])
    const user = userEvent.setup()
    renderButton('New fact from chat.')
    await user.click(screen.getByRole('button', { name: 'Add to note' }))

    const existingRadio = await screen.findByRole('radio', { name: 'Existing note' })
    await waitFor(() => expect(existingRadio).not.toBeDisabled())
    await user.click(existingRadio)
    await user.type(await screen.findByLabelText('Insert after (optional)'), 'nothing like this exists')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(updateNote).toHaveBeenCalledWith('n1', {
        body_md: 'Other stuff.\n\nNew fact from chat.',
        ai_touched: true,
      }),
    )
    expect(await screen.findByText(/Couldn't find "nothing like this exists"/)).toBeInTheDocument()
  })
})
