/**
 * Where a link should go on a phone.
 *
 * Phones are the revision half of Space Learn and have no chat. Several
 * routes the app hands out still point at chat — most importantly the
 * decision engine's suggestion on Home (`BriefSuggestion.route`), which for a
 * misconception, a weak prerequisite or plain "continue" is the bare topic
 * route `/s/:space/:sub`, i.e. that topic's chat on desktop.
 *
 * `phoneRoute` rewrites those to something a phone can actually do:
 *   - a chat destination (`/s/a/b`, `/s/a/b/chat`, `/s/a/b/skills`) becomes
 *     the topic hub (`/s/a/b`, which renders `TopicHub` on phones) — or,
 *     when the suggestion's `action` says what kind of work it is, that
 *     topic's cards or quizzes directly;
 *   - chat-only query strings are dropped with it;
 *   - everything else (cards, quizzes, notes, docs, home, profile, external)
 *     passes through untouched.
 *
 * Pure: no router, no window. Call it only when `useIsMobile()` is true;
 * desktop keeps the original route.
 */

const TOPIC_ROUTE = /^\/s\/([^/?#]+)\/([^/?#]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/

/** Topic sub-routes that are chat, or only mean anything next to chat. */
const CHAT_ONLY = new Set(['', '/chat', '/skills'])

/** Suggestion kinds (`BriefSuggestion.action`) with an obvious phone-side destination. */
const ACTION_SECTION: Record<string, 'flashcards' | 'quizzes'> = {
  due_cards: 'flashcards',
  slipping: 'quizzes',
  weak_topic: 'quizzes',
}

export function phoneRoute(route: string, action?: string | null): string {
  const m = TOPIC_ROUTE.exec(route)
  if (!m) return route
  const base = `/s/${m[1]}/${m[2]}`
  const rest = (m[3] ?? '').replace(/\/+$/, '')
  if (!CHAT_ONLY.has(rest)) return route
  const section = action ? ACTION_SECTION[action] : undefined
  return section ? `${base}/${section}` : base
}

/** True when `route` is a chat destination on desktop. */
export function isChatRoute(route: string): boolean {
  const m = TOPIC_ROUTE.exec(route)
  if (!m) return false
  return CHAT_ONLY.has((m[3] ?? '').replace(/\/+$/, ''))
}
