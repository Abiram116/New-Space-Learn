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

import { healEscapedHtml } from './healHtml'
import { tokenizeMath } from './mathSyntax'

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

/** CommonMark's escapable ASCII punctuation — each one, backslashed, parses back to itself. */
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/g

/**
 * One formula, written so the markdown parser hands back its LaTeX exactly.
 *
 * Doubling backslashes alone was not enough inside a formula. `*`, `_`, `[`,
 * `|` and `&` all mean something to markdown too: `\(2*3*4\)` came back with
 * an italic 3, `\(|x|\)` split a table cell in two, and `\(a &lt; b\)` was
 * decoded into a different formula. Escaping every ASCII punctuation
 * character is CommonMark's own "this is literally that character", so
 * nothing in the LaTeX is ever read as markdown. Line breaks are folded to
 * spaces — TeX treats them the same, and a blank line inside `$$ … $$` would
 * otherwise end the paragraph halfway through the formula.
 *
 * Every formula comes out in the `\( \)` / `\[ \]` form. The editor draws `$`
 * forms too, but a bare `\begin{align}` environment has no delimiters of its
 * own to draw, and one canonical form is what a note should hold anyway.
 */
function protectFormula(latex: string, display: boolean): string {
  const body = latex
    .replace(/\s*\n\s*/g, ' ')
    // A table cell ends at the first `|`, and the note serializer does not
    // escape one on save — so `\(|x|\)` in a table survived the first load
    // and split the row on the next. `\vert`/`\Vert` draw the same bars.
    .replace(/\\\|/g, '\\Vert ')
    .replace(/\|/g, '\\vert ')
    .replace(ASCII_PUNCTUATION, '\\$&')
  // `\\\[` is an escaped backslash then an escaped bracket: the delimiter's
  // `[` must not be left bare, or `\[x\](y)` would parse as a link.
  return display ? `\\\\\\[${body}\\\\\\]` : `\\\\\\(${body}\\\\\\)`
}

/**
 * Markdown from outside the editor — an AI answer, a chat reply, pasted
 * text, a note the backend wrote — made safe to hand to the markdown parser.
 *
 * Supersedes `preserveLatexBackslashes` for every caller: formulas (in any of
 * the forms `mathSyntax.ts` reads) are protected whole, ordinary text gets
 * the same backslash doubling as before, and code — fenced blocks AND inline
 * spans — is left exactly as written. Inline code was the gap: a doubled
 * backslash inside `` `\*` `` is two real backslashes, since escapes don't
 * apply in code.
 *
 * Not idempotent, like the function it replaces: apply it once, to markdown
 * that has never been through the editor's own serializer.
 */
export function protectMath(markdown: string): string {
  let out = ''
  for (const t of tokenizeMath(markdown)) {
    if (t.kind === 'code') out += t.source
    else if (t.kind === 'math') out += protectFormula(t.latex, t.display)
    else out += t.source.replace(ESCAPABLE_AFTER_BACKSLASH, '\\\\$1')
  }
  return out
}

/**
 * A stored note body, ready for the editor.
 *
 * `touched_by_user` is set by every PATCH that writes `body_md`, so it is the
 * reliable "this body has been through the editor's serializer" flag (see the
 * note on the editor's `content`). Before that, the body is whatever the
 * backend or "Add to note" wrote, and still needs protecting.
 */
export function markdownForEditor(body: string, serialized: boolean): string {
  const healed = healEscapedHtml(body)
  return serialized ? healed : protectMath(healed)
}
