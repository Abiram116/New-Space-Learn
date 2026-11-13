/**
 * A chat answer, turned into note content that keeps its formatting.
 *
 * Headings, emphasis, nested lists, tables, code and links are the same
 * markdown in both places and need nothing. Three things did:
 *
 * **Citations.** Answers carry `[[n]]` markers that chat swaps for little
 * numbered badges. A note has no badges, so they landed as literal
 * `[[1]]` text. Now each run of markers becomes a readable reference —
 * "(p. 4)" when the passage has a page, the document's name when it
 * doesn't — with one italic "Sources:" line listing what was cited. Without
 * the citation list there is nothing to say a marker points at, and it is
 * dropped rather than left as an unexplained number.
 *
 * **Math.** Appending a reply to a note that has already been saved used to
 * destroy every formula: the note body is then read as already-escaped
 * markdown (see `markdownForEditor`), so `\(x^2\)` lost its backslashes and
 * showed as "(x^2)". The addition is now protected with `protectMath` before
 * it joins the note — and so is the rest of the note, if it has never been
 * through the editor either.
 *
 * **Where AI text starts.** A reply appended at the end is set off by the
 * same `---` divider an `/ai` answer gets inside the editor, so a note mixing
 * your words and the AI's still shows which is which.
 */

import type { Citation, Note } from '../../api/types'
import { insertAfterMarker } from '../chat/insertAfterMarker'
import { markdownForEditor, protectMath } from './mathMarkdown'
import { tokenizeMath } from './mathSyntax'

/** One run of markers, possibly with the space before it: `[[1]]`, ` [[2]][[3]]`, `[[1, 2]]`. */
const MARKER_RUN = /[ \t]*(?:\[\[\d+(?:\s*,\s*\d+)*\]\])+/g

/** Markdown characters a document name could carry into an italic line and break it. */
const unsafeName = (name: string) => name.replace(/[*`[\]]/g, '').trim()

/** "(p. 4)" for a paged locator, else the document's own name. */
function shortRef(c: Citation): string {
  const first = c.locator.split(' · ')[0]?.trim() ?? ''
  if (/^pp?\.\s*\d/.test(first)) return first
  const name = unsafeName(c.document_name)
  return name.length > 40 ? `${name.slice(0, 39).trimEnd()}…` : name
}

export function citationsToReferences(
  content: string,
  citations: Citation[] = [],
): { text: string; used: Citation[] } {
  const byMarker = new Map(citations.map((c) => [c.marker, c]))
  const used = new Map<number, Citation>()
  let text = ''
  for (const t of tokenizeMath(content)) {
    // Code and formulas are never touched: `[[1]]` in code is code.
    if (t.kind !== 'text') {
      text += t.source
      continue
    }
    text += t.source.replace(MARKER_RUN, (run) => {
      const refs: string[] = []
      for (const n of run.match(/\d+/g) ?? []) {
        const c = byMarker.get(Number(n))
        if (!c) continue
        used.set(c.marker, c)
        const ref = shortRef(c)
        if (!refs.includes(ref)) refs.push(ref)
      }
      return refs.length ? ` (${refs.join('; ')})` : ''
    })
  }
  return { text, used: [...used.values()] }
}

/** The italic line naming what an answer cited, each document once. */
export function sourcesLine(used: Citation[]): string {
  if (used.length === 0) return ''
  const byDoc = new Map<string, { name: string; locs: string[] }>()
  for (const c of [...used].sort((a, b) => a.marker - b.marker)) {
    const entry = byDoc.get(c.document_id) ?? { name: unsafeName(c.document_name), locs: [] }
    const loc = c.locator.split(' · ')[0]?.trim()
    if (loc && !entry.locs.includes(loc)) entry.locs.push(loc)
    byDoc.set(c.document_id, entry)
  }
  const parts = [...byDoc.values()].map((d) => (d.locs.length ? `${d.name} (${d.locs.join(', ')})` : d.name))
  return `*Sources: ${parts.join(' · ')}*`
}

/**
 * A chat reply as note markdown, still in raw (unprotected) form — the shape
 * a brand-new note is stored in, exactly like a note the AI generates.
 */
export function chatReplyToMarkdown(content: string, citations: Citation[] = []): string {
  const { text, used } = citationsToReferences(content.trim(), citations)
  const tidy = text.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
  const sources = sourcesLine(used)
  return sources ? `${tidy}\n\n${sources}` : tidy
}

/**
 * A title for a new note, when the reply announces one: its first line is a
 * heading. Anything else returns '' — a title cut from the middle of a
 * sentence is the ellipsis-fragment problem flashcard deck names once had.
 */
export function titleFromReply(content: string): string {
  const first = content.trim().split('\n')[0] ?? ''
  const m = first.match(/^#{1,3}\s+(.+?)\s*#*$/)
  if (!m) return ''
  const title = m[1].replace(/[*_`]/g, '').replace(/\[\[\d+\]\]/g, '').trim()
  return title.length <= 80 ? title : ''
}

/**
 * The full body after appending a reply to an existing note.
 *
 * Returns markdown in the "already serialized" form the editor loads as-is —
 * which every note is once this is saved, since any body PATCH sets
 * `touched_by_user` (see `markdownForEditor`).
 */
export function appendReply(
  note: Pick<Note, 'body_md' | 'touched_by_user'>,
  reply: string,
  marker = '',
): { body: string; found: boolean; block: string } {
  const base = markdownForEditor(note.body_md, note.touched_by_user)
  const addition = protectMath(reply)
  // Under a chosen heading or passage the placement already says where the
  // answer starts; a divider there would just cut the section in two.
  const placed = insertAfterMarker(base, marker, addition)
  if (placed.found) return { ...placed, block: addition }
  const block = base.trim() ? `---\n\n${addition}` : addition
  return { ...insertAfterMarker(base, '', block), found: false, block }
}
