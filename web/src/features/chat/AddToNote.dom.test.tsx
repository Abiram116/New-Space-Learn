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
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
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
    <MemoryRouter>
      <ToastProvider>
        <AddToNoteButton subspaceId="subspace-1" content={content} />
      </ToastProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
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
        body_md: 'Other stuff.\n\n---\n\nNew fact from chat.',
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
        body_md: 'Other stuff.\n\n---\n\nNew fact from chat.',
        ai_touched: true,
      }),
    )
    expect(await screen.findByText(/Couldn't find "nothing like this exists"/)).toBeInTheDocument()
  })
})

describe('the sidebar count after saving', () => {
  it('hands the fresh notes list to everything showing it', async () => {
    const { readCache, clearCache } = await import('../../lib/asyncCache')
    clearCache()
    const user = userEvent.setup()
    renderButton()
    await user.click(screen.getByRole('button', { name: 'Add to note' }))
    listNotes.mockResolvedValue([note({ id: 'fresh' })])
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(readCache<Note[]>('notes:subspace-1')?.data.map((n) => n.id)).toEqual(['fresh']),
    )
  })
})

describe('keeping the reply’s formatting', () => {
  const cites = [
    { marker: 1, document_id: 'd1', document_name: 'Attention.pdf', locator: 'p. 4 · Dot products', snippet: '' },
  ]

  it('turns [[n]] markers into page references with a Sources line', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ToastProvider>
          <AddToNoteButton subspaceId="subspace-1" content="Softmax gives weights [[1]]." citations={cites} />
        </ToastProvider>
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: 'Add to note' }))
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(createNote).toHaveBeenCalledWith('subspace-1', {
        title: 'Untitled note',
        body_md: 'Softmax gives weights (p. 4).\n\n*Sources: Attention.pdf (p. 4)*',
        origin: 'agent',
      }),
    )
  })

  it('drops markers it has no sources for, rather than leaving [[1]] in the note', async () => {
    const user = userEvent.setup()
    renderButton('Weights [[1]].')
    await user.click(screen.getByRole('button', { name: 'Add to note' }))
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(createNote).toHaveBeenCalledWith('subspace-1', expect.objectContaining({ body_md: 'Weights.' })),
    )
  })

  it('names a new note after the reply’s opening heading, and lets you change it', async () => {
    const user = userEvent.setup()
    renderButton('## Scaled attention\n\nBody.')
    await user.click(screen.getByRole('button', { name: 'Add to note' }))
    const title = await screen.findByLabelText('Title')
    expect(title).toHaveValue('Scaled attention')
    await user.clear(title)
    await user.type(title, 'Week 3')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(createNote).toHaveBeenCalledWith('subspace-1', expect.objectContaining({ title: 'Week 3' })),
    )
  })

  it('keeps the formulas of a reply appended to a saved note', async () => {
    listNotes.mockResolvedValue([note({ id: 'n1', body_md: 'Mine.' })])
    const user = userEvent.setup()
    renderButton('Energy: \\(E = mc^2\\)')
    await user.click(screen.getByRole('button', { name: 'Add to note' }))
    const existingRadio = await screen.findByRole('radio', { name: 'Existing note' })
    await waitFor(() => expect(existingRadio).not.toBeDisabled())
    await user.click(existingRadio)
    await user.click(screen.getByRole('button', { name: 'Add' }))
    // Protected for the parser: it reads back as exactly `\(E = mc^2\)`.
    await waitFor(() =>
      expect(updateNote).toHaveBeenCalledWith('n1', {
        body_md: 'Mine.\n\n---\n\nEnergy: \\\\\\(E \\= mc\\^2\\\\\\)',
        ai_touched: true,
      }),
    )
  })
})

describe('the flow', () => {
  it('adds once, however fast the button is clicked', async () => {
    let resolve: (n: Note) => void = () => undefined
    createNote.mockImplementation(() => new Promise<Note>((r) => (resolve = r)))
    const user = userEvent.setup()
    renderButton()
    await user.click(screen.getByRole('button', { name: 'Add to note' }))
    const add = screen.getByRole('button', { name: 'Add' })
    await user.dblClick(add)
    resolve(note({ id: 'created' }))
    await screen.findByRole('button', { name: 'Open note' })
    expect(createNote).toHaveBeenCalledTimes(1)
  })

  it('offers to open the note it just added to', async () => {
    createNote.mockResolvedValue(note({ id: 'new-1', title: 'Untitled note' }))
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/chat']}>
        <ToastProvider>
          <Routes>
            <Route path="/chat" element={<AddToNoteButton subspaceId="subspace-1" content="x" />} />
            <Route path="/notes" element={<Where />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: 'Add to note' }))
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(await screen.findByRole('button', { name: 'Open note' }))
    expect(await screen.findByTestId('where')).toHaveTextContent('/notes?n=new-1')
  })

  it('remembers the note you added to last time', async () => {
    listNotes.mockResolvedValue([note({ id: 'n1', title: 'One' }), note({ id: 'n2', title: 'Two' })])
    window.localStorage.setItem('addToNote:last:subspace-1', 'n2')
    const user = userEvent.setup()
    renderButton()
    await user.click(screen.getByRole('button', { name: 'Add to note' }))
    expect(await screen.findByLabelText('Choose a note')).toHaveValue('n2')
  })

  it('tells an open copy of the note about the addition', async () => {
    const { onNoteChange } = await import('../notes/noteSync')
    const heard = vi.fn()
    const off = onNoteChange(heard)
    listNotes.mockResolvedValue([note({ id: 'n1', body_md: 'Mine.' })])
    updateNote.mockImplementation((_id: string, patch: Partial<Note>) => Promise.resolve(note({ id: 'n1', ...patch })))
    const user = userEvent.setup()
    renderButton('Added.')
    await user.click(screen.getByRole('button', { name: 'Add to note' }))
    const existingRadio = await screen.findByRole('radio', { name: 'Existing note' })
    await waitFor(() => expect(existingRadio).not.toBeDisabled())
    await user.click(existingRadio)
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(heard).toHaveBeenCalledWith(
        expect.objectContaining({ noteId: 'n1', body_md: 'Mine.\n\n---\n\nAdded.', addition: '---\n\nAdded.' }),
      ),
    )
    off()
  })
})

function Where() {
  const loc = useLocation()
  return <div data-testid="where">{loc.pathname + loc.search}</div>
}
