// @vitest-environment jsdom
/**
 * The note is open while "Add to note" adds to it from chat. The editor used
 * to keep its own older copy and save it straight back over the addition.
 * Also: who-wrote-it is shown for every note, in the header.
 */

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import type { Note } from '../../api/types'
import { announceNoteChange } from './noteSync'

const emptyRect: DOMRect = {
  x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0,
  toJSON: () => ({}),
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(Range.prototype as any).getClientRects = () => [emptyRect]
Range.prototype.getBoundingClientRect = () => emptyRect
if (!document.elementFromPoint) document.elementFromPoint = () => null

const updateNote = vi.fn()
vi.mock('../../api/notes', () => ({
  updateNote: (...a: unknown[]) => updateNote(...a),
  noteAiInline: vi.fn(),
}))

import { NoteEditor } from './NoteEditor'

const note = (o: Partial<Note> = {}): Note => ({
  id: 'n1',
  title: 'Attention',
  body_md: 'What I wrote.',
  origin: 'user',
  source_ids: null,
  updated_at: new Date().toISOString(),
  touched_by_user: true,
  touched_by_agent: false,
  ...o,
})

const onPatch = vi.fn()
const renderEditor = (o: Partial<Note> = {}) =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <NoteEditor note={note(o)} subspaceId="s1" base="/s/subj1/s1" onPatch={onPatch} onDelete={vi.fn()} onBack={vi.fn()} />
      </ToastProvider>
    </MemoryRouter>,
  )
const surface = () => document.querySelector<HTMLElement>('.notes-doc[contenteditable="true"]')!

beforeEach(() => {
  updateNote.mockImplementation((_id: string, patch: Partial<Note>) =>
    Promise.resolve({ ...note(), ...patch, updated_at: new Date().toISOString() }),
  )
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('a reply added from chat while the note is open', () => {
  it('shows the new body, with its formula, and does not save the old one back', async () => {
    renderEditor()
    await waitFor(() => expect(surface()).toHaveTextContent('What I wrote.'))

    act(() =>
      announceNoteChange(
        note({
          body_md: 'What I wrote.\n\n---\n\nEnergy is \\\\(E = mc^2\\\\)',
          touched_by_agent: true,
        }),
        '---\n\nEnergy is \\\\(E = mc^2\\\\)',
      ),
    )

    await waitFor(() => expect(surface()).toHaveTextContent('Energy is'))
    expect(surface().textContent).toContain('What I wrote.')
    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ touched_by_agent: true }))
    // Nothing was typed, so nothing is saved over the server's copy.
    await new Promise((r) => setTimeout(r, 900))
    expect(updateNote).not.toHaveBeenCalled()
  })

  it('ignores changes to other notes', async () => {
    renderEditor()
    await waitFor(() => expect(surface()).toHaveTextContent('What I wrote.'))
    act(() => announceNoteChange(note({ id: 'other', body_md: 'Elsewhere' }), 'Elsewhere'))
    await new Promise((r) => setTimeout(r, 50))
    expect(surface()).not.toHaveTextContent('Elsewhere')
  })
})

describe('who wrote it', () => {
  it('names the author in the header for your own notes as well as AI ones', () => {
    renderEditor()
    expect(screen.getByRole('img', { name: 'Made by you' })).toHaveTextContent('You')
    cleanup()
    renderEditor({ origin: 'agent', touched_by_user: true, touched_by_agent: true })
    expect(screen.getByRole('img', { name: 'Made by AI · Edited by you' })).toHaveTextContent('You + AI')
  })
})
