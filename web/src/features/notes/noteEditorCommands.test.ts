// @vitest-environment jsdom

/**
 * Two real, reported bugs in the note editor's `/` commands, each driven
 * against a real Tiptap `Editor` with the real extension list — same house
 * style as `aiPlaceholder.test.ts` — rather than mounting the whole
 * component, since both are pure ProseMirror-state questions.
 */

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { describe, expect, it } from 'vitest'
import { landInFreshParagraph } from './landInFreshParagraph'
import { SLASH_COMMANDS } from './slashMenu'

function makeEditor(content: string) {
  return new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, Details, DetailsSummary, DetailsContent],
    content,
  })
}

describe('landInFreshParagraph', () => {
  it('leaves the cursor alone when it is already in an empty paragraph', () => {
    const editor = makeEditor('<p>Some text</p><p></p>')
    const endPos = editor.state.doc.content.size
    editor.chain().setTextSelection(endPos).run()
    const sizeBefore = editor.state.doc.content.size

    landInFreshParagraph(editor)

    expect(editor.state.doc.content.size).toBe(sizeBefore)
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(editor.state.selection.$from.parent.content.size).toBe(0)
    editor.destroy()
  })

  it('inserts a fresh empty paragraph when the cursor is inside a non-empty, mark-laden node', () => {
    // The actual shape a citation line leaves behind: *Source: [name](url)*
    // — a paragraph whose only content is italic, linked text. Reported bug:
    // typing `/` right after an AI answer with citations appended it to the
    // end of that link's text instead of opening the slash menu, because
    // `/` only triggers the menu as the FIRST character of a paragraph, and
    // this paragraph already had text in it.
    const editor = makeEditor(
      '<p>Some content.</p><p><em><a href="https://x.test/doc">Source: doc.pdf · offset 5</a></em></p>',
    )
    const endPos = editor.state.doc.content.size
    editor.chain().setTextSelection(endPos).run()
    expect(editor.state.selection.$from.parent.textContent.length).toBeGreaterThan(0)

    landInFreshParagraph(editor)

    const $end = editor.state.doc.resolve(editor.state.selection.to)
    expect($end.parent.type.name).toBe('paragraph')
    expect($end.parent.content.size).toBe(0)
    // Typing '/' here must now read as the first character of an empty
    // paragraph, not an append to the citation link's text.
    editor.chain().insertContentAt(editor.state.selection.to, '/').run()
    expect(editor.state.selection.$from.parent.textContent).toBe('/')
    editor.destroy()
  })
})

describe('the "toggle" command — the fixed replacement for the broken toggle-heading levels', () => {
  const toggle = SLASH_COMMANDS.find((c) => c.id === 'toggle')!

  it('bolds text subsequently typed into the summary, since a real heading node cannot go there', () => {
    // Regression: this used to be three commands ("Toggle heading 1/2/3")
    // that called setNode('heading', {level}) on the summary. detailsSummary
    // is declared content: "text*" by @tiptap/extension-details — a block
    // node like heading can never validly go there, so setNode silently
    // no-op'd on every level. Bold is the fix: a mark, not a node, so it's
    // actually valid content for a text-only node.
    const editor = makeEditor('<p></p>')
    toggle.run!(editor)

    editor.commands.insertContent('My Section')

    expect(editor.getHTML()).toContain('<strong>My Section</strong>')
    editor.destroy()
  })
})
