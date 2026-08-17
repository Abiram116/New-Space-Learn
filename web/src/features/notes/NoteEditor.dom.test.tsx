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

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import { noteAiInline } from '../../api/notes'
import type { Note } from '../../api/types'

const navigateSpy = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateSpy }
})

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
    touched_by_user: true,
    touched_by_agent: false,
    ...overrides,
  }
}

function renderEditor(overrides: Partial<Note> = {}) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <NoteEditor
          note={note(overrides)}
          subspaceId="s1"
          base="/s/subj1/s1"
          onPatch={vi.fn()}
          onDelete={vi.fn()}
          onBack={vi.fn()}
        />
      </ToastProvider>
    </MemoryRouter>,
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

describe('clicking a link inside the note', () => {
  // Regression: Link.configure({ openOnClick: false }) only stops Tiptap's
  // own click handler from calling window.open() — it does not call
  // preventDefault(), so the underlying <a href> still did a real, full-page
  // browser navigation out of the SPA. Reported as "the website is loading
  // and glitching" when clicking a citation link a note had inserted.
  it('routes a same-origin link through the app router instead of reloading the page', async () => {
    const user = userEvent.setup()
    renderEditor({ body_md: 'See [the source](/s/subj1/s1/docs?d=doc1) for details.' })

    const link = await screen.findByRole('link', { name: 'the source' })
    await user.click(link)

    expect(navigateSpy).toHaveBeenCalledWith('/s/subj1/s1/docs?d=doc1')
  })

  it('opens an external link in a new tab instead of navigating the note away', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const user = userEvent.setup()
    renderEditor({ body_md: 'See [the paper](https://example.com/paper.pdf) for details.' })

    const link = await screen.findByRole('link', { name: 'the paper' })
    await user.click(link)

    expect(openSpy).toHaveBeenCalledWith(
      'https://example.com/paper.pdf',
      '_blank',
      'noopener,noreferrer',
    )
    expect(navigateSpy).not.toHaveBeenCalled()
    openSpy.mockRestore()
  })
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

describe('the table size picker', () => {
  // Regression: "Table" used to insert a fixed 3×3 immediately, with no way
  // to ask for a different size short of manually adding/removing rows and
  // columns afterward.
  it('inserts a table sized to whatever rows/columns were entered, not a fixed 3×3', async () => {
    const user = userEvent.setup()
    renderEditor()
    const surface = document.querySelector<HTMLElement>('.notes-doc[contenteditable="true"]')!

    await user.click(surface)
    await user.type(surface, '/table')
    await waitFor(() => expect(screen.getByText('Table')).toBeInTheDocument())
    await user.type(surface, '{Enter}')

    // fireEvent.change, not user.clear()+type(): number inputs under jsdom
    // don't reliably clear via userEvent, which made this test flaky in a
    // way that had nothing to do with the picker itself.
    const rows = await screen.findByLabelText('Rows')
    fireEvent.change(rows, { target: { value: '5' } })
    const cols = screen.getByLabelText('Columns')
    fireEvent.change(cols, { target: { value: '2' } })

    await user.click(screen.getByRole('button', { name: 'Insert table' }))

    await waitFor(() => {
      const table = document.querySelector('.notes-doc table')
      expect(table).not.toBeNull()
      expect(table!.querySelectorAll('tr').length).toBe(5)
      expect(table!.querySelectorAll('tr')[0].querySelectorAll('th, td').length).toBe(2)
    })
  })

  it('closes without inserting anything on Escape', async () => {
    const user = userEvent.setup()
    renderEditor()
    const surface = document.querySelector<HTMLElement>('.notes-doc[contenteditable="true"]')!

    await user.click(surface)
    await user.type(surface, '/table')
    await waitFor(() => expect(screen.getByText('Table')).toBeInTheDocument())
    await user.type(surface, '{Enter}')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Insert table' })).toBeInTheDocument())

    await user.keyboard('{Escape}')

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Insert table' })).not.toBeInTheDocument(),
    )
    expect(document.querySelector('.notes-doc table')).toBeNull()
  })
})

describe('a toggle section, as actually rendered while editing', () => {
  // Regression: the extension's default toggle button sets only an
  // aria-label — no visible glyph — so a real user saw an empty, seemingly
  // dead control. `detailsMarkdown.test.ts` already proves the markdown
  // round-trip is correct; this proves the thing a student actually clicks
  // is visible and gives feedback, using the real mounted NodeView DOM
  // (`addNodeView()`), not the schema-only shape `getHTML()` produces.
  it('renders a visible chevron in the toggle button, not an empty control', async () => {
    const user = userEvent.setup()
    renderEditor()
    const surface = document.querySelector<HTMLElement>('.notes-doc[contenteditable="true"]')!

    await user.click(surface)
    await user.type(surface, '/toggle')
    await waitFor(() => expect(screen.getByText('Toggle section')).toBeInTheDocument())
    await user.type(surface, '{Enter}')

    await waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>('.notes-toggle > button')
      expect(button).not.toBeNull()
      expect(button!.querySelector('svg')).not.toBeNull()
    })
  })

  it('clicking the button hides the content and rotates the chevron; clicking again reverses it', async () => {
    const user = userEvent.setup()
    renderEditor()
    const surface = document.querySelector<HTMLElement>('.notes-doc[contenteditable="true"]')!

    await user.click(surface)
    await user.type(surface, '/toggle')
    await waitFor(() => expect(screen.getByText('Toggle section')).toBeInTheDocument())
    await user.type(surface, '{Enter}')

    const button = await waitFor(() => {
      const el = document.querySelector<HTMLButtonElement>('.notes-toggle > button')
      expect(el).not.toBeNull()
      return el!
    })
    const content = document.querySelector<HTMLElement>('.notes-toggle [data-type="detailsContent"]')!
    const svg = () => button.querySelector<SVGElement>('svg')!

    // setDetails() starts closed; the button starts un-rotated.
    expect(content.hasAttribute('hidden')).toBe(true)
    expect(svg().style.transform).toBe('rotate(0deg)')

    await user.click(button)
    expect(content.hasAttribute('hidden')).toBe(false)
    expect(svg().style.transform).toBe('rotate(90deg)')
    expect(button.closest('.notes-toggle')!.className).toContain('is-open')

    await user.click(button)
    expect(content.hasAttribute('hidden')).toBe(true)
    expect(svg().style.transform).toBe('rotate(0deg)')
  })
})

