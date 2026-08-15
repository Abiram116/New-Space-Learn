// @vitest-environment jsdom

/**
 * Real markdown persistence for "Toggle section" — the actual shipped bug,
 * confirmed by mounting a real editor, building a toggle, and reading back
 * what got saved: `@tiptap/extension-details` has no markdown support for
 * the library this app uses (see the module docstring in
 * `detailsMarkdown.ts`), so a toggle's markdown came out as the literal
 * four-character string `"[details]"` — `tiptap-markdown`'s own fallback for
 * any node it has no spec for. Reloading that string reproduced a paragraph
 * containing the literal text "[details]": the toggle, its summary, and
 * everything written inside it, gone. `Details.configure({ persist: true })`
 * only ever controlled in-memory open/closed state; it never touched what
 * got saved.
 *
 * Driven against a real Tiptap `Editor` with the real extension list, same
 * house style as `aiPlaceholder.test.ts` and `noteEditorCommands.test.ts` —
 * this is a pure ProseMirror/markdown-it question, not a component one.
 */

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { Markdown } from 'tiptap-markdown'
import { describe, expect, it } from 'vitest'
import { DetailsWithMarkdown } from './detailsMarkdown'

function makeEditor(content: string) {
  return new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit,
      DetailsWithMarkdown.configure({ persist: true }),
      DetailsSummary,
      DetailsContent,
      Markdown.configure({ html: false }),
    ],
    content,
  })
}

function getMarkdown(editor: Editor): string {
  // @ts-expect-error — added by the Markdown extension's storage
  return editor.storage.markdown.getMarkdown()
}

function forceOpen(editor: Editor, open: boolean) {
  editor.chain().command(({ tr, state }) => {
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'details') tr.setNodeAttribute(pos, 'open', open)
    })
    return true
  }).run()
}

/** `focus('end')` lands after the whole details block, not inside its
 *  content — this finds the real position just inside detailsContent so a
 *  test can insert text where a student actually types after summarising. */
function focusInsideDetailsContent(editor: Editor) {
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'detailsContent') {
      editor.commands.setTextSelection(pos + node.nodeSize - 1)
      return false
    }
    return true
  })
}

describe('a closed toggle survives save and reload', () => {
  it('never serializes to the "[details]" placeholder', () => {
    const editor = makeEditor('<p></p>')
    editor.chain().focus().setDetails().run()
    editor.commands.insertContent('My Summary')

    const md = getMarkdown(editor)

    expect(md).not.toContain('[details]')
    expect(md).toContain(':::details')
    expect(md).toContain('My Summary')
    editor.destroy()
  })

  it('reconstructs a real toggle, not a paragraph of literal text, on reload', () => {
    const editor = makeEditor('<p></p>')
    editor.chain().focus().setDetails().run()
    editor.commands.insertContent('My Summary')
    const md = getMarkdown(editor)
    editor.destroy()

    const reloaded = makeEditor(md)
    const html = reloaded.getHTML()

    expect(html).toContain('<details')
    expect(html).toContain('<summary>My Summary</summary>')
    expect(html).not.toContain('[details]')
    reloaded.destroy()
  })
})

describe('open/closed state persists — not just structure', () => {
  it('a toggle left open stays open after reload', () => {
    const editor = makeEditor('<p></p>')
    editor.chain().focus().setDetails().run()
    editor.commands.insertContent('Summary')
    forceOpen(editor, true)
    const md = getMarkdown(editor)
    editor.destroy()

    expect(md).toMatch(/^:::details open\b/m)

    const reloaded = makeEditor(md)
    expect(reloaded.getHTML()).toContain('<details open')
    reloaded.destroy()
  })

  it('a toggle left closed stays closed after reload', () => {
    const editor = makeEditor('<p></p>')
    editor.chain().focus().setDetails().run()
    editor.commands.insertContent('Summary')
    // Default state — setDetails() does not open it.
    const md = getMarkdown(editor)
    editor.destroy()

    expect(md).toMatch(/^:::details Summary/m)

    const reloaded = makeEditor(md)
    expect(reloaded.getHTML()).not.toContain('<details open')
    reloaded.destroy()
  })
})

describe('the content inside a toggle remains real, editable content', () => {
  it('nested paragraphs survive the round trip and stay separate blocks', () => {
    const editor = makeEditor('<p></p>')
    editor.chain().focus().setDetails().run()
    editor.commands.insertContent('Summary')
    focusInsideDetailsContent(editor)
    editor.commands.insertContent('\n\nFirst paragraph.\n\nSecond paragraph.')
    const md = getMarkdown(editor)
    editor.destroy()

    const reloaded = makeEditor(md)
    const html = reloaded.getHTML()
    expect(html).toContain('First paragraph.')
    expect(html).toContain('Second paragraph.')
    // Two distinct <p> tags inside detailsContent, not one merged block.
    const contentMatch = html.match(/data-type="detailsContent">([\s\S]*?)<\/div>/)
    expect(contentMatch).not.toBeNull()
    expect((contentMatch![1].match(/<p>/g) ?? []).length).toBeGreaterThanOrEqual(2)
    reloaded.destroy()
  })

  it('reloaded content is still editable — typing inside it works normally', () => {
    const editor = makeEditor('<p></p>')
    editor.chain().focus().setDetails().run()
    editor.commands.insertContent('Summary')
    const md = getMarkdown(editor)
    editor.destroy()

    const reloaded = makeEditor(md)
    focusInsideDetailsContent(reloaded)
    reloaded.commands.insertContent('typed after reload')
    const contentMatch = reloaded.getHTML().match(/data-type="detailsContent">([\s\S]*?)<\/div>/)
    expect(contentMatch?.[1]).toContain('typed after reload')
    reloaded.destroy()
  })
})

describe('a toggle nested inside another toggle', () => {
  it('round-trips both, each closing on its own fence', () => {
    const editor = makeEditor('<p></p>')
    editor.chain().focus().setDetails().run()
    editor.commands.insertContent('Outer')
    editor.commands.focus('end')
    editor.chain().focus().setDetails().run()
    editor.commands.insertContent('Inner')
    const md = getMarkdown(editor)
    editor.destroy()

    const reloaded = makeEditor(md)
    const html = reloaded.getHTML()
    expect((html.match(/<details/g) ?? []).length).toBe(2)
    expect(html).toContain('Outer')
    expect(html).toContain('Inner')
    reloaded.destroy()
  })
})

describe('a stray ":::details" with no closing fence', () => {
  it('is left as plain text rather than swallowing the rest of the note', () => {
    // A student typing the literal characters in prose, not through the
    // menu — should not eat every following line hunting for a `:::` that
    // was never coming.
    const editor = makeEditor('<p></p>')
    editor.commands.insertContent(':::details this is just something I typed\n\nA real paragraph after it.')
    const html = editor.getHTML()
    expect(html).not.toContain('<details')
    expect(html).toContain('A real paragraph after it.')
    editor.destroy()
  })
})
