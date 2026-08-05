/**
 * A tiny session-scoped, TTL'd, request-deduplicating cache.
 *
 * Two things it buys us, both of which were real bugs before:
 *   - Navigating Cards → Home → Notes → Home refetched everything on every
 *     trip, so the page flashed skeletons each time it was revisited.
 *   - Two components mounting together fired two identical requests; the
 *     shared in-flight promise collapses those into one.
 *
 * `sessionStorage` (not `local`) is the right lifetime: a new tab or a fresh
 * visit is genuinely a new arrival, while moving around inside one visit is
 * not. A malformed or unavailable store is never worth failing a page over,
 * so every storage access degrades to "just refetch".
 */

type Entry<T> = { at: number; value: T }

export type SessionCache<T> = {
  get: () => Promise<T>
  clear: () => void
}

export function createSessionCache<T>(options: {
  key: string
  ttlMs: number
  fetcher: () => Promise<T>
  /** Guards against a stale shape cached by an older build. */
  isValid?: (value: T) => boolean
}): SessionCache<T> {
  const { key, ttlMs, fetcher, isValid } = options
  let memory: Entry<T> | null = null
  let inflight: Promise<T> | null = null

  const fresh = (e: Entry<T> | null): e is Entry<T> =>
    e !== null && Date.now() - e.at <= ttlMs

  function read(): Entry<T> | null {
    try {
      const raw = sessionStorage.getItem(key)
      if (!raw) return null
      const parsed = JSON.parse(raw) as Entry<T>
      if (!parsed || typeof parsed.at !== 'number') return null
      if (isValid && !isValid(parsed.value)) return null
      return fresh(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  return {
    get() {
      if (!fresh(memory)) memory = read()
      if (fresh(memory)) return Promise.resolve(memory.value)
      if (inflight) return inflight

      inflight = fetcher()
        .then((value) => {
          memory = { at: Date.now(), value }
          try {
            sessionStorage.setItem(key, JSON.stringify(memory))
          } catch {
            /* private mode / quota — the memory cache still applies */
          }
          return value
        })
        .finally(() => {
          inflight = null
        })

      return inflight
    },
    clear() {
      memory = null
      inflight = null
      try {
        sessionStorage.removeItem(key)
      } catch {
        /* ignore */
      }
    },
  }
}
