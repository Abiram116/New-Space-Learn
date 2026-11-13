import { useEffect } from 'react'
import { ADMIN_PATH } from './env'

/**
 * The browser tab's title, per page.
 *
 * Every address used to share the one title in `index.html`, so a row of
 * tabs, the history list and a screen reader's "which page is this" all said
 * "Space Learn" and nothing else. Titles are decided here, from the address,
 * and applied from the routing layer (`routes/RouteTitle`, plus
 * `routes/TopicCanonical` for a topic, which is the one place that knows the
 * topic's name) — no screen sets its own.
 */

/** The title in `index.html`: the one crawlers and link previews read. Kept
 *  for the landing page so the two never disagree. */
export const SITE_TITLE = 'Space Learn'

/** `"Notes"` → `"Notes · Space Learn"`; several parts read most specific first. */
export function pageTitle(...parts: (string | null | undefined)[]): string {
  return [...parts.filter(Boolean), SITE_TITLE].join(' · ')
}

/** Pages at a fixed address. `null` is the site's own title. */
const FIXED: Record<string, string | null> = {
  '/': null,
  '/welcome': null,
  // The trust pages are the landing page with a card over it; the card names
  // the tab itself while it is up (features/trust).
  '/about': null,
  '/privacy': null,
  '/terms': null,
  '/contact': null,
  '/feedback': null,
  // Deliberately unnamed: this address is linked from nowhere.
  [`/${ADMIN_PATH}`]: null,
  '/signin': 'Sign in',
  '/signup': 'Sign up',
  '/auth/callback': 'Signing in',
  '/auth/reset-password': 'Reset password',
  '/welcome-aboard': 'Welcome',
  '/home': 'Home',
  '/profile': 'Profile',
  '/settings': 'Settings',
  '/notes': 'Notes',
  '/flashcards': 'Cards',
  '/quizzes': 'Quizzes',
  '/skills': 'Skills',
}

/** The screens inside a topic, by their last path segment. Chat is the topic
 *  itself, so it adds nothing. */
const TOPIC_SECTIONS: Record<string, string | null> = {
  chat: null,
  docs: 'Sources',
  notes: 'Notes',
  flashcards: 'Cards',
  quizzes: 'Quizzes',
  skills: 'Skills',
}

const segmentsOf = (pathname: string) => pathname.split('/').filter(Boolean)

/**
 * The section of a topic an address points at, when the address has a topic's
 * shape — `/<subject>/<topic>[/<section>]`, or the same behind the old `/s/`.
 * `undefined` when it is not a topic address at all. Must agree with the
 * topic routes in `App.tsx`.
 */
export function topicSectionTitle(pathname: string): string | null | undefined {
  let parts = segmentsOf(pathname)
  if (parts[0] === 's' && parts.length >= 3) parts = parts.slice(1)
  if (parts.length === 2) return null
  if (parts.length === 3 && parts[2] in TOPIC_SECTIONS) return TOPIC_SECTIONS[parts[2]]
  return undefined
}

/**
 * The title for an address, as far as the address alone can say:
 *   - a string: that page's name;
 *   - `null`: the site's own title (the landing page);
 *   - `undefined`: a topic address — its name comes from the subject list,
 *     so `TopicCanonical` titles it and nothing here should.
 */
export function titleForPath(pathname: string): string | null | undefined {
  const path = `/${segmentsOf(pathname).join('/')}`
  if (path in FIXED) return FIXED[path]
  if (topicSectionTitle(path) !== undefined) return undefined
  return 'Page not found'
}

/** Sets the tab title. `null` restores the site's own; `undefined` leaves it be. */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (title === undefined) return
    document.title = title === null ? SITE_TITLE : pageTitle(title)
  }, [title])
}
