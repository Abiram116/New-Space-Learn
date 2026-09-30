import { getBrief, getStats } from '../api/me'
import type { Brief, Stats } from '../api/types'
import { invalidate as dropAsync, writeCache } from './asyncCache'
import { HOME_BRIEF_KEY, HOME_STATS_KEY } from './homeKeys'
import { onProgress } from './progressEvents'
import { createSessionCache } from './sessionCache'

/**
 * How Home's message stays both instant and current.
 *
 * The brief used to be held for the session (30 minutes), on the grounds that a
 * model-written line changing on every visit made the app feel unstable. That
 * traded one problem for a worse one: finish a quiz, walk back to Home, and it
 * still described the student from before it. The server now only rewrites the
 * line when the facts behind it change (its cache key is a hash of them), so
 * asking again is cheap and a changed answer always means something changed.
 * That lets this be stale-while-revalidate instead:
 *
 *   - A value is shown from cache immediately, never behind a spinner.
 *   - Anything the student does that moves progress marks it out of date
 *     (`onProgress`, fed by `api/client` for every write). Home then waits
 *     briefly for the fresh line and falls back to the old one rather than
 *     blocking on a slow backend.
 *   - Left alone it is refreshed in the background once it is a minute old, on
 *     Home mount and when the tab comes back into focus, and expires outright
 *     after a few minutes.
 */
const STALE_WAIT_MS = 1500
const REVALIDATE_AFTER_MS = 60_000

const briefStore = createSessionCache<Brief>({
  // v3: the shape is unchanged but the freshness rules are not; drops anything
  // an older build held for half an hour.
  key: 'sl:brief:v3',
  ttlMs: 3 * 60 * 1000,
  revalidateAfterMs: REVALIDATE_AFTER_MS,
  staleWaitMs: STALE_WAIT_MS,
  fetcher: getBrief,
  isValid: (b) => Boolean(b?.headline),
  onUpdate: (b) => writeCache(HOME_BRIEF_KEY, b),
})

/**
 * Stats are real counts rather than model output, so the concern is
 * staleness, not instability. Anything that changes them (grading a card,
 * submitting a quiz) marks them out of date via `onProgress`, or clears them
 * outright via `clearStatsCache`.
 */
const statsStore = createSessionCache<Stats>({
  // BUMP THIS WHENEVER `StatsOut` GAINS A FIELD. This cache persists in
  // sessionStorage across reloads, so after the API grew `due_forecast`,
  // `composition` and `daily_goal`, every existing session kept being served
  // the OLD shape — and Home crashed reading `.map` off an absent array.
  // The version in the key is the only thing that invalidates it.
  key: 'sl:stats:v3',
  ttlMs: 3 * 60 * 1000,
  revalidateAfterMs: 30_000,
  staleWaitMs: STALE_WAIT_MS,
  fetcher: getStats,
  // Validate the fields the UI actually depends on, not just any one of them.
  // `badges` alone happily accepted a payload from a previous deploy.
  isValid: (s) =>
    Array.isArray(s?.badges) &&
    Array.isArray(s?.due_forecast) &&
    Boolean(s?.composition),
  onUpdate: (s) => writeCache(HOME_STATS_KEY, s),
})

export const getCachedBrief = briefStore.get
export const getCachedStats = statsStore.get

/** Call after an action that changes counts, so Home doesn't show stale numbers. */
export const clearStatsCache = statsStore.clear

/**
 * Mark the brief and stats out of date. Keeps the last values for instant
 * display; the next read (or a background refresh, if Home is open) replaces
 * them. Called for you on every successful write through `api/client` — call it
 * directly only for a change that does not go through the API.
 */
export function invalidateBrief(): void {
  briefStore.invalidate()
  statsStore.invalidate()
  scheduleHomeRefresh()
}

/** The brief cache as one object, for callers that want to say what they mean. */
export const briefCache = {
  get: briefStore.get,
  invalidate: invalidateBrief,
  clear: clearBriefCache,
}

/** Drop everything cached — call after sign-out so the next user gets their own. */
export function clearBriefCache() {
  briefStore.clear()
  statsStore.clear()
  dropAsync(HOME_BRIEF_KEY)
  dropAsync(HOME_STATS_KEY)
}

// ── Keeping an open Home current ───────────────────────────────────────
//
// Only relevant while Home is the screen in front of the student: elsewhere the
// next visit refetches anyway, and refreshing on every tab focus from inside a
// chat would spend a model call on a page nobody is looking at.

const HOME_PATH = '/home'

function homeIsVisible(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible' &&
    window.location.pathname.startsWith(HOME_PATH)
  )
}

function refreshOpenHome(olderThanMs: number): void {
  if (!homeIsVisible()) return
  briefStore.revalidateIfOlderThan(olderThanMs)
  statsStore.revalidateIfOlderThan(olderThanMs)
}

// A burst of writes (a review session grading cards, a note autosaving) asks
// once, after it goes quiet, rather than once per write.
const HOME_REFRESH_DEBOUNCE_MS = 1500
let refreshTimer: ReturnType<typeof setTimeout> | undefined

function scheduleHomeRefresh(): void {
  if (typeof window === 'undefined') return
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => refreshOpenHome(0), HOME_REFRESH_DEBOUNCE_MS)
}

onProgress(invalidateBrief)

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const onReturn = () => refreshOpenHome(REVALIDATE_AFTER_MS)
  document.addEventListener('visibilitychange', onReturn)
  window.addEventListener('focus', onReturn)
}
