// @vitest-environment jsdom
/**
 * The notes list, at its edges:
 *  - a filter that matches nothing said `Nothing matches “”.` with no search typed;
 *  - a subject filter left on a subject whose last note was deleted hid the rest;
 *  - a double-click on "New note" made two notes;
 *  - on a phone, deleting the note you were reading opened a different note.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import type { Note, Space, Subspace } from '../../api/types'
import { mockPhone } from '../quizzes/phoneTestUtils'

const SUB_A: Subspace = { id: 'sub-a', subject_id: 'sp-a', name: 'Attention', last_activity_at: null, counts: {} }
const SUB_B: Subspace = { id: 'sub-b', subject_id: 'sp-b', name: 'Cells', last_activity_at: null, counts: {} }
const SPACE_A: Space = { id: 'sp-a', name: 'CS', tone: 'brand', pinned: false, subspaces: [SUB_A] }
const SPACE_B: Space = { id: 'sp-b', name: 'Biology', tone: 'sky', pinned: false, subspaces: [SUB_B] }

vi.mock('../../lib/useTopicScope', () => ({
  useTopicScope: () => ({ space: SPACE_A, subspace: SUB_A, base: '/cs/attention', isGlobal: false }),
}))
vi.mock('../spaces/SpacesProvider', () => ({ useSpaces: () => ({ spaces: [SPACE_A, SPACE_B] }) }))
// The editor is not what these tests are about.
vi.mock('./NoteEditor', () => ({
  NoteEditor: ({ note, onDelete }: { note: Note; onDelete: () => void }) => (
    <div data-testid="editor">
      <span>Editing {note.title}</span>
      <button onClick={onDelete}>Delete open note</button>
    </div>
  ),
}))

const note = (id: string, title: string, o: Partial<Note> = {}): Note => ({
  id,
  title,
  body_md: '',
  origin: 'user',
  source_ids: null,
  updated_at: new Date().toISOString(),
  touched_by_user: true,
  touched_by_agent: false,
  subspace_id: SUB_A.id,
  subspace_name: SUB_A.name,
  subject_name: SPACE_A.name,
  ...o,
})

const listAllNotes = vi.fn()
const createNote = vi.fn()
const deleteNote = vi.fn()
vi.mock('../../api/notes', () => ({
  listAllNotes: (...a: unknown[]) => listAllNotes(...a),
  createNote: (...a: unknown[]) => createNote(...a),
  deleteNote: (...a: unknown[]) => deleteNote(...a),
  generateNote: vi.fn(),
  updateNote: vi.fn(),
  noteAiInline: vi.fn(),
}))

import { NotesView } from './NotesView'

const renderView = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <NotesView />
      </ToastProvider>
    </MemoryRouter>,
  )

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('the notes list', () => {
  it('names an empty filter as an empty view, not as a search for nothing', async () => {
    const user = userEvent.setup()
    const ai = { touched_by_user: false, touched_by_agent: true, origin: 'agent' as const }
    listAllNotes.mockResolvedValue([note('n1', 'Softmax', ai), note('n2', 'Attention', ai)])
    renderView()

    await user.click(await screen.findByRole('button', { name: 'Mine 0' }))
    expect(screen.getByText('No notes in this view.')).toBeInTheDocument()
    expect(screen.queryByText(/Nothing matches/)).not.toBeInTheDocument()
  })

  it('drops the subject filter when the last note of that subject is deleted', async () => {
    const user = userEvent.setup()
    const bio = { subspace_id: SUB_B.id, subspace_name: SUB_B.name, subject_name: SPACE_B.name }
    listAllNotes.mockResolvedValue([note('n1', 'Softmax'), note('n2', 'Mitosis', bio)])
    deleteNote.mockResolvedValue(undefined)
    renderView()

    await screen.findByRole('button', { name: /Mitosis/ })
    await user.click(screen.getByRole('button', { name: /Filter by subject/ }))
    await user.click(await screen.findByRole('option', { name: 'Biology' }))
    expect(screen.queryByRole('button', { name: /^Softmax/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Mitosis/ }))
    await user.click(await screen.findByRole('button', { name: 'Delete open note' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.getByRole('button', { name: /^Softmax/ })).toBeInTheDocument())
    expect(screen.queryByText(/No notes in this view|Nothing matches/)).not.toBeInTheDocument()
  })

  it('creates one note when New note is double-clicked', async () => {
    const user = userEvent.setup()
    listAllNotes.mockResolvedValue([note('n1', 'Softmax')])
    let finish: (n: Note) => void = () => {}
    createNote
      .mockReturnValueOnce(new Promise<Note>((resolve) => (finish = resolve)))
      .mockResolvedValue(note('n10', 'Second note'))
    renderView()

    await screen.findByRole('button', { name: /^Softmax/ })
    await user.dblClick(screen.getAllByRole('button', { name: /New note/ })[0])
    expect(createNote).toHaveBeenCalledTimes(1)

    // And the guard lets go: the next one can be made.
    finish(note('n9', 'Untitled note'))
    await screen.findByText('Editing Untitled note')
    await user.click(screen.getAllByRole('button', { name: /New note/ })[0])
    expect(createNote).toHaveBeenCalledTimes(2)
  })
})

describe('deleting the open note on a phone', () => {
  it('goes back to the list instead of opening another note', async () => {
    const restore = mockPhone()
    try {
      const user = userEvent.setup()
      listAllNotes.mockResolvedValue([note('n1', 'Softmax'), note('n2', 'Attention')])
      deleteNote.mockResolvedValue(undefined)
      renderView()

      await user.click(await screen.findByText('Attention'))
      expect(await screen.findByText('Editing Attention')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Delete open note' }))
      await user.click(await screen.findByRole('button', { name: 'Delete' }))

      await waitFor(() => expect(deleteNote).toHaveBeenCalledWith('n2'))
      await waitFor(() => expect(screen.queryByTestId('editor')).not.toBeInTheDocument())
      expect(screen.getByText('Softmax')).toBeInTheDocument()
    } finally {
      restore()
    }
  })
})
