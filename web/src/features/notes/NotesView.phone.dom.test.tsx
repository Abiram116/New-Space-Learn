// @vitest-environment jsdom
/** Notes on a phone: lands on the list (never auto-opens a note), search folds away. */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import type { Note, Space, Subspace } from '../../api/types'
import { mockPhone } from '../quizzes/phoneTestUtils'

const SUB: Subspace = { id: 'sub', subject_id: 'sp', name: 'Attention', last_activity_at: null, counts: {} }
const SPACE: Space = { id: 'sp', name: 'CS', tone: 'brand', pinned: false, subspaces: [SUB] }
vi.mock('../../lib/nav', () => ({
  useActiveSubspace: () => ({ space: SPACE, subspace: SUB, base: '/spaces/sp/sub' }),
}))
vi.mock('../spaces/SpacesProvider', () => ({ useSpaces: () => ({ spaces: [SPACE] }) }))

const note = (id: string, title: string, o: Partial<Note> = {}): Note => ({
  id,
  title,
  body_md: `# ${title}\n\nBody of ${title}.`,
  origin: 'user',
  source_ids: null,
  updated_at: new Date().toISOString(),
  touched_by_user: true,
  touched_by_agent: false,
  ...o,
})

const listAllNotes = vi.fn()
const createNote = vi.fn()
const deleteNote = vi.fn().mockResolvedValue(undefined)
vi.mock('../../api/notes', () => ({
  listAllNotes: (...a: unknown[]) => listAllNotes(...a),
  createNote: (...a: unknown[]) => createNote(...a),
  deleteNote: (...a: unknown[]) => deleteNote(...a),
  generateNote: vi.fn(),
  updateNote: vi.fn(),
  noteAiInline: vi.fn(),
}))

import { NotesView } from './NotesView'

let restore: () => void
beforeEach(() => {
  restore = mockPhone()
})
afterEach(() => {
  cleanup()
  restore()
  vi.clearAllMocks()
})

const renderView = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <NotesView />
      </ToastProvider>
    </MemoryRouter>,
  )

describe('phone notes list', () => {
  it('lands on the list — it does not auto-open the first note', async () => {
    listAllNotes.mockResolvedValue([note('n1', 'Self-attention'), note('n2', 'Softmax', { touched_by_agent: true })])
    renderView()
    await waitFor(() => expect(screen.getByText('Self-attention')).toBeInTheDocument())
    expect(screen.queryByLabelText('Note title')).not.toBeInTheDocument()
    expect(screen.getByText('Softmax')).toBeInTheDocument()
  })

  it('pins New note (with the AI option beside it) and creates one on tap', async () => {
    const user = userEvent.setup()
    listAllNotes.mockResolvedValue([note('n1', 'Self-attention')])
    createNote.mockResolvedValue(note('n9', 'Untitled note', { body_md: '' }))
    renderView()
    await waitFor(() => expect(screen.getByText('Self-attention')).toBeInTheDocument())
    const bar = document.querySelector('[data-sticky-action-bar]') as HTMLElement
    expect(within(bar).getByRole('button', { name: 'Write a note with AI' })).toBeInTheDocument()
    await user.click(within(bar).getByRole('button', { name: /New note/ }))
    await waitFor(() => expect(createNote).toHaveBeenCalled())
  })

  it('search is folded behind an icon and filters the list', async () => {
    const user = userEvent.setup()
    listAllNotes.mockResolvedValue([note('n1', 'Self-attention'), note('n2', 'Softmax')])
    renderView()
    await waitFor(() => expect(screen.getByText('Softmax')).toBeInTheDocument())
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Search notes' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search notes' }), 'soft')
    expect(screen.queryByText('Self-attention')).not.toBeInTheDocument()
    expect(screen.getByText('Softmax')).toBeInTheDocument()
  })

  it('delete is in the row ⋯ sheet and confirms first', async () => {
    const user = userEvent.setup()
    listAllNotes.mockResolvedValue([note('n1', 'Self-attention')])
    renderView()
    await waitFor(() => expect(screen.getByText('Self-attention')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'More actions for Self-attention' }))
    await user.click(await screen.findByRole('button', { name: 'Delete note' }))
    expect(deleteNote).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleteNote).toHaveBeenCalledWith('n1'))
  })
})
