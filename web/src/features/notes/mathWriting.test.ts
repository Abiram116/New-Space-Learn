// @vitest-environment jsdom
/**
 * Writing math in a note: what the editor recognises as a formula, what
 * survives the markdown parser, pasting from chat, and the commands that
 * put the delimiters in for you. All against the real extension list.
 */

import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'
import { insertMath } from './mathCommands'
import { protectMath } from './mathMarkdown'
import { findMatches, katexHtmlToLatex } from './mathPreview'
import { splitMath, tokenizeMath } from './mathSyntax'
import { noteExtensions } from './noteExtensions'
import { availableCommands } from './slashMenu'

const editors: Editor[] = []
function open(content: string): Editor {
  const e = new Editor({ element: document.createElement('div'), extensions: noteExtensions(), content })
  editors.push(e)
  return e
}
afterEach(() => editors.splice(0).forEach((e) => e.destroy()))
const formulas = (e: Editor) => findMatches(e.state.doc).map((m) => [m.latex, m.display])
const save = (e: Editor): string =>
  (e.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown()

describe('tokenizeMath', () => {
  it('gives back the input exactly when its pieces are joined', () => {
    const src = 'A $x$ and `$y$` and \\[z\\] and $5 or $10.\n```\n$q$\n```'
    expect(tokenizeMath(src).map((t) => t.source).join('')).toBe(src)
  })

  it('reads code as code, never math', () => {
    expect(tokenizeMath('`$a$` $b$').map((t) => t.kind)).toEqual(['code', 'text', 'math'])
  })

  it('splitMath keeps the shape chat relies on', () => {
    expect(splitMath('x `$y$` \\(z\\)')).toEqual(['x `$y$` ', { latex: 'z', display: false }])
  })
})

describe('protectMath', () => {
  it('turns every math form into one canonical, parser-proof form', () => {
    const e = open(
      protectMath(
        'Inline $a_1 * b_2$, \\(x^2\\), display\n\n$$\n\\sum_{i=1}^n i\n$$\n\n\\begin{align}a &= b\\end{align}',
      ),
    )
    expect(formulas(e)).toEqual([
      ['a_1 * b_2', false],
      ['x^2', false],
      ['\\sum_{i=1}^n i', true],
      ['\\begin{align}a &= b\\end{align}', true],
    ])
  })

  it('leaves inline code alone — its backslashes used to be doubled', () => {
    const e = open(protectMath('Run `C:\\*.txt` now'))
    expect(e.getText()).toBe('Run C:\\*.txt now')
  })

  it('keeps a matrix whole, line breaks and all', () => {
    const e = open(protectMath('$$\n\\begin{pmatrix} a & b \\\\\n c & d \\end{pmatrix}\n$$'))
    expect(formulas(e)).toEqual([['\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', true]])
  })
})

describe('formulas the editor draws', () => {
  it('renders $…$ and $$…$$ typed straight into a note, not only \\( \\)', () => {
    const e = open('Area is $\\pi r^2$ and\n\n$$E = mc^2$$')
    expect(formulas(e)).toEqual([
      ['\\pi r^2', false],
      ['E = mc^2', true],
    ])
  })

  it('ignores prices and anything inside inline code', () => {
    const e = open('It costs $5 and $10, and `$HOME$` is a variable.')
    expect(formulas(e)).toEqual([])
  })

  it('keeps typed math exactly through save and reload', () => {
    const e = open('')
    e.commands.insertContent({ type: 'paragraph', content: [{ type: 'text', text: 'Water is $H_2O$ and \\(x^{2}\\)' }] })
    const saved = save(e)
    expect(formulas(open(saved))).toEqual([
      ['H_2O', false],
      ['x^{2}', false],
    ])
  })
})

describe('pasting math', () => {
  it('keeps the backslashes of LaTeX pasted as text', () => {
    const e = open('')
    const ext = e.view.someProp('transformPastedText', (f) => f('Formula \\(\\frac{a}{b}\\)', false, e.view))
    expect(ext).toBe('Formula \\\\\\(\\\\frac\\{a\\}\\{b\\}\\\\\\)')
  })

  it('turns a formula copied out of a chat bubble back into its LaTeX', () => {
    const html =
      '<p>So <span class="katex"><span class="katex-mathml"><math><semantics><mi>x</mi>' +
      '<annotation encoding="application/x-tex">x^2</annotation></semantics></math></span>' +
      '<span class="katex-html">x2</span></span> grows <button>1</button></p>' +
      '<span class="katex-display"><span class="katex"><annotation encoding="application/x-tex">\\int f</annotation></span></span>'
    const out = katexHtmlToLatex(html)
    expect(out).toContain('So \\(x^2\\) grows')
    expect(out).toContain('<p>\\[\\int f\\]</p>')
    expect(out).not.toContain('<button')
    expect(out).not.toContain('x2</span>')
  })
})

describe('insertMath', () => {
  it('puts inline delimiters in with the caret between them', () => {
    const e = open('Speed is')
    e.commands.setTextSelection(e.state.doc.content.size - 1)
    insertMath(e, false)
    expect(e.getText()).toBe('Speed is \\( \\)')
    e.view.dispatch(e.state.tr.insertText('v^2'))
    expect(e.getText()).toBe('Speed is \\( v^2\\)')
  })

  it('wraps a selection, turning plain x^2 into a formula', () => {
    const e = open('so x^2 grows')
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, 4, 7)))
    insertMath(e, false)
    expect(e.getText()).toBe('so \\( x^2 \\) grows')
  })

  it('gives an equation its own paragraph', () => {
    const e = open('Then')
    e.commands.setTextSelection(e.state.doc.content.size - 1)
    insertMath(e, true)
    expect(e.state.doc.content.content.map((n) => n.textContent)).toEqual(['Then', '\\[ \\]'])
  })

  it('does nothing inside a code block', () => {
    const e = open('```\ncode\n```')
    e.commands.setTextSelection(2)
    const before = e.getJSON()
    expect(insertMath(e, false)).toBe(false)
    expect(e.getJSON()).toEqual(before)
  })
})

describe('the / menu', () => {
  it('offers math under its own section, found by "math", "latex" or "formula"', () => {
    const ctx = { hasText: false, hasSelection: false, hasHeadings: false }
    for (const q of ['math', 'latex', 'formula', 'equation']) {
      expect(availableCommands(q, ctx).map((c) => c.id)).toContain('equation')
    }
    expect(availableCommands('superscript', ctx).map((c) => c.id)).toEqual(['inlinemath'])
    expect(availableCommands('', ctx).filter((c) => c.section === 'math').length).toBe(2)
  })
})
