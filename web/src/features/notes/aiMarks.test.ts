// @vitest-environment jsdom
/**
 * The marks on AI text inside the editor, and the placeholder bug they
 * exposed: typing `/ai …` + Enter left "Thinking…" in the note for good.
 */

import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { aiPendingRange, setAiPending } from './aiMarks'
import { AI_PLACEHOLDER, clearAiPlaceholder, locateAiPlaceholder } from './aiPlaceholder'
import { noteExtensions } from './noteExtensions'

const editors: Editor[] = []
function open(content: string): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const e = new Editor({ element, extensions: noteExtensions(), content })
  editors.push(e)
  return e
}
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))

/** The paragraph whose text starts with `prefix`, as a node range. */
function nodeRange(e: Editor, prefix: string) {
  let range = { from: -1, to: -1 }
  e.state.doc.forEach((n, off) => {
    if (n.textContent.startsWith(prefix)) range = { from: off, to: off + n.nodeSize }
  })
  return range
}

describe('the AI placeholder', () => {
  it('is found where it really landed after replacing a whole paragraph', () => {
    const e = open('Hello\n\n/ai explain')
    const { from, to } = nodeRange(e, '/ai')
    e.chain().deleteRange({ from, to }).insertContentAt(from, AI_PLACEHOLDER).run()
    // The old check looked at `from` itself, missed, and left the text behind.
    expect(clearAiPlaceholder(e, from)).toBe(false)
    const at = locateAiPlaceholder(e, from)
    expect(at).not.toBeNull()
    expect(clearAiPlaceholder(e, at!)).toBe(true)
    expect(e.getText()).not.toContain(AI_PLACEHOLDER)
  })

  it('is drawn as the AI’s while pending, and follows edits made above it', () => {
    const e = open('Intro\n\nThinking…')
    const at = locateAiPlaceholder(e, nodeRange(e, 'Thinking').from) ?? -1
    expect(at).toBeGreaterThan(0)
    e.view.dispatch(setAiPending(e.state.tr, { from: at, to: at + AI_PLACEHOLDER.length }))
    expect(e.view.dom.querySelector('.note-ai-pending')?.textContent).toBe(AI_PLACEHOLDER)
    expect(e.view.dom.querySelector('.note-ai-badge')).toHaveAttribute('aria-label', 'AI is writing')

    e.view.dispatch(e.state.tr.insertText('More ', 1))
    const moved = aiPendingRange(e.state)!
    expect(e.state.doc.textBetween(moved.from, moved.to)).toBe(AI_PLACEHOLDER)

    e.view.dispatch(setAiPending(e.state.tr, null))
    expect(e.view.dom.querySelector('.note-ai-pending')).toBeNull()
  })
})

describe('the source line under an AI passage', () => {
  it('carries the AI mark; an ordinary paragraph starting "Source:" does not', () => {
    const e = open('An answer.\n\n*Source: [Notes.pdf · p. 2](/s/a/b/docs?d=1)*\n\nSource: my own words')
    const marked = [...e.view.dom.querySelectorAll('p.note-ai-source')].map((p) => p.textContent)
    expect(marked).toEqual(['Source: Notes.pdf · p. 2'])
  })
})
