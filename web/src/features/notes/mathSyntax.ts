/**
 * Where the formulas are in a piece of text — the one reading of math syntax
 * that chat and notes share.
 *
 * Chat (`MarkdownMessage`) and the note editor (`mathPreview.ts`) used to read
 * math differently: chat understood `\( \)`, `\[ \]`, `$ $`, `$$ $$` and bare
 * `\begin{equation}` environments, while a note only ever drew `\( \)` and
 * `\[ \]`. So an answer full of `$x^2$` rendered in the chat bubble and then
 * sat in the note as raw dollars, and a student who typed `$x^2$` themselves —
 * the way every other math tool takes it — saw nothing happen. One tokenizer,
 * used by both, keeps "what counts as math" the same on both sides.
 *
 * Pure string work: no React, no editor, no KaTeX.
 */

export type MathPart = { latex: string; display: boolean }

/** A run of the input, in order: plain text, code (never math), or a formula. */
export type MathToken =
  | { kind: 'text'; source: string }
  | { kind: 'code'; source: string }
  | ({ kind: 'math'; source: string } & MathPart)

const MATH_OR_CODE = new RegExp(
  [
    '(```[\\s\\S]*?(?:```|$))', // 1 fenced code
    '(`[^`\\n]*`)', // 2 inline code
    '\\\\\\[([\\s\\S]+?)\\\\\\]', // 3 \[ … \]
    '\\\\\\(([\\s\\S]+?)\\\\\\)', // 4 \( … \)
    '(\\\\begin\\{(equation|align|gather)(\\*?)\\}[\\s\\S]+?\\\\end\\{\\6\\7\\})', // 5 environment
    '(\\\\\\$)', // 8 an escaped dollar is a dollar
    '\\$\\$([\\s\\S]+?)\\$\\$', // 9 $$ … $$
    '(?<![\\w$])\\$(?!\\s)([^$\\n]+?)(?<!\\s)\\$(?![\\d$])', // 10 $ … $
  ].join('|'),
  'g',
)

/** A `$ … $` span that is a price or plain prose, not a formula. */
function isInlineMath(body: string): boolean {
  if (/^[\d.,]+$/.test(body)) return false
  // "5 and he paid 10": starts like an amount and has nothing mathematical in it.
  if (/^\d[\d.,]*\s/.test(body) && !/[\\^_={}+*/<>|]/.test(body)) return false
  return true
}

/**
 * The text cut into plain runs, code and formulas — concatenating every
 * token's `source` gives back the input exactly.
 *
 * A single `$` is only math under a strict rule (see `isInlineMath`), so
 * "$5 and $10" stays a price; `\$` is always a dollar.
 */
export function tokenizeMath(content: string): MathToken[] {
  if (!content) return []
  if (!content.includes('\\') && !content.includes('$') && !content.includes('`')) {
    return [{ kind: 'text', source: content }]
  }
  const tokens: MathToken[] = []
  let text = ''
  let at = 0
  const flush = () => {
    if (text) tokens.push({ kind: 'text', source: text })
    text = ''
  }
  for (const m of content.matchAll(MATH_OR_CODE)) {
    const whole = m[0]
    text += content.slice(at, m.index)
    at = m.index + whole.length
    if (m[1] !== undefined || m[2] !== undefined) {
      flush()
      tokens.push({ kind: 'code', source: whole })
      continue
    }
    const inline = m[4] ?? (m[10] !== undefined && isInlineMath(m[10]) ? m[10] : undefined)
    const block = m[3] ?? m[5] ?? m[9]
    // An environment keeps its \begin … \end: KaTeX needs them to lay it out.
    const latex = (block ?? inline ?? '').trim()
    if (!latex) {
      text += whole
      continue
    }
    flush()
    tokens.push({ kind: 'math', source: whole, latex, display: block !== undefined })
  }
  text += content.slice(at)
  flush()
  return tokens
}

/** The message cut into plain text and formulas, in order (code stays text). */
export function splitMath(content: string): (string | MathPart)[] {
  const parts: (string | MathPart)[] = []
  for (const t of tokenizeMath(content)) {
    if (t.kind === 'math') {
      parts.push({ latex: t.latex, display: t.display })
    } else if (typeof parts[parts.length - 1] === 'string') {
      parts[parts.length - 1] += t.source
    } else {
      parts.push(t.source)
    }
  }
  return parts
}

/** Each formula with where it sits in `content` — what the editor decorates. */
export function findMathSpans(
  content: string,
): ({ start: number; end: number } & MathPart)[] {
  const spans: ({ start: number; end: number } & MathPart)[] = []
  let at = 0
  for (const t of tokenizeMath(content)) {
    if (t.kind === 'math') {
      spans.push({ start: at, end: at + t.source.length, latex: t.latex, display: t.display })
    }
    at += t.source.length
  }
  return spans
}
