/**
 * Two problems stood between typing/pasting LaTeX into a note and it
 * actually rendering as math.
 *
 * **The bigger one: the backslash never survived.** Notes are stored and
 * loaded as markdown, parsed through `tiptap-markdown`'s CommonMark parser.
 * CommonMark treats `\` followed by ASCII punctuation as an escape sequence
 * — the backslash is consumed and only the punctuation survives. `\[` and
 * `\)` are exactly that shape, so `\[ \sin(x) \]` came back from a save/load
 * round trip as `[ \sin(x) ]` — the delimiters silently lost their
 * backslash while `\sin` (backslash + *letter*, not an escape CommonMark
 * recognizes) survived untouched. That's the exact asymmetry visible in any
 * already-broken note: backslashed commands intact, backslashed brackets
 * gone. `preserveLatexBackslashes` runs before any markdown string reaches
 * the parser and doubles every backslash outside fenced code blocks —
 * `\\` is CommonMark's own unambiguous "escaped backslash" sequence, so a
 * doubled backslash always parses back out to exactly one literal `\`,
 * whatever follows it. Fenced code blocks are left alone: escape processing
 * never applied inside them in the first place, so doubling there would
 * corrupt real backslashes in pasted code instead of protecting them.
 *
 * **The other half is rendering itself** — see `mathPreview.ts`, the
 * ProseMirror plugin that turns a correctly-preserved `\[...\]` / `\(...\)`
 * span into live KaTeX.
 */

const FENCE = /```[\s\S]*?```/g
// CommonMark's escapable ASCII punctuation set (backtick excluded — it
// delimits code spans, not something to double-escape here).
const ESCAPABLE_AFTER_BACKSLASH = /\\([!-/:-@[-`{-~])/g

export function preserveLatexBackslashes(markdown: string): string {
  const fences = markdown.match(FENCE) ?? []
  const parts = markdown.split(FENCE)
  let result = ''
  parts.forEach((part, i) => {
    result += part.replace(ESCAPABLE_AFTER_BACKSLASH, '\\\\$1')
    if (i < fences.length) result += fences[i]
  })
  return result
}
