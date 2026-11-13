/**
 * Starting a formula without knowing the delimiters by heart.
 *
 * Typing `\(` or `$` already works (see `mathPreview.ts`), but only for
 * someone who knows to type it — and on a phone keyboard a backslash is three
 * screens deep. These put the delimiters in and the caret between them, so
 * the student types only the LaTeX and watches the live preview form.
 *
 * Written straight into the document as text, never through
 * `insertContent(string)`: tiptap-markdown parses any string handed to that
 * as markdown, and markdown eats the backslash of `\(`. A ProseMirror
 * `insertText` is the one path that keeps the characters exactly as given.
 */

import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

export const INLINE_MATH = { open: '\\(', close: '\\)' } as const
export const DISPLAY_MATH = { open: '\\[', close: '\\]' } as const

/**
 * Wraps the selection in math delimiters, or inserts an empty pair with the
 * caret inside. A selection such as `x^2` becomes `\(x^2\)` — the quickest
 * way to turn a formula written as plain text into one that renders.
 *
 * Display math gets its own paragraph when there is text beside it: a
 * display formula is a block on the page, and dropping one mid-sentence
 * renders as a sentence with a hole in it.
 *
 * @returns false (and changes nothing) inside a code block, where a formula
 *   would just be more code.
 */
export function insertMath(editor: Editor, display: boolean): boolean {
  const { state } = editor
  const { from, to, empty, $from } = state.selection
  if ($from.parent.type.spec.code) return false
  const { open, close } = display ? DISPLAY_MATH : INLINE_MATH
  const selected = empty ? '' : state.doc.textBetween(from, to, ' ')

  let tr = state.tr
  let at = from
  if (display && $from.parent.textContent.trim() && !selected) {
    // Not in an empty line: start a fresh paragraph for the formula.
    tr = tr.split(from)
    at = tr.mapping.map(from)
  }
  const inner = selected ? ` ${selected.trim()} ` : ' '
  // "Speed is|" + inline math shouldn't glue the formula to the word.
  const before = at > tr.doc.resolve(at).start() ? tr.doc.textBetween(at - 1, at) : ''
  const lead = !display && before && !/\s/.test(before) ? ' ' : ''
  tr = tr.insertText(`${lead}${open}${inner}${close}`, at, empty ? at : tr.mapping.map(to))
  at += lead.length
  // With a selection the caret lands after the formula (it is finished);
  // with none it lands inside, ready to type.
  const caret = selected ? at + open.length + inner.length + close.length : at + open.length + 1
  tr = tr.setSelection(TextSelection.create(tr.doc, caret))
  editor.view.dispatch(tr.scrollIntoView())
  editor.view.focus()
  return true
}
