/**
 * Start the next screen's work before it is asked for.
 *
 * `routes/lazyRoutes` already downloads every screen's code once the app is idle.
 * What was still left to the click was everything after the code: the request for
 * the screen's own data, and on a deep link the round trip for `/spaces` that has
 * to answer before a topic's id is even known. Both are cheap to start early and
 * wasted at worst — a request the student then does not use.
 *
 * Three triggers, all best-effort and none of them an error when they fail:
 *
 *   intent    A pointer rests on a link for a moment (or a finger lands on one,
 *             or it takes keyboard focus). The click is usually 100-300 ms away,
 *             which is about one round trip to this API.
 *   deep link On load, when the address is a topic the tab has seen before, its
 *             history and files are requested alongside `/spaces` instead of after.
 *   (idle)    Not here: warming data for screens nobody pointed at would cost the
 *             free-tier API real CPU on every visit, for no student.
 *
 * Data goes where the screens already look for it: the keyed `asyncCache` entries
 * their `useAsync` reads on mount (so the first paint has content), or, for the
 * history, the primed request `api/chat.listMessages` hands over.
 */

import { prefetchMessages } from '../api/chat'
import { hasAuthToken } from '../api/client'
import { listAllDecks } from '../api/flashcards'
import { getStudentModel } from '../api/me'
import { listDocuments } from '../api/documents'
import { listAllNotes } from '../api/notes'
import { listAllQuizzes } from '../api/quizzes'
import { dedupe, readCache, writeCache } from './asyncCache'
import { knownSpaces } from './knownSpaces'
import { RESERVED_ROOTS, withSlugs } from './slug'
import { isMobileNow } from './useIsMobile'

/** Once a path has been prepared, leave it alone for this long. */
const REPEAT_MS = 30_000

const recently = new Map<string, number>()

function shouldSkipForData(): boolean {
  // A student who asked the browser to save data, or is on a slow link, gets
  // nothing speculative: the code prefetch is already as much as they signed up for.
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection
  return Boolean(conn?.saveData) || conn?.effectiveType === 'slow-2g' || conn?.effectiveType === '2g'
}

/** Fetch into the `useAsync` cache entry `key`, unless something is already there. */
function warm<T>(key: string, fetcher: () => Promise<T>): void {
  if (readCache(key)) return
  dedupe(key, fetcher)
    .then((data) => {
      // Another writer (the screen itself) may have landed first; theirs is as fresh.
      if (!readCache(key)) writeCache(key, data)
    })
    .catch(() => {
      /* a head start that failed is not an error */
    })
}

type Topic = { id: string }

/** The topic a `/<subject>/<topic>` address names, from what this tab has seen. */
function topicFor(segments: string[]): Topic | null {
  const [spaceSeg, topicSeg] = segments
  if (!spaceSeg || !topicSeg || RESERVED_ROOTS.has(spaceSeg)) return null
  const spaces = withSlugs(knownSpaces())
  const space = spaces.find((s) => s.id === spaceSeg) ?? spaces.find((s) => s.slug === spaceSeg)
  const topic =
    space?.subspaces.find((t) => t.id === topicSeg) ??
    space?.subspaces.find((t) => t.slug === topicSeg)
  return topic ? { id: topic.id } : null
}

/** Code and data for the screen at `path`. Only ever starts work; never waits. */
export function prepare(path: string): void {
  const segments = path.split('?')[0].split('#')[0].split('/').filter(Boolean)
  const head = segments[0]
  if (!head) return
  const mobile = isMobileNow()

  if (head === 'flashcards') {
    void import('../features/flashcards/FlashcardsView')
    warm('decks:all', listAllDecks)
  } else if (head === 'quizzes') {
    void import('../features/quizzes/QuizzesView')
    warm('quizzes:all', listAllQuizzes)
  } else if (head === 'notes') {
    void import('../features/notes/NotesView')
    warm('notes:all', listAllNotes)
  } else if (head === 'profile') {
    void import('../features/profile/Profile')
    warm('student-model', getStudentModel)
  } else if (head === 'settings') {
    void import('../features/settings/Settings')
  } else if (head === 'skills') {
    void import('../features/skills/SkillsView')
  } else if (head === 's') {
    // The old `/s/<subject>/<topic>` form of a topic address.
    prepare('/' + segments.slice(1).join('/'))
  } else {
    prepareTopic(segments, mobile)
  }
}

function prepareTopic(segments: string[], mobile: boolean): void {
  const topic = topicFor(segments)
  if (!topic) return
  const screen = segments[2]
  if (!screen) {
    if (mobile) {
      void import('../features/mobile/TopicHub')
      warm('decks:all', listAllDecks)
    } else {
      void import('../features/chat/ChatView')
      prefetchMessages(topic.id)
      warm(`docs:${topic.id}`, () => listDocuments(topic.id))
    }
  } else if (screen === 'docs') {
    void import('../features/docs/DocsView')
    warm(`docs:${topic.id}`, () => listDocuments(topic.id))
  } else if (screen === 'flashcards') {
    void import('../features/flashcards/FlashcardsView')
    warm('decks:all', listAllDecks)
  } else if (screen === 'quizzes') {
    void import('../features/quizzes/QuizzesView')
    warm('quizzes:all', listAllQuizzes)
  } else if (screen === 'notes') {
    void import('../features/notes/NotesView')
    warm('notes:all', listAllNotes)
  }
}

/** A link is about to be followed: prepare its screen unless it just was, or data is scarce. */
export function intended(path: string): void {
  if (!hasAuthToken() || shouldSkipForData()) return
  const now = Date.now()
  const last = recently.get(path)
  if (last !== undefined && now - last < REPEAT_MS) return
  if (recently.size > 200) recently.clear()
  recently.set(path, now)
  prepare(path)
}

/** The address of the screen already open, as a deep link (see `prefetchTrigger`). */
export function prepareCurrent(path: string): void {
  if (shouldSkipForData()) return
  const segments = path.split('/').filter(Boolean)
  if (segments[0] === 's') segments.shift()
  if (segments.length >= 2 || ['flashcards', 'quizzes', 'notes', 'profile'].includes(segments[0])) {
    recently.set(path, Date.now())
    prepare(path)
  }
}
