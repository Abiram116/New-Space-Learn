/**
 * "Add to note" was append-only — no way to say "put this under the
 * Encoder heading" instead of always landing at the very end. This adds an
 * optional, free-text marker: the first line of the note whose text
 * contains it (case-insensitive) becomes the insertion point, and the new
 * content lands right after that line. No marker, or no match, falls back
 * to the original append-at-end behaviour — the common case stays a no-op
 * for anyone who doesn't type one in.
 *
 * Deliberately line-based, not heading/section-aware: a raw substring match
 * against the marker is a full understanding of what got typed, so there's
 * nothing surprising about where it lands.
 */

function appendAtEnd(body: string, addition: string): string {
  const trimmed = body.trim()
  return trimmed ? `${trimmed}\n\n${addition}` : addition
}

export function insertAfterMarker(
  body: string,
  marker: string,
  addition: string,
): { body: string; found: boolean } {
  const needle = marker.trim().toLowerCase()
  if (!needle) return { body: appendAtEnd(body, addition), found: false }

  const lines = body.split('\n')
  const idx = lines.findIndex((line) => line.toLowerCase().includes(needle))
  if (idx === -1) return { body: appendAtEnd(body, addition), found: false }

  const before = lines.slice(0, idx + 1).join('\n')
  const after = lines
    .slice(idx + 1)
    .join('\n')
    .trim()
  const merged = after ? `${before}\n\n${addition}\n\n${after}` : `${before}\n\n${addition}`
  return { body: merged, found: true }
}
