// @vitest-environment jsdom
/**
 * The 2026-08 UX audit found the Notes tab had no AI-generation entry point
 * at any width — unlike Quizzes/Flashcards, which both have a tab-level
 * "Generate" button, the only way to get an AI-written note was chat's
 * `/notes` command or the (`lg:`-only) dock button. This mounts the real
 * `NotesView` and proves the new entry points — the header's compact "AI
 * note" button and the empty state's fuller "Write with AI" button — both
 * open the real `NoteBriefDialog` and drive the real `generateNote` call,
 * the same dialog and API the chat agent already uses.
 *
 * Also covers a bug spotted in review of the fix above: `NotesView` never
 * rendered `SubspaceHeader` at all, so — unlike Chat/Docs/Quizzes/Cards — it
 * had no tab strip and no way back to the other four tabs except the
 * sidebar. Fixed alongside the AI entry point since both are "this screen
 * doesn't match its siblings" issues in the same file.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import type { Note, Space, Subspace } from '../../api/types'

const SUBSPACE: Subspace = {
  id: 'subspace-1',
  subject_id: 'space-1',
  name: 'Attention',
  last_activity_at: null,
  counts: {},
}
const SPACE: Space = { id: 'space-1', name: 'CS', tone: 'brand', pinned: false, subspaces: [] }

vi.mock('../../lib/nav', () => ({
  useActiveSubspace: () => ({
    space: SPACE,
    subspace: SUBSPACE,
    base: '/spaces/space-1/subspace-1',
  }),
}))

const generatedNote: Note = {
  id: 'note-generated',
  title: 'Self-attention',
  body_md: '# Self-attention\n\nWritten by the agent.',
  origin: 'agent',
  source_ids: null,
  updated_at: new Date().toISOString(),
}

const generateNote = vi.fn().mockResolvedValue(generatedNote)
const listNotes = vi.fn().mockResolvedValue([])
const createNote = vi.fn()
const deleteNote = vi.fn()

vi.mock('../../api/notes', () => ({
  listNotes: (...args: unknown[]) => listNotes(...args),
  createNote: (...args: unknown[]) => createNote(...args),
  deleteNote: (...args: unknown[]) => deleteNote(...args),
  generateNote: (...args: unknown[]) => generateNote(...args),
}))

import { NotesView } from './NotesView'

function renderNotesView() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/spaces/space-1/subspace-1/notes']}>
        <NotesView />
      </MemoryRouter>
    </ToastProvider>,
  )
}

describe('NotesView AI entry point', () => {
  afterEach(() => {
    cleanup()
    generateNote.mockClear()
  })

  it('the header AI-note button opens NoteBriefDialog and generates a note', async () => {
    const user = userEvent.setup()
    renderNotesView()

    await waitFor(() => expect(screen.getByText('No notes yet')).toBeInTheDocument())

    // The header button — compact label, present regardless of note count.
    await user.click(screen.getByRole('button', { name: 'Write a note with AI' }))
    expect(screen.getByRole('heading', { name: 'Write a note' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /write it/i }))

    await waitFor(() => expect(generateNote).toHaveBeenCalledTimes(1))
    expect(generateNote.mock.calls[0][0]).toBe('subspace-1')
    // Dialog closes and the new note becomes the selected one.
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Write a note' })).not.toBeInTheDocument(),
    )
  })

  it('the empty-state "Write with AI" button reaches the same dialog', async () => {
    const user = userEvent.setup()
    renderNotesView()

    await waitFor(() => expect(screen.getByText('No notes yet')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /write with ai/i }))
    expect(screen.getByRole('heading', { name: 'Write a note' })).toBeInTheDocument()
  })

  it('renders the same tab strip as every other subspace screen', async () => {
    renderNotesView()

    await waitFor(() => expect(screen.getByText('No notes yet')).toBeInTheDocument())

    for (const label of ['Chat', 'Docs', 'Notes', 'Quizzes', 'Cards']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }
  })
})
