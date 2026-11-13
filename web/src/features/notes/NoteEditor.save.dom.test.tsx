// @vitest-environment jsdom
/**
 * Saving, where it used to go wrong quietly:
 *  - clearing the title to retype it sent an empty title, which the server
 *    refuses, so the note showed "Couldn't save" for doing nothing wrong;
 *  - a failed save had no way to try again short of typing something else;
 *  - on a phone, tapping the text sent the caret to the end of the note.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import type { Note } from '../../api/types'
import { mockPhone } from '../quizzes/phoneTestUtils'

// jsdom has no layout; ProseMirror asks for these on every selection change.
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
  title: 'Virtual memory',
  body_md: '',
  origin: 'user',
  source_ids: null,
  updated_at: new Date().toISOString(),
  touched_by_user: true,
  touched_by_agent: false,
  ...o,
})

const renderEditor = (o: Partial<Note> = {}) =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <NoteEditor note={note(o)} subspaceId="s1" base="/s/subj1/s1" onPatch={vi.fn()} onDelete={vi.fn()} onBack={vi.fn()} />
      </ToastProvider>
    </MemoryRouter>,
  )

const saved = (patch: Record<string, unknown>) => ({ ...note(), ...patch, updated_at: new Date().toISOString() })
const surface = () => document.querySelector<HTMLElement>('.notes-doc[contenteditable="true"]')!

beforeEach(() => {
  updateNote.mockImplementation((_id: string, patch: Record<string, unknown>) => Promise.resolve(saved(patch)))
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('the note title', () => {
  it('saves an emptied title as "Untitled note", never as an empty string', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.clear(screen.getByLabelText('Note title'))

    await waitFor(() => expect(updateNote).toHaveBeenCalled(), { timeout: 3000 })
    expect(updateNote).toHaveBeenCalledWith('n1', { title: 'Untitled note' })
    expect(updateNote).not.toHaveBeenCalledWith('n1', { title: '' })
  })
})

describe('a save that fails', () => {
  it('says so with a Retry that sends the same text again', async () => {
    const user = userEvent.setup()
    updateNote.mockRejectedValueOnce(new Error('offline'))
    renderEditor()
    await user.click(surface())
    await user.type(surface(), 'paging')

    const retry = await screen.findByRole('button', { name: /Couldn’t save\. Retry/ }, { timeout: 3000 })
    expect(updateNote).toHaveBeenCalledTimes(1)

    await user.click(retry)
    await waitFor(() => expect(updateNote).toHaveBeenCalledTimes(2), { timeout: 3000 })
    expect(updateNote.mock.calls[1][1]).toEqual(updateNote.mock.calls[0][1])
    await waitFor(() => expect(screen.queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument())
  })

  it('warns before the tab closes on text the server never got', async () => {
    const user = userEvent.setup()
    updateNote.mockRejectedValueOnce(new Error('offline'))
    renderEditor()
    await user.click(surface())
    await user.type(surface(), 'paging')
    await screen.findByRole('button', { name: /Retry/ }, { timeout: 3000 })

    const leaving = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(leaving)
    expect(leaving.defaultPrevented).toBe(true)
  })
})

describe('the note page on a phone', () => {
  let restore: () => void
  beforeEach(() => {
    restore = mockPhone()
  })
  afterEach(() => restore())

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorOf = (el: HTMLElement) => (el as any).editor as { state: { selection: { from: number }; doc: { content: { size: number } } }; commands: { setTextSelection: (n: number) => void } }

  it('leaves the caret where it is when the text is tapped', () => {
    renderEditor({ body_md: 'First paragraph.\n\nSecond paragraph.' })
    const editor = editorOf(surface())
    editor.commands.setTextSelection(3)

    fireEvent.click(surface().querySelector('p')!)
    expect(editor.state.selection.from).toBe(3)
  })

  it('still puts the caret at the end when the blank page under the note is tapped', () => {
    renderEditor({ body_md: 'First paragraph.\n\nSecond paragraph.' })
    const editor = editorOf(surface())
    editor.commands.setTextSelection(3)

    // The tappable page is the wrapper around the editor.
    fireEvent.click(surface().parentElement!.parentElement!)
    expect(editor.state.selection.from).toBeGreaterThan(3)
  })
})
