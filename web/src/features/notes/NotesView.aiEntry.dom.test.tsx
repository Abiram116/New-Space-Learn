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
 * had no breadcrumb, title, or actions row and no way back to the other four
 * tabs except the sidebar. Fixed alongside the AI entry point since both are
 * "this screen doesn't match its siblings" issues in the same file.
 *
 * The 2026-08 UX audit revisited this: Notes stopped being a per-topic
 * screen (it's an account-wide library now, see NotesView's own top-level
 * comment), so `SubspaceHeader`'s five-tab strip — "which of THIS topic's
 * screens am I on" — became actively misleading here and was deliberately
 * turned off (`tabs={false}`). The breadcrumb/title/actions row it still
 * renders is what this file actually needs to keep proving.
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
const SPACE: Space = { id: 'space-1', name: 'CS', tone: 'brand', pinned: false, subspaces: [SUBSPACE] }

vi.mock('../../lib/nav', () => ({
  useActiveSubspace: () => ({
    space: SPACE,
    subspace: SUBSPACE,
    base: '/spaces/space-1/subspace-1',
  }),
}))

// NotesView reads the sidebar's already-loaded space list to resolve each
// note's subject/tone — mocked the same way `useActiveSubspace` is, rather
// than mounting a real `SpacesProvider` and its own fetch for a test that
// isn't exercising that.
vi.mock('../spaces/SpacesProvider', () => ({
  useSpaces: () => ({ spaces: [SPACE] }),
}))

const generatedNote: Note = {
  id: 'note-generated',
  title: 'Self-attention',
  body_md: '# Self-attention\n\nWritten by the agent.',
  origin: 'agent',
  source_ids: null,
  updated_at: new Date().toISOString(),
  touched_by_user: false,
  touched_by_agent: true,
}

const generateNote = vi.fn().mockResolvedValue(generatedNote)
const listAllNotes = vi.fn().mockResolvedValue([])
const createNote = vi.fn()
const deleteNote = vi.fn()

vi.mock('../../api/notes', () => ({
  listAllNotes: (...args: unknown[]) => listAllNotes(...args),
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

  it('renders the title, but not a "Subject › Topic" breadcrumb — Notes is global now', async () => {
    // Regression: the breadcrumb claimed the same single-topic scope the
    // tab strip did (see the test below) — "CS › Attention" over a screen
    // listing every note across every topic read as "you're still only
    // looking at this one topic", which stopped being true.
    renderNotesView()

    await waitFor(() => expect(screen.getByText('No notes yet')).toBeInTheDocument())

    expect(screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument()
    expect(screen.queryByText('CS › Attention')).not.toBeInTheDocument()
  })

  it('does not render the per-topic tab strip — Notes is a global library now', async () => {
    // Regression: showing "which of THIS topic's five screens am I on" on a
    // screen that lists every note across every topic implied a scoping
    // that no longer exists.
    renderNotesView()

    await waitFor(() => expect(screen.getByText('No notes yet')).toBeInTheDocument())

    for (const label of ['Chat', 'Docs', 'Quizzes', 'Cards']) {
      expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument()
    }
  })
})
