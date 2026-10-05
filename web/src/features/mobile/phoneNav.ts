/**
 * The phone shell's reading of a URL: which tab is lit, what the top bar
 * says, where Back goes, and where switching topic lands. Pure functions of
 * the pathname so the whole navigation model is testable without a router.
 */

import type { Space, Subspace } from '../../api/types'
import { RESERVED_ROOTS } from '../../lib/slug'

export type PhoneTab = 'today' | 'cards' | 'quizzes' | 'notes' | 'you'

export type PhoneSection = 'flashcards' | 'quizzes' | 'notes' | 'docs' | 'skills' | 'chat'

// `/<subject>/<topic>[/<section>]`, or the old `/s/<subject>/<topic>[/<section>]`.
const TOPIC_PATH = /^\/(?:s\/)?([^/]+)\/([^/]+)(?:\/([^/]+))?\/?$/

/**
 * `{spaceId, subspaceId, section}` for a topic URL, else null. `section` is null
 * at the topic root. A path whose first segment is a page of its own
 * (`/auth/callback`, a bare `/s/x`) is not a topic.
 */
export function topicFromPath(
  pathname: string,
): { spaceId: string; subspaceId: string; section: string | null } | null {
  const m = TOPIC_PATH.exec(pathname)
  if (!m || RESERVED_ROOTS.has(m[1])) return null
  return { spaceId: decodeURIComponent(m[1]), subspaceId: decodeURIComponent(m[2]), section: m[3] ?? null }
}

/** The account-wide list pages, reachable with or without a topic in the URL. */
const SECTION_TAB: Record<string, PhoneTab> = {
  flashcards: 'cards',
  quizzes: 'quizzes',
  notes: 'notes',
}

/** Which bottom tab is current. Null on topic-level pages (hub, sources) that belong to no tab. */
export function phoneTabFor(pathname: string): PhoneTab | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/home') return 'today'
  if (path === '/profile' || path === '/settings') return 'you'
  const top = /^\/(flashcards|quizzes|notes)$/.exec(path)
  if (top) return SECTION_TAB[top[1]]
  const topic = topicFromPath(path)
  if (topic?.section && SECTION_TAB[topic.section]) return SECTION_TAB[topic.section]
  return null
}

const SECTION_TITLE: Record<string, string> = {
  flashcards: 'Cards',
  quizzes: 'Quizzes',
  notes: 'Notes',
  docs: 'Files',
  skills: 'Skills',
  chat: 'Chat',
}

/** An open deck (`/flashcards?deck=…`): a drill-in from the Cards tab. */
function isOpenDeck(path: string, search: string): boolean {
  if (!new URLSearchParams(search).has('deck')) return false
  if (path === '/flashcards') return true
  return topicFromPath(path)?.section === 'flashcards'
}

/** The top app bar's title for a path. */
export function phoneTitle(pathname: string, search = ''): string {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (isOpenDeck(path, search)) return 'Deck'
  if (path === '/home') return 'Today'
  if (path === '/profile') return 'You'
  if (path === '/settings') return 'Settings'
  const top = /^\/(flashcards|quizzes|notes)$/.exec(path)
  if (top) return SECTION_TITLE[top[1]]
  const topic = topicFromPath(path)
  if (topic) return topic.section ? (SECTION_TITLE[topic.section] ?? 'Topic') : 'Topic'
  return 'Space Learn'
}

/**
 * Titles a screen's own header can skip on a phone, because the top bar is
 * already saying it. (Screens name themselves "Documents" where the phone
 * calls the same place "Sources" — both count.)
 */
export const SHELL_TITLES = new Set(['Cards', 'Quizzes', 'Notes', 'Documents', 'Files', 'Sources', 'Skills', 'Today', 'You', 'Settings'])

/**
 * Where the top bar's Back goes, or null for a root screen. Tabs are roots;
 * pages you drill into from a tab or the hub go back to it.
 */
export function phoneBackFor(pathname: string, search = ''): string | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (isOpenDeck(path, search)) return path
  if (path === '/settings') return '/profile'
  const topic = topicFromPath(path)
  if (topic && (topic.section === 'docs' || topic.section === 'skills' || topic.section === 'chat')) {
    return `/${encodeURIComponent(topic.spaceId)}/${encodeURIComponent(topic.subspaceId)}`
  }
  return null
}

/**
 * Does the topic switcher belong in the top bar here? Only where the topic
 * scopes what you see (Today, the hub, Sources, Skills). Not on account pages,
 * nor on the Cards / Quizzes / Notes lists, which span every topic — a pill
 * there would change nothing.
 */
export function showsTopicSwitcher(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/profile' || path === '/settings') return false
  if (/^\/(flashcards|quizzes|notes)(\/|$)/.test(path)) return false
  const topic = topicFromPath(path)
  if (topic?.section && SECTION_TAB[topic.section]) return false
  return true
}

/**
 * Where picking topic `base` in the switcher should land from `pathname`.
 * On a topic section (cards, quizzes, notes, sources) you stay on that
 * section of the new topic; from anywhere else you go to the new topic's hub.
 */
export function switchTarget(pathname: string, base: string): string {
  const topic = topicFromPath(pathname)
  if (topic?.section && ['flashcards', 'quizzes', 'notes', 'docs'].includes(topic.section)) {
    return `${base}/${topic.section}`
  }
  const top = /^\/(flashcards|quizzes|notes)\/?$/.exec(pathname)
  if (top) return `${base}/${top[1]}`
  return base
}

/** Badge copy for a count: nothing for zero, capped so it never widens the tab. */
export function badgeText(n: number | null | undefined): string | null {
  if (!n || n <= 0 || !Number.isFinite(n)) return null
  return n > 99 ? '99+' : String(Math.floor(n))
}

/** Pure: resolve which topic is current from the URL's ids, a remembered id, and the list. */
export function resolveTopic(
  spaces: Space[],
  urlSubspaceId: string | null,
  rememberedId: string | null,
): { space: Space; subspace: Subspace } | null {
  const find = (id: string | null) => {
    if (!id) return null
    for (const space of spaces) {
      const subspace = space.subspaces.find((s) => s.id === id)
      if (subspace) return { space, subspace }
    }
    return null
  }
  const fromUrl = find(urlSubspaceId)
  if (fromUrl) return fromUrl
  const fromMemory = find(rememberedId)
  if (fromMemory) return fromMemory

  let best: { space: Space; subspace: Subspace } | null = null
  let bestAt = -Infinity
  for (const space of spaces) {
    for (const subspace of space.subspaces) {
      const at = subspace.last_activity_at ? Date.parse(subspace.last_activity_at) : -Infinity
      if (!best || at > bestAt) {
        best = { space, subspace }
        bestAt = at
      }
    }
  }
  return best
}
