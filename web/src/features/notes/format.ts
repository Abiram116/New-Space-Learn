/**
 * Pure formatting helpers for the notes list.
 *
 * No React, no editor, no I/O — which is what makes them the part of this
 * feature that is cheap to unit-test. See `format.test.ts`.
 */

import type { Note } from '../../api/types'
import { stripMarkdown } from '../../lib/text'

export type Filter = 'all' | 'ai' | 'mine'

/**
 * First line or so of a note, for the list.
 *
 * The base64 hazard is real — images live in the markdown as data URLs, so a
 * note opening with a screenshot could preview as thousands of characters of
 * gibberish — but `stripMarkdown` already removes image syntax, so nothing
 * extra is needed here. This function had a second image-stripping pass until
 * a mutation test showed removing it changed no behaviour at all. Kept as a
 * note rather than a line of code, so the hazard stays documented without
 * pretending to guard against it twice.
 */
export function notePreview(bodyMd: string, limit = 110): string {
  const text = stripMarkdown(bodyMd)
  if (text.length <= limit) return text
  return `${text.slice(0, limit - 1).trimEnd()}…`
}

export function labelFor(f: Filter, notes: Note[] | null): string {
  if (!notes) return f === 'all' ? 'All' : f === 'ai' ? 'AI' : 'Mine'
  const all = notes.length
  const mine = notes.filter((n) => n.origin === 'user').length
  const ai = all - mine
  if (f === 'all') return `All ${all}`
  if (f === 'ai') return `AI ${ai}`
  return `Mine ${mine}`
}

export function originLabel(origin: Note['origin']): string {
  if (origin === 'user') return 'Written by me'
  if (origin === 'doc') return 'From a document'
  return 'Notes agent'
}

export function relativeTime(iso: string): string {
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return d.toLocaleDateString()
}

