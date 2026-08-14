// @vitest-environment jsdom
/**
 * Mounts the real `NoteEditor` — the first test in the suite to do that for
 * any editor screen — and drives it the way a student actually would: type
 * into the note.
 *
 * N15 named three shipped bugs pure-logic coverage cannot see: nothing
 * asserted a component mounts, that `/` opens the slash menu, or that the AI
 * placeholder disappears on failure. `aiPlaceholder.test.ts` covers the
 * third by testing the extracted logic directly with a real `Editor`; the
 * first two need the actual React tree on screen, because "does `/` open
 * the menu" is a question about `onSelectionUpdate` wiring into rendered
 * markup, not about the pure command list (`slashMenu.test.ts` already
 * covers that part).
 *
 * `updateNote` is mocked — this test is about the editor opening and reading
 * user input, not about autosave, and a real network call would make it a
 * flaky integration test for a question it isn't asking.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import { noteAiInline } from '../../api/notes'
import type { Note } from '../../api/types'

/**
 * jsdom does no real layout, so `Range`/`Element.getClientRects()` are
 * unimplemented — and ProseMirror calls them on every selection change to
 * decide whether to scroll the caret into view. Without this the editor
 * throws on the second keystroke of any typing test. This is the standard,
 * narrowly-scoped workaround for testing ProseMirror-based editors under
 * jsdom (kept local to this file, not in the global test setup, so files
 * that never mount a rich editor pay nothing for it).
 */
const emptyRect: DOMRect = {
  x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0,
  toJSON: () => ({}),
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(Range.prototype as any).getClientRects = () => [emptyRect]
Range.prototype.getBoundingClientRect = () => emptyRect
// Same gap, different entry point: ProseMirror resolves a mousedown's
// document position via `elementFromPoint`, which jsdom also never
// implemented (no layout means no real point-to-element hit testing).
if (!document.elementFromPoint) {
  document.elementFromPoint = () => null
}

vi.mock('../../api/notes', () => ({
  updateNote: vi.fn().mockResolvedValue({ body_md: '', updated_at: new Date().toISOString() }),
  noteAiInline: vi.fn(),
}))

// `NoteEditor` renders Tiptap's `EditorContent` synchronously on mount in
// this version of `@tiptap/react`, so no async wait is needed to reach the
// contentEditable node — confirmed below by the render test itself.
import { NoteEditor } from './NoteEditor'

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    title: 'Virtual memory',
    body_md: '',
    origin: 'user',
    source_ids: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function renderEditor(overrides: Partial<Note> = {}) {
  return render(
    <ToastProvider>
      <NoteEditor
        note={note(overrides)}
        subspaceId="s1"
        base="/s/subj1/s1"
        onPatch={vi.fn()}
        onDelete={vi.fn()}
        onBack={vi.fn()}
      />
    </ToastProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

// This project does not run vitest with `globals: true` (see
// `testSetup.ts`), so `@testing-library/react`'s auto-cleanup heuristic never
// registers — a mounted editor from one test was still in `document.body`
// when the next one ran, and that leaked slash-menu DOM is exactly what
// produced a stray "Ask AI" match. Every component test file must do this
// itself.
afterEach(() => {
  cleanup()
})

describe('mounting', () => {
  it('renders the title and a writable editor surface with no crash', () => {
    renderEditor({ title: 'Virtual memory' })

    expect(screen.getByDisplayValue('Virtual memory')).toBeInTheDocument()
    const surface = document.querySelector('.notes-doc[contenteditable="true"]')
    expect(surface).not.toBeNull()
  })
})

describe('the slash menu', () => {
  it('opens when the student types "/" at the start of a line', async () => {
    const user = userEvent.setup()
    renderEditor()

    const surface = document.querySelector<HTMLElement>('.notes-doc[contenteditable="true"]')
    expect(surface).not.toBeNull()

    await user.click(surface!)
    await user.type(surface!, '/')

    await waitFor(() => {
      expect(screen.getByText('Ask AI')).toBeInTheDocument()
    })
  })

  it('closes again once the "/" is deleted', async () => {
    const user = userEvent.setup()
    renderEditor()
    const surface = document.querySelector<HTMLElement>('.notes-doc[contenteditable="true"]')!

    await user.click(surface)
    await user.type(surface, '/')
    await waitFor(() => expect(screen.getByText('Ask AI')).toBeInTheDocument())

    await user.type(surface, '{backspace}')
    await waitFor(() => expect(screen.queryByText('Ask AI')).not.toBeInTheDocument())
  })

  it('does not open on ordinary text with no leading slash', async () => {
    const user = userEvent.setup()
    renderEditor()
    const surface = document.querySelector<HTMLElement>('.notes-doc[contenteditable="true"]')!

    await user.click(surface)
    await user.type(surface, 'the working set exceeds physical memory')

    expect(screen.queryByText('Ask AI')).not.toBeInTheDocument()
  })

  it('sends the note\'s own text to the AI, not just the instruction', async () => {
    // Whole-note commands ("Summarise" with nothing selected) fall back to
    // "summarise the note so far" — but the endpoint only had indexed
    // material and chat history to work from, never the note itself. An
    // AI-generated note's words are in neither, so the command silently had
    // nothing to act on. Pin that the note's current markdown travels with
    // the request.
    vi.mocked(noteAiInline).mockResolvedValue({ content_md: 'ok', citations: [] })
    const user = userEvent.setup()
    renderEditor()
    const surface = document.querySelector<HTMLElement>('.notes-doc[contenteditable="true"]')!

    await user.click(surface)
    await user.type(surface, 'Photosynthesis converts light energy in plants.')
    await user.type(surface, '{Enter}/summarise')
    await waitFor(() => expect(screen.getByText('Summarise')).toBeInTheDocument())
    await user.type(surface, '{Enter}')

    await waitFor(() => expect(noteAiInline).toHaveBeenCalled())
    const [, , noteText] = vi.mocked(noteAiInline).mock.calls[0]
    expect(noteText).toContain('Photosynthesis converts light energy in plants.')
  })

  it('closes once a space follows the command name', async () => {
    // "/ai explain attention" is a free-text prompt, handled by the Enter
    // binding — not a command search. If the menu stayed open here it would
    // sit on screen showing stale matches for a query that no longer applies.
    const user = userEvent.setup()
    renderEditor()
    const surface = document.querySelector<HTMLElement>('.notes-doc[contenteditable="true"]')!

    await user.click(surface)
    await user.type(surface, '/ai')
    await waitFor(() => expect(screen.getByText('Ask AI')).toBeInTheDocument())

    await user.type(surface, ' ')
    await waitFor(() => expect(screen.queryByText('Ask AI')).not.toBeInTheDocument())
  })
})
