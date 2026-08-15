// @vitest-environment jsdom
/**
 * The selection bar's AI actions — specifically `rewrite`, which had a real
 * reported bug: asked to rewrite a question, the model answered it instead
 * of returning a reworded question. "Rewrite this more clearly" alone is
 * genuinely ambiguous about whether the passage is content to transform or
 * a question addressed to the model — a question mark makes the second
 * reading just as plausible as the first.
 */

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { describe, expect, it } from 'vitest'
import { DetailsWithMarkdown } from './detailsMarkdown'
import { BLOCKS, SELECTION_ACTIONS } from './toolbar'

describe('rewrite preserves the passage\'s own form', () => {
  const rewrite = SELECTION_ACTIONS.find((a) => a.id === 'rewrite')!

  it('tells the model not to answer a question, only reword it', () => {
    const prompt = rewrite.prompt('What is self-attention?')
    const lower = prompt.toLowerCase()
    expect(lower).toContain('if it is a question, return a rewritten question, not an answer')
    expect(lower).toContain('do not answer')
  })

  it('still asks for a rewrite, not just a policy statement', () => {
    const prompt = rewrite.prompt('What is self-attention?')
    expect(prompt).toContain('What is self-attention?')
    expect(prompt.toLowerCase()).toContain('rewrite')
  })
})

describe('tucking a selection into a toggle', () => {
  // Selection-bar Block actions convert something you already wrote; the
  // `/` menu's own toggle command inserts a fresh, empty one — genuinely
  // different jobs, not the same command offered twice. This exercises the
  // real Tiptap command chain, the same house style as detailsMarkdown.test.ts.
  const toggle = BLOCKS.find((b) => b.key === 'toggle')!

  function makeEditor(content: string) {
    return new Editor({
      element: document.createElement('div'),
      extensions: [
        StarterKit,
        DetailsWithMarkdown.configure({ persist: true }),
        DetailsSummary,
        DetailsContent,
      ],
      content,
    })
  }

  it('moves the selected passage into the toggle body, not the summary', () => {
    const editor = makeEditor('<p>Scaled dot-product attention computes weighted sums.</p>')
    editor.commands.selectAll()

    toggle.run(editor)

    const html = editor.getHTML()
    expect(html).toContain('<details')
    const bodyMatch = html.match(/data-type="detailsContent">([\s\S]*?)<\/div>/)
    expect(bodyMatch?.[1]).toContain('Scaled dot-product attention computes weighted sums.')
    editor.destroy()
  })

  it('leaves the cursor in the now-empty summary, ready to type a label', () => {
    const editor = makeEditor('<p>Some passage to tuck away.</p>')
    editor.commands.selectAll()

    toggle.run(editor)
    editor.commands.insertContent('Attention mechanism')

    // Bolded, same as the `/` menu's own toggle command does for a freshly
    // typed summary — consistent affordance for "this is what you click".
    const html = editor.getHTML()
    expect(html).toContain('<summary><strong>Attention mechanism</strong></summary>')
    editor.destroy()
  })

  it('is marked active while the selection sits inside a toggle', () => {
    const editor = makeEditor('<p>Text</p>')
    editor.commands.selectAll()
    toggle.run(editor)

    expect(toggle.active(editor)).toBe(true)
    editor.destroy()
  })

  it('is not marked active on ordinary text with no toggle nearby', () => {
    // Regression: the button rendered with a permanent "active" fill even
    // before the toggle existed, because BLOCK_ICON had no entry for
    // 'toggle' — Cell fell through to rendering the empty `label`, and the
    // resulting blank swatch was mistaken for the active-state colour. The
    // icon gap is fixed separately; this pins that inactive really means
    // unstyled, not just "has an icon now."
    const editor = makeEditor('<p>Ordinary paragraph, nothing special.</p>')
    editor.commands.selectAll()

    expect(toggle.active(editor)).toBe(false)
    editor.destroy()
  })
})

describe('the selection bar does not duplicate the / menu\'s insertion-only commands', () => {
  // Code blocks and tables are things you start fresh, not things you turn
  // existing prose into — they stay `/`-menu only. Pinned so a future "just
  // add it everywhere for completeness" doesn't quietly reintroduce it.
  it('offers no code-block or table conversion', () => {
    const keys = BLOCKS.map((b) => b.key)
    expect(keys).not.toContain('codeBlock')
    expect(keys).not.toContain('table')
  })
})
