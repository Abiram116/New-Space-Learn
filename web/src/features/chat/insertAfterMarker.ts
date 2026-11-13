/**
 * "Add to note" was append-only — no way to say "put this under the
 * Encoder heading" instead of always landing at the very end. This adds an
 * optional, free-text marker: the first line of the note whose text
 * contains it (case-insensitive) becomes the insertion point, and the new
 * content lands after the block that line belongs to. No marker, or no
 * match, falls back to the original append-at-end behaviour — the common
 * case stays a no-op for anyone who doesn't type one in.
 *
 * Line-based for the match, block-aware for the landing. Inserting right
 * after the matched *line* cut through whatever that line was part of: a
 * match inside a fenced code block put the answer inside the code (it
 * rendered as one long monospace blob), a match on a table row split the
 * table in two, and a match on the first line of a paragraph broke the
 * paragraph. So the content now lands after the end of that block — the
 * closing fence, the last row, the paragraph's last line. A heading is its
 * own block, so "Encoder" still lands directly under the Encoder heading.
 *
 * Matching reads the line the way it displays: a saved note holds
 * `self\_attention` (the editor escapes markdown characters on save), and a
 * student typing "self_attention" should find it.
 */

function appendAtEnd(body: string, addition: string): string {
  const trimmed = body.trim()
  return trimmed ? `${trimmed}\n\n${addition}` : addition
}

/** A line as it reads on screen: markdown escapes and heading/list/quote markers gone. */
function visible(line: string): string {
  return line
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)/, '')
    .toLowerCase()
}

const FENCE = /^\s*(```|~~~)/

/** Index of the last line of the block that line `idx` sits in. */
function endOfBlock(lines: string[], idx: number, fenceOpenAt: number | null): number {
  if (fenceOpenAt !== null) {
    // Inside (or on the opening line of) a code fence: land after its close.
    for (let i = Math.max(idx, fenceOpenAt + 1); i < lines.length; i++) {
      if (FENCE.test(lines[i])) return i
    }
    return lines.length - 1
  }
  // A heading is a block of its own — "under the heading" means right here.
  if (/^\s*#{1,6}\s/.test(lines[idx])) return idx
  let end = idx
  while (end + 1 < lines.length && lines[end + 1].trim() !== '' && !FENCE.test(lines[end + 1])) {
    if (/^\s*#{1,6}\s/.test(lines[end + 1])) break
    end += 1
  }
  return end
}

export function insertAfterMarker(
  body: string,
  marker: string,
  addition: string,
): { body: string; found: boolean } {
  const needle = marker.trim().toLowerCase()
  if (!needle) return { body: appendAtEnd(body, addition), found: false }

  const lines = body.split('\n')
  let fenceOpen: number | null = null
  let idx = -1
  let fenceAtMatch: number | null = null
  for (let i = 0; i < lines.length; i++) {
    const isFence = FENCE.test(lines[i])
    // The fence lines themselves are delimiters, not text to match.
    if (!isFence && visible(lines[i]).includes(needle)) {
      idx = i
      fenceAtMatch = fenceOpen
      break
    }
    if (isFence) fenceOpen = fenceOpen === null ? i : null
  }
  if (idx === -1) return { body: appendAtEnd(body, addition), found: false }

  const end = endOfBlock(lines, idx, fenceAtMatch)
  const before = lines.slice(0, end + 1).join('\n').trimEnd()
  const after = lines
    .slice(end + 1)
    .join('\n')
    .trim()
  const merged = after ? `${before}\n\n${addition}\n\n${after}` : `${before}\n\n${addition}`
  return { body: merged, found: true }
}