describe('the code block language picker', () => {
  // Regression: it used to be `sticky top-0` on a div wrapping the entire
  // editor surface — every block in the note, not just the code block — so
  // it detached from the block and rode the top of the whole scroll
  // container for as long as the caret sat inside any code block, no matter
  // where that block actually was in a long note.
  it('is not sticky-positioned to the top of the whole editor', async () => {
    const user = userEvent.setup()
    renderEditor()
    const surface = document.querySelector<HTMLElement>('.notes-doc[contenteditable="true"]')!

    await user.click(surface)
    await user.type(surface, '/code')
    await waitFor(() => expect(screen.getByText('Code block')).toBeInTheDocument())
    await user.type(surface, '{Enter}')

    const bar = await waitFor(() => {
      const el = screen.getByText('Language').closest('div')
      expect(el).not.toBeNull()
      return el!
    })
    expect(bar.className).not.toContain('sticky')
    expect(bar.className).toContain('absolute')
  })

  it('changing the language updates the actual code block, not just the control', async () => {
    const user = userEvent.setup()
    renderEditor()
    const surface = document.querySelector<HTMLElement>('.notes-doc[contenteditable="true"]')!

    await user.click(surface)
    await user.type(surface, '/code')
    await waitFor(() => expect(screen.getByText('Code block')).toBeInTheDocument())
    await user.type(surface, '{Enter}')

    await user.click(await screen.findByRole('button', { name: 'Code block language' }))
    await user.click(screen.getByRole('option', { name: 'python' }))

    await waitFor(() => {
      const code = document.querySelector('.notes-doc pre code')
      expect(code).not.toBeNull()
      expect(code!.className).toContain('language-python')
    })
  })
})

describe('warns before leaving with unsaved work', () => {
  // Regression: there was no `beforeunload` guard anywhere in the app — a
  // closed tab, hard refresh, or followed link inside the 800ms autosave
  // debounce silently dropped whatever was just typed, with zero warning.
  // Switching to a DIFFERENT note in-app was already safe (the pending
  // `setTimeout` isn't tied to this component and still fires — see
  // `saveBody`'s own comment) — this is specifically about actually
  // leaving the page.
  it('prevents unload while a save is pending, and stops once it settles', async () => {
    const user = userEvent.setup()
    renderEditor()
    const surface = document.querySelector<HTMLElement>('.notes-doc[contenteditable="true"]')!

    await user.click(surface)
    await user.type(surface, 'x')

    // `status` flips to 'saving' synchronously with the keystroke, before
    // the 800ms debounce timer is even set — still inside that window,
    // nothing has reached the server yet, so this is exactly the moment a
    // warning is owed.
    const duringSave = new Event('beforeunload', { cancelable: true })
    expect(window.dispatchEvent(duringSave)).toBe(false) // false = preventDefault() was called

    // The guard lifts the instant `status` leaves 'saving' — that's
    // 'saved', not the later 'idle' settle — so this only has to outlast
    // the real 800ms debounce plus the (mocked, near-instant) save itself.
    // Polls by re-dispatching on each attempt rather than sleeping a fixed
    // amount.
    await waitFor(
      () => {
        const afterSave = new Event('beforeunload', { cancelable: true })
        expect(window.dispatchEvent(afterSave)).toBe(true) // true = never prevented
      },
      { timeout: 3000 },
    )
  }, 8000)

  it('does not warn on a note with nothing typed yet', () => {
    renderEditor()
    const event = new Event('beforeunload', { cancelable: true })
    expect(window.dispatchEvent(event)).toBe(true)
  })
})

describe('LaTeX math renders, without corrupting on repeated saves', () => {
  // A never-saved note (fresh from `generateNote`, backend output only) has
  // its backslashes exactly as the model wrote them — needs the one-time
  // protection before markdown-it's parser eats `\[`/`\)`.
  it('renders a formula from a pristine, never-saved AI note', async () => {
    renderEditor({ touched_by_user: false, origin: 'agent', body_md: String.raw`\[ x \]` })
    await waitFor(() => expect(document.querySelector('.katex')).not.toBeNull())
  })

  // Regression: once a note has been saved at least once, `body_md` is
  // whatever `prosemirror-markdown`'s own serializer wrote — already
  // correctly double-escaped. Re-running our own protection on top of that
  // used to add a stray backslash every load; this note simulates exactly
  // that already-serialized shape and must still render as ONE clean
  // formula, not accumulate.
  it('does not double-escape a note that has already been saved once', async () => {
    // The exact shape `prosemirror-markdown`'s own `esc()` produces for a
    // literal `\[ x \]`: each of `\`, `[`, `]` is independently escaped, so
    // the backslash before each bracket triples rather than doubles.
    // Verified against the real function, not hand-derived — see the
    // reasoning above the `content:` line in NoteEditor.tsx.
    renderEditor({ touched_by_user: true, body_md: String.raw`\\\[ x \\\]` })
    await waitFor(() => {
      const formulas = document.querySelectorAll('.katex')
      expect(formulas.length).toBe(1)
    })
  })
})
