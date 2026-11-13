/**
 * PDF text arrives hard-wrapped at the page's own line width: "about 4.5 million"
 * / "sentence pairs." on two lines. Shown as-is in a narrower box it reads as a
 * ragged mess. This joins those lines back into paragraphs and keeps section
 * headings ("5.2 Hardware and Schedule") on their own line.
 *
 * Display only: the stored and indexed text is untouched, and so is what the
 * model read. It guesses from line shape, so it can only ever be wrong about
 * where a paragraph breaks, never about a word.
 */

export type Block = { kind: 'heading' | 'p'; text: string }

const HEADING = /^(\d+(\.\d+)*\.?|[A-Z]\.|[IVX]+\.)\s+\S.{0,70}$/

export function reflow(text: string): Block[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) return []
  const widest = Math.max(...lines.map((l) => l.length))
  const blocks: Block[] = []
  let current: string | null = null
  const flush = () => {
    if (current !== null) blocks.push({ kind: 'p', text: current })
    current = null
  }
  for (const line of lines) {
    if (HEADING.test(line) && !/[.!?,;]$/.test(line.replace(/^\S+\s/, ''))) {
      flush()
      blocks.push({ kind: 'heading', text: line })
      continue
    }
    if (current === null) {
      current = line
      continue
    }
    // A hyphen at the line end joins with no space ("source-" + "target").
    current += current.endsWith('-') ? line : ` ${line}`
    // A sentence that ends a clearly short line ends the paragraph.
    if (/[.!?]$/.test(line) && line.length < widest * 0.7) flush()
  }
  flush()
  return blocks
}
