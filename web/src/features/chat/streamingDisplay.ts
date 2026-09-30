/**
 * The display copy of a half-received reply.
 *
 * Markdown is parsed from scratch on every frame, and a prefix of a valid
 * document is often not itself valid: an unclosed ``` swallows the rest of
 * the page into a code block, a lone `**` renders literally then turns bold,
 * a `|` table row is a paragraph until its delimiter row arrives. Each of
 * those is a visible layout jump when the closing token finally lands.
 *
 * This repairs the *display copy only* (the stored/final text is untouched):
 * close what is open, and hold back the few trailing characters whose
 * meaning is not decided yet.
 */

export function prepareStreamingDisplay(text: string): string {
  if (!text) return text

  const fence = openFence(text)
  if (fence) {
    let out = text
    // A fence marker still being typed ("``") is not a fence yet.
    out = out.replace(/(^|\n)[ ]{0,3}(`{1,2}|~{1,2})$/, '$1')
    // The three-backtick opener with nothing after it yet renders as an empty
    // block; that's fine and doesn't jump when code arrives.
    if (openFence(out)) out += (out.endsWith('\n') ? '' : '\n') + fence
    return out
  }

  let out = text

  // Partial citation marker: "[[", "[[1", "[[12]" or a lone trailing "[".
  out = out.replace(/\[\[\d*\]?$/, '').replace(/(?<!\[)\[$/, '')

  out = holdBackTable(out)

  // Unclosed inline math: hide from the opener on until it closes.
  out = holdBackOpenMath(out)

  // Line-start markers that only mean something once the next char arrives.
  out = out.replace(/(^|\n)[ ]{0,3}#{1,6}$/, '$1')

  // Inline emphasis, judged within the current paragraph only.
  const breakAt = out.lastIndexOf('\n\n')
  const paraStart = breakAt === -1 ? 0 : breakAt + 2
  const head = out.slice(0, paraStart)
  let para = out.slice(paraStart)

  // Ignore markers inside closed inline code.
  const stripped = para.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length))

  const ticks = (stripped.match(/`/g) ?? []).length
  if (ticks % 2 === 1) {
    // An opener with nothing after it yet: drop it. Otherwise close it.
    para = stripped.endsWith('`') ? para.slice(0, -1) : para + '`'
    return head + para
  }

  const bold = (stripped.match(/\*\*/g) ?? []).length
  if (bold % 2 === 1) {
    para = /\*\*\s*$/.test(para) ? para.replace(/\*\*\s*$/, '') : para + '**'
  } else if (/(?<!\*)\*$/.test(para)) {
    // A lone trailing "*": half of a "**" opener, a bullet or an italic start.
    para = para.slice(0, -1)
  }
  return head + para
}

/** The marker of a fenced block that is still open at the end, if any. */
export function openFence(text: string): string | null {
  let open: { char: string; len: number } | null = null
  for (const line of text.split('\n')) {
    const m = /^[ ]{0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (!m) continue
    const marker = m[1]
    if (!open) {
      // A backtick fence's info string may not contain backticks.
      if (marker[0] === '`' && m[2].includes('`')) continue
      open = { char: marker[0], len: marker.length }
    } else if (marker[0] === open.char && marker.length >= open.len && m[2].trim() === '') {
      open = null
    }
  }
  return open ? open.char.repeat(open.len) : null
}

function holdBackTable(text: string): string {
  const lines = text.split('\n')
  let i = lines.length
  while (i > 0 && lines[i - 1].trimStart().startsWith('|')) i--
  const block = lines.slice(i)
  if (block.length === 0) return text
  const decided = block.length >= 2 && /^\s*\|?\s*:?-{2,}/.test(block[1])
  if (!decided) return lines.slice(0, i).join('\n')
  // A table row still being typed stays hidden until its line is complete.
  const last = block[block.length - 1]
  if (!last.trimEnd().endsWith('|')) return lines.slice(0, lines.length - 1).join('\n')
  return text
}

function holdBackOpenMath(text: string): string {
  for (const [open, close] of [
    ['\\(', '\\)'],
    ['\\[', '\\]'],
  ]) {
    const o = text.lastIndexOf(open)
    if (o !== -1 && text.indexOf(close, o + 2) === -1) return text.slice(0, o)
  }
  return text
}
