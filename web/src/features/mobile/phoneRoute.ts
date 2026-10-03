/**
 * Where a link should go on a phone.
 *
 * Phones are the revision half of Space Learn and have no chat. Several
 * routes the app hands out still point at chat — most importantly the
 * decision engine's suggestion on Home (`BriefSuggestion.route`), which for a
 * misconception, a weak prerequisite or plain "continue" is the bare topic
 * route `/:space/:sub`, i.e. that topic's chat on desktop.
 *
 * `phoneRoute` rewrites those to something a phone can actually do:
 *   - a chat destination (`/a/b`, `/a/b/chat`, `/a/b/skills`) becomes
 *     the topic hub (`/a/b`, which renders `TopicHub` on phones) — or,
 *     when the suggestion's `action` says what kind of work it is, that
 *     topic's cards or quizzes directly;
 *   - chat-only query strings are dropped with it;
 *   - everything else (cards, quizzes, notes, docs, home, profile, external)
 *     passes through untouched.
 *
 * Pure: no router, no window. Call it only when `useIsMobile()` is true;
 * desktop keeps the original route.
 */

import { RESERVED_ROOTS } from '../../lib/slug'

// `/<subject>/<topic>[/…]`, with the old `/s/` prefix tolerated: the server still
// builds routes as `/s/<id>/<id>`, and those must be recognised too.
const TOPIC_ROUTE = /^(\/s)?\/([^/?#]+)\/([^/?#]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/

/** Topic sub-routes that are chat, or only mean anything next to chat. */
const CHAT_ONLY = new Set(['', '/chat', '/skills'])

/** Suggestion kinds (`BriefSuggestion.action`) with an obvious phone-side destination. */
const ACTION_SECTION: Record<string, 'flashcards' | 'quizzes'> = {
  due_cards: 'flashcards',
  slipping: 'quizzes',
  weak_topic: 'quizzes',
}

/** The pieces of a topic route, or null for anything else (a page of its own included). */
function parse(route: string): { base: string; rest: string } | null {
  const m = TOPIC_ROUTE.exec(route)
  if (!m) return null
  // Without the `/s` prefix the first segment could just be a page (`/notes/x`).
  if (!m[1] && RESERVED_ROOTS.has(m[2])) return null
  return { base: `${m[1] ?? ''}/${m[2]}/${m[3]}`, rest: (m[4] ?? '').replace(/\/+$/, '') }
}

export function phoneRoute(route: string, action?: string | null): string {
  const topic = parse(route)
  if (!topic || !CHAT_ONLY.has(topic.rest)) return route
  const section = action ? ACTION_SECTION[action] : undefined
  return section ? `${topic.base}/${section}` : topic.base
}

/** True when `route` is a chat destination on desktop. */
export function isChatRoute(route: string): boolean {
  const topic = parse(route)
  return topic ? CHAT_ONLY.has(topic.rest) : false
}
