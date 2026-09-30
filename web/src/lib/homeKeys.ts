/**
 * The `useAsync` cache keys Home's brief and stats are mirrored under.
 *
 * Passing one as `useAsync`'s third argument makes a mounted Home follow the
 * caches live (first paint from the last known value, then swapped in place
 * when a background refresh lands). Kept apart from `briefCache` so a test that
 * mocks that module still resolves them.
 */
export const HOME_BRIEF_KEY = 'home:brief'
export const HOME_STATS_KEY = 'home:stats'
