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
 *
 * **Stale-while-revalidate (opt-in).** A plain TTL forces a choice between
 * showing old data and blocking on a request. Three optional knobs give the
 * third option, which is what a page that must stay current AND render
 * instantly wants:
 *   - `revalidateAfterMs` — a hit older than this is still served at once, and
 *     refetched behind it so the NEXT read is fresh.
 *   - `invalidate()` — "something changed": keeps the last value but marks it
 *     out of date, so it is never trusted as current (unlike `clear()`, which
 *     forgets it).
 *   - `staleWaitMs` — for an out-of-date entry, wait at most this long for the
 *     fresh value, then fall back to the old one. A backend that is down or
 *     cold-starting therefore costs a short wait, not an error.
 * With none of them set this behaves exactly as it always has.
 */

type Entry<T> = { at: number; value: T; stale?: boolean }

export type SessionCache<T> = {
  get: () => Promise<T>
  clear: () => void
  /** The student changed something this depends on. Keeps the last value for
   *  instant display but stops it counting as current; any request already in
   *  flight was asked before the change, so its answer is not stored. */
  invalidate: () => void
  /** Refetch in the background if there is a cached value that is out of date
   *  or older than `ms`. Does nothing without one — never starts a first load. */
  revalidateIfOlderThan: (ms: number) => void
  /** The cached value, however old, without fetching. */
  peek: () => T | undefined
}

const noop = () => {}

export function createSessionCache<T>(options: {
  key: string
  ttlMs: number
  fetcher: () => Promise<T>
  /** Guards against a stale shape cached by an older build. */
  isValid?: (value: T) => boolean
  revalidateAfterMs?: number
  staleWaitMs?: number
  /** Called with every value a fetch stores, so a mirror of this cache (an
   *  `asyncCache` key a mounted screen subscribes to) can follow it. */
  onUpdate?: (value: T) => void
}): SessionCache<T> {
  const { key, ttlMs, fetcher, isValid, revalidateAfterMs, staleWaitMs, onUpdate } = options
  let memory: Entry<T> | null = null
  let inflight: Promise<T> | null = null
  // Bumped by anything that makes an in-flight answer untrustworthy
  // (`invalidate`, `clear`): a response that lands after one is not stored, or
  // a sign-out could be followed by the previous account's data reappearing.
  let epoch = 0

  const age = (e: Entry<T>) => Date.now() - e.at
  const expired = (e: Entry<T>) => e.stale === true || age(e) > ttlMs

  function read(): Entry<T> | null {
    try {
      const raw = sessionStorage.getItem(key)
      if (!raw) return null
      const parsed = JSON.parse(raw) as Entry<T>
      if (!parsed || typeof parsed.at !== 'number') return null
      if (isValid && !isValid(parsed.value)) return null
      return parsed
    } catch {
      return null
    }
  }

  function load(): Entry<T> | null {
    if (!memory) memory = read()
    return memory
  }

  function persist(): void {
    try {
      sessionStorage.setItem(key, JSON.stringify(memory))
    } catch {
      /* private mode / quota — the memory cache still applies */
    }
  }

  function revalidate(): Promise<T> {
    if (inflight) return inflight
    const started = epoch
    const p: Promise<T> = fetcher()
      .then((value) => {
        if (started === epoch) {
          memory = { at: Date.now(), value }
          persist()
          onUpdate?.(value)
        }
        return value
      })
      .finally(() => {
        if (inflight === p) inflight = null
      })
    inflight = p
    return p
  }

  return {
    get() {
      const e = load()
      if (e && !expired(e)) {
        if (revalidateAfterMs !== undefined && age(e) > revalidateAfterMs) {
          revalidate().catch(noop)
        }
        return Promise.resolve(e.value)
      }

      const p = revalidate()
      if (!e || staleWaitMs === undefined) return p

      // Out of date, but we do have something to show: give the refetch a
      // moment, then settle for what we have rather than block the page.
      return new Promise<T>((resolve) => {
        const timer = setTimeout(() => resolve(e.value), staleWaitMs)
        p.then(
          (value) => {
            clearTimeout(timer)
            resolve(value)
          },
          () => {
            clearTimeout(timer)
            resolve(e.value)
          },
        )
      })
    },
    clear() {
      memory = null
      inflight = null
      epoch++
      try {
        sessionStorage.removeItem(key)
      } catch {
        /* ignore */
      }
    },
    invalidate() {
      epoch++
      inflight = null
      const e = load()
      if (e) {
        memory = { ...e, stale: true }
        persist()
      }
    },
    revalidateIfOlderThan(ms) {
      const e = load()
      if (e && (expired(e) || age(e) > ms)) revalidate().catch(noop)
    },
    peek() {
      return load()?.value
    },
  }
}
