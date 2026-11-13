// @vitest-environment jsdom
/**
 * "Add to note", end to end through the real editor: a chat reply with every
 * kind of formatting goes in as a new note and as an addition to a saved
 * note, and each must come out of the editor intact — and stay intact
 * through a save and reload. Built with `noteExtensions()`, the exact list
 * students get, because a reduced list is what hid the math bugs before.
 */

import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import type { Citation } from '../../api/types'
import {
  appendReply,
  chatReplyToMarkdown,
  citationsToReferences,
  sourcesLine,
  titleFromReply,
} from './chatToNote'
import { markdownForEditor } from './mathMarkdown'
import { findMatches } from './mathPreview'
import { noteExtensions } from './noteExtensions'

const FENCE = '```'
const REPLY = String.raw`## Scaled attention

The **softmax** of *scores* gives the weights [[1]]. See [the paper](https://arxiv.org/abs/1706.03762).

1. Compute $q_i \cdot k_j$ for each pair [[2]][[1]]
   - scale by \(\frac{1}{\sqrt{d_k}}\)
   - then softmax
2. Take the weighted sum

$$
\text{Attention}(Q,K,V) = \mathrm{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)V
$$

| Term | Meaning |
|---|---|
| $|x|$ | its norm |
| *K* | keys [[1]] |

${FENCE}python
def f(x):
    return x * 2  # [[1]] \n stays
${FENCE}

It costs $5 and $10. The product $2*3*4$ is 24.
`

const CITES: Citation[] = [
  { marker: 1, document_id: 'd1', document_name: 'Attention.pdf', locator: 'p. 4 · Scaled dot', snippet: '' },
  { marker: 2, document_id: 'd2', document_name: 'Lecture 3', locator: 'Softmax', snippet: '' },
]

const editors: Editor[] = []
function open(markdown: string): Editor {
  const e = new Editor({ element: document.createElement('div'), extensions: noteExtensions(), content: markdown })
  editors.push(e)
  return e
}
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))

const save = (e: Editor): string =>
  (e.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()
const formulas = (e: Editor) => findMatches(e.state.doc).map((m) => [m.latex, m.display])

const EXPECTED_MATH = [
  ['q_i \\cdot k_j', false],
  ['\\frac{1}{\\sqrt{d_k}}', false],
  ['\\text{Attention}(Q,K,V) = \\mathrm{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V', true],
  ['\\vert x\\vert', false],
  ['2*3*4', false],
]

/** Everything a chat answer can carry, checked on the editor's own document. */
function expectFormattingKept(e: Editor) {
  const html = e.getHTML()
  expect(html).toContain('<h2>Scaled attention</h2>')
  expect(html).toContain('<strong>softmax</strong>')
  expect(html).toContain('<em>scores</em>')
  expect(html).toContain('href="https://arxiv.org/abs/1706.03762"')
  // Nested list: a bulleted list inside the first numbered item.
  expect(html).toMatch(/<ol[^>]*><li><p>Compute[^<]*<\/p><ul[^>]*><li><p>scale by/)
  expect(html).toContain('<table')
  expect(html).toContain('<td><p>its norm</p></td>')
  expect(html).toContain('<code class="language-python">def f(x):\n    return x * 2  # [[1]] \\n stays</code>')
  expect(formulas(e)).toEqual(EXPECTED_MATH)
  // Citations read as references; no raw marker outside the code block.
  const text = e.getText()
  expect(text).toContain('gives the weights (p. 4).')
  expect(text).toContain('for each pair (Lecture 3; p. 4)')
  expect(text.replace(/def f[\s\S]*?stays/, '')).not.toMatch(/\[\[\d+\]\]/)
  expect(text).toContain('Sources: Attention.pdf (p. 4) · Lecture 3 (Softmax)')
  // Prices stay prices.
  expect(text).toContain('It costs $5 and $10.')
}

describe('a chat reply as a new note', () => {
  it('keeps headings, emphasis, nested lists, tables, code, links, math and sources', () => {
    const body = chatReplyToMarkdown(REPLY, CITES)
    expectFormattingKept(open(markdownForEditor(body, false)))
  })

  it('survives a save and a reload unchanged', () => {
    const first = open(markdownForEditor(chatReplyToMarkdown(REPLY, CITES), false))
    const saved = save(first)
    const reopened = open(markdownForEditor(saved, true))
    expectFormattingKept(reopened)
    expect(save(reopened)).toBe(saved)
  })
})

describe('a chat reply appended to a saved note', () => {
  it('keeps every formula — they used to lose their backslashes and show as (x^2)', () => {
    const saved = save(open('# My notes\n\nWhat I wrote myself.'))
    const { body } = appendReply({ body_md: saved, touched_by_user: true }, chatReplyToMarkdown(REPLY, CITES))
    const e = open(markdownForEditor(body, true))
    expect(e.getText()).toContain('What I wrote myself.')
    expectFormattingKept(e)
    // Set off from the student's own words by a divider.
    expect(e.getHTML()).toMatch(/What I wrote myself\.<\/p><hr><h2>Scaled attention/)
  })

  it('protects a never-edited AI note too, since the PATCH marks it edited', () => {
    const aiNote = String.raw`Euler: \(e^{i\pi} + 1 = 0\)`
    const { body } = appendReply({ body_md: aiNote, touched_by_user: false }, 'More: $a_1 + a_2$')
    expect(formulas(open(markdownForEditor(body, true)))).toEqual([
      ['e^{i\\pi} + 1 = 0', false],
      ['a_1 + a_2', false],
    ])
  })

  it('lands under a chosen heading without a divider cutting the section', () => {
    const { body, found } = appendReply(
      { body_md: '## Encoder\nEncoder notes.\n\n## Decoder\nDecoder notes.', touched_by_user: true },
      'New fact.',
      'encoder',
    )
    expect(found).toBe(true)
    expect(body).toBe('## Encoder\n\nNew fact.\n\nEncoder notes.\n\n## Decoder\nDecoder notes.')
  })
})

describe('citations', () => {
  it('drops markers when the answer came with no sources, never leaving [[n]]', () => {
    expect(citationsToReferences('Weights [[1]]. And [[2]][[3]] more.').text).toBe('Weights. And more.')
  })

  it('merges a run of markers and skips numbers outside the list', () => {
    const { text, used } = citationsToReferences('A [[1]][[9]][[1]] b', CITES)
    expect(text).toBe('A (p. 4) b')
    expect(used.map((c) => c.marker)).toEqual([1])
  })

  it('lists each document once, with its pages', () => {
    expect(sourcesLine([CITES[0], { ...CITES[0], marker: 3, locator: 'p. 9' }])).toBe(
      '*Sources: Attention.pdf (p. 4, p. 9)*',
    )
    expect(sourcesLine([])).toBe('')
  })
})

describe('titleFromReply', () => {
  it('uses an opening heading, and nothing else', () => {
    expect(titleFromReply('## **Scaled** attention\n\nBody')).toBe('Scaled attention')
    expect(titleFromReply('Attention is a mechanism that…')).toBe('')
  })
})
