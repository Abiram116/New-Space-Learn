/**
 * The search palette's pure parts: where a result opens, how a match is
 * marked, and the remembered recent searches. Kept out of the component so
 * each is tested without a DOM.
 */

import type { SearchHit, SearchKind, SearchResult } from '../../api/search'
import type { Space } from '../../api/types'
import type { IconName } from '../../components/ui/Icon'
import { subspacePath } from '../../lib/nav'

export const KIND_ICON: Record<SearchKind, IconName> = {
  subject: 'book',
  topic: 'chat',
  note: 'note',
  card: 'deck',
  quiz: 'quiz',
  file: 'doc',
  passage: 'citePage',
}

/** The topic's address. Readable slugs when the topic is in the loaded space
 *  list; otherwise the id form, which `TopicCanonical` forwards to the
 *  readable one (and turns into "not found" if the topic was deleted). */
export function topicPath(spaces: readonly Space[], subjectId: string | null, subspaceId: string): string {
  for (const space of spaces) {
    const sub = space.subspaces.find((s) => s.id === subspaceId)
    if (sub) return subspacePath(space, sub)
  }
  return `/s/${subjectId ?? '_'}/${subspaceId}`
}

/** Exactly where a result opens. Null when there is nowhere to go (a subject
 *  with no topics yet opens Home instead — see the caller). */
export function hrefFor(hit: SearchHit, spaces: readonly Space[]): string | null {
  if (hit.kind === 'subject') {
    const space = spaces.find((s) => s.id === hit.id)
    const first = space?.subspaces[0]
    return space && first ? subspacePath(space, first) : null
  }
  if (!hit.subspace_id) return null
  const base = topicPath(spaces, hit.subject_id, hit.subspace_id)
  const q = (key: string, value: string) => `?${key}=${encodeURIComponent(value)}`
  switch (hit.kind) {
    case 'topic':
      return base
    case 'note':
      return `${base}/notes${q('n', hit.id)}`
    case 'card':
      return hit.deck_id ? `${base}/flashcards${q('deck', hit.deck_id)}` : `${base}/flashcards`
    case 'quiz':
      return `${base}/quizzes${q('q', hit.id)}`
    case 'file':
      return `${base}/docs${q('d', hit.document_id ?? hit.id)}`
    case 'passage':
      return hit.document_id ? `${base}/docs${q('d', hit.document_id)}` : `${base}/docs`
  }
}

/** Where it lives, for the second line: "Operating Systems › Deadlock · Deck". */
export function placeLine(hit: SearchHit): string {
  const parts: string[] = []
  if (hit.kind !== 'subject') {
    const where = [hit.subject_name, hit.subspace_name].filter(Boolean).join(' › ')
    if (where) parts.push(where)
  }
  if (hit.kind === 'card' && hit.deck_name) parts.push(hit.deck_name)
  if (hit.kind === 'passage' && hit.locator) parts.push(hit.locator)
  if (hit.kind === 'file' && hit.status && hit.status !== 'ready') parts.push(hit.status)
  return parts.join(' · ')
}

/** Every hit in display order, for arrow-key movement across the groups. */
export function flatten(result: SearchResult | null): SearchHit[] {
  return result ? result.groups.flatMap((g) => g.hits) : []
}

export type Piece = { text: string; match: boolean }

/** `text` split around every case-insensitive occurrence of `query`, so the
 *  matches can be drawn in a <mark>. Compared character by character with
 *  `toLocaleLowerCase` on each side so a lowercase form of a different length
 *  (İ → i̇) can never shift the marked span off the match. */
export function highlight(text: string, query: string): Piece[] {
  const q = query.trim()
  if (!q || !text) return [{ text, match: false }]
  const lowerText = Array.from(text, (ch) => (ch.toLocaleLowerCase().length === ch.length ? ch.toLocaleLowerCase() : ch))
  const lowerQ = Array.from(q, (ch) => (ch.toLocaleLowerCase().length === ch.length ? ch.toLocaleLowerCase() : ch))
  const chars = Array.from(text)
  const out: Piece[] = []
  let plain = ''
  let i = 0
  while (i < chars.length) {
    let hit = i + lowerQ.length <= chars.length
    for (let j = 0; hit && j < lowerQ.length; j++) if (lowerText[i + j] !== lowerQ[j]) hit = false
    if (hit) {
      if (plain) out.push({ text: plain, match: false })
      plain = ''
      out.push({ text: chars.slice(i, i + lowerQ.length).join(''), match: true })
      i += lowerQ.length
    } else {
      plain += chars[i]
      i += 1
    }
  }
  if (plain) out.push({ text: plain, match: false })
  return out
}

// ── Recent searches ───────────────────────────────────────────────────

const RECENT_KEY = 'sl:recent-searches'
export const RECENT_MAX = 6

/** Storage can be off (private mode, blocked site data) and then throws; the
 *  palette still works, it just remembers nothing. */
export function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

export function rememberSearch(query: string): string[] {
  const q = query.trim().slice(0, 100)
  if (!q) return readRecent()
  const next = [q, ...readRecent().filter((s) => s.toLocaleLowerCase() !== q.toLocaleLowerCase())].slice(0, RECENT_MAX)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // Not remembered; nothing else depends on it.
  }
  return next
}

export function clearRecent(): void {
  try {
    localStorage.removeItem(RECENT_KEY)
  } catch {
    // Nothing to clear, then.
  }
}

/** "⌘K" on Apple keyboards, "Ctrl K" elsewhere. */
export function shortcutLabel(): string {
  const nav = typeof navigator !== 'undefined' ? navigator : null
  const platform = (nav as (Navigator & { userAgentData?: { platform?: string } }) | null)?.userAgentData?.platform ?? nav?.platform ?? ''
  return /mac|iphone|ipad/i.test(platform) ? '⌘K' : 'Ctrl K'
}
