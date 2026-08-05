/**
 * Model output reaches places that render plain text — a card face, a deck
 * name, a title attribute. Markdown syntax leaking into those reads as broken
 * software, so strip it at the boundary rather than hoping every prompt holds.
 */
export function stripMarkdown(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' ')       // fenced code
    .replace(/`([^`]+)`/g, '$1')            // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')   // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → their text
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')     // headings
    .replace(/^\s{0,3}>\s?/gm, '')          // blockquotes
    .replace(/^\s*[-*+]\s+/gm, '')          // bullets
    .replace(/^\s*\d+\.\s+/gm, '')          // ordered list markers
    .replace(/(\*\*|__)(.*?)\1/g, '$2')     // bold
    .replace(/(\*|_)(.*?)\1/g, '$2')        // italic
    .replace(/~~(.*?)~~/g, '$1')            // strikethrough
    .replace(/^\s*([-*_]\s*){3,}$/gm, '')   // horizontal rules
    .replace(/\s+/g, ' ')
    .trim()
}

/** First sentence or `limit` chars, whichever is shorter. For derived titles. */
export function firstSentence(input: string, limit = 60): string {
  const clean = stripMarkdown(input)
  const stop = clean.search(/[.!?](\s|$)/)
  const cut = stop > 0 && stop < limit ? stop : limit
  return clean.length <= cut ? clean : `${clean.slice(0, cut).trimEnd()}…`
}
