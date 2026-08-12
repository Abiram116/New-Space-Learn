// @vitest-environment jsdom

/**
 * "Thinking…" must never survive to be saved.
 *
 * The shipped bug this guards: the original inline-AI flow only removed the
 * placeholder on the SUCCESS path. Any failure — a dropped connection, a rate
 * limit, the model erroring — left the literal text "Thinking…" sitting in
 * the student's note, autosaved along with everything else. Same house style
 * as `aiInsert.test.ts`: drive a real Tiptap `Editor` with the real extension
 * list, never a stub of the editor's behaviour.
 */

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'
import { AI_PLACEHOLDER, clearAiPlaceholder } from './aiPlaceholder'

function makeEditor(content: string) {
  return new Editor({ element: document.createElement('div'), extensions: [StarterKit], content })
}

describe('the failure path — the actual shipped bug', () => {
  it('removes the placeholder when the request fails, not just when it succeeds', () => {
    const editor = makeEditor('')
    editor.chain().insertContentAt(0, AI_PLACEHOLDER).run()
    expect(editor.getText()).toContain('Thinking')

    // The exact call the component's `catch` block makes.
    const removed = clearAiPlaceholder(editor, 1)

    expect(removed).toBe(true)
    expect(editor.getText()).not.toContain('Thinking')
    editor.destroy()
  })
})

describe('the success path', () => {
  it('removes the placeholder so the real answer can be inserted in its place', () => {
    const editor = makeEditor('')
    editor.chain().insertContentAt(0, AI_PLACEHOLDER).run()

    expect(clearAiPlaceholder(editor, 1)).toBe(true)
    editor.chain().insertContentAt(1, 'the real answer').run()

    expect(editor.getText().trim()).toBe('the real answer')
    editor.destroy()
  })
})

describe('a student who kept typing while the request was in flight', () => {
  it('does not delete text when the range no longer holds the placeholder', () => {
    const editor = makeEditor('')
    editor.chain().insertContentAt(0, AI_PLACEHOLDER).run()
    // The student deleted the placeholder themselves and wrote their own
    // words in that spot before the (still in-flight) request returned.
    editor.chain().deleteRange({ from: 1, to: 1 + AI_PLACEHOLDER.length }).run()
    editor.chain().insertContentAt(1, 'their own words').run()

    const removed = clearAiPlaceholder(editor, 1)

    // Must not have blindly deleted the first N characters of what is now a
    // completely different sentence.
    expect(removed).toBe(false)
    expect(editor.getText().trim()).toBe('their own words')
    editor.destroy()
  })

  it('does not throw when the document is now shorter than the placeholder range', () => {
    const editor = makeEditor('')
    editor.chain().insertContentAt(0, AI_PLACEHOLDER).run()
    editor.chain().deleteRange({ from: 1, to: editor.state.doc.content.size }).run()

    expect(() => clearAiPlaceholder(editor, 1)).not.toThrow()
    expect(clearAiPlaceholder(editor, 1)).toBe(false)
    editor.destroy()
  })
})
