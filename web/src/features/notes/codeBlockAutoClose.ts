import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/**
 * Bracket/quote auto-closing, scoped to code blocks only — the "automatic
 * filling" a code editor is expected to have (type `(` and get `()` with the
 * caret between them), which the plain code block didn't do at all.
 *
 * Deliberately NOT full autocomplete/IntelliSense: there's no per-language
 * suggestion engine here, just the same pair-matching every code editor does
 * by default. That's the part that's actually missing; real completions
 * would mean a language server per language, which this note-taking app has
 * no use for.
 */

const PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
}
const QUOTES = new Set(['"', "'", '`'])
const CLOSERS = new Set(Object.values(PAIRS))
/** A quote/bracket shouldn't auto-pair mid-word — `it|s` + `'` should type a
 *  plain apostrophe, not wrap into `it'|'s`. */
const WORD_CHAR = /[A-Za-z0-9_]/

function inCodeBlock(view: EditorView): boolean {
  const { $from } = view.state.selection
  return $from.parent.type.name === 'codeBlock'
}

/** Wired into `editorProps.handleTextInput`. Returns true when it has fully
 *  handled the input itself (caller must not also insert the typed text). */
export function handleCodeBlockTextInput(
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean {
  if (!inCodeBlock(view) || text.length !== 1) return false
  const { state } = view
  const nextChar = state.doc.textBetween(to, Math.min(to + 1, state.doc.content.size))
  const prevChar = state.doc.textBetween(Math.max(0, from - 1), from)

  // Skip-over: typing a closer (or a quote) right before its own match just
  // moves the caret past it, instead of inserting a duplicate.
  if ((CLOSERS.has(text) || QUOTES.has(text)) && nextChar === text && from === to) {
    view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(to + 1))))
    return true
  }

  const closer = PAIRS[text]
  const isQuote = QUOTES.has(text)
  if (!closer && !isQuote) return false

  // Surround the selection: select `foo`, type `(` → `(foo)`.
  if (from !== to) {
    const selected = state.doc.textBetween(from, to)
    const close = closer ?? text
    const tr = state.tr.insertText(text + selected + close, from, to)
    view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(from + 1 + selected.length))))
    return true
  }

  // Quotes only auto-pair at a word boundary — avoids mangling contractions
  // and mid-identifier apostrophes/backticks.
  if (isQuote && (WORD_CHAR.test(prevChar) || WORD_CHAR.test(nextChar))) return false

  const close = closer ?? text
  const tr = state.tr.insertText(text + close, from, to)
  view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(from + 1))))
  return true
}

/** Wired into `editorProps.handleKeyDown`. Backspacing inside an empty pair
 *  (`(|)`) removes both characters instead of leaving the closer dangling. */
export function handleCodeBlockBackspace(view: EditorView): boolean {
  if (!inCodeBlock(view)) return false
  const { state } = view
  const { from, to, empty } = state.selection
  if (!empty || from === 0) return false
  const before = state.doc.textBetween(from - 1, from)
  const after = state.doc.textBetween(to, Math.min(to + 1, state.doc.content.size))
  const matches = PAIRS[before] === after || (QUOTES.has(before) && after === before)
  if (!matches) return false
  view.dispatch(state.tr.delete(from - 1, to + 1))
  return true
}
