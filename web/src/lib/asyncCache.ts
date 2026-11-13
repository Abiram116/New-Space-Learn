/**
 * A tiny stale-while-revalidate store behind `useAsync`.
 *
 * **The problem it solves.** Every screen fetched on mount starting from
 * `data: null, loading: true`, which means the app discarded everything it
 * already knew each time you navigated. Open Notes, go to Cards, come back —
 * the notes list you were looking at two seconds ago was gone, replaced by a
 * skeleton while an identical request went out again. That is the split-second
 * flash on every page switch, and it is not network latency: the data was
 * already in the tab, just not kept anywhere.
 *
 * So a keyed entry is served **synchronously on mount** — first paint has real
 * content, no skeleton — and a revalidation runs behind it. The screen only
 * shows a loading state the first time it has genuinely never seen the data.
 *
 * **Why not a library.** SWR and React Query both do this and more, but both
 * are a dependency on the critical path of a 512MB free-tier build for
 * behaviour that is ~60 lines here. The parts we would use are the parts
 * written below; the rest is bundle.
 *
 * Deliberately in-memory only. A tab reload should re-fetch: `localStorage`
 * caching is how you end up showing a note someone deleted on another device,
 * and the brief cache already learned that lesson the hard way.
 */

type Entry = { data: unknown; at: number }

const store = new Map<string, Entry>()
const listeners = new Map<string, Set<() => void>>()
/** Requests in flight, by key, so two screens asking at once share one. */
const inflight = new Map<string, Promise<unknown>>()

/**
 * Bumped by `clearCache` (sign-out). `useAsync` keeps showing a screen's last
 * data after an `invalidate` until its next fetch lands — but never across a
 * clear, so one account's data cannot linger on screen for the next.
 */
let epoch = 0
export const cacheEpoch = (): number => epoch

/** Cap on retained keys — a study session can visit a lot of subspaces. */
const MAX_ENTRIES = 120

export function readCache<T>(key: string): { data: T; at: number } | undefined {
  const hit = store.get(key)
  return hit ? { data: hit.data as T, at: hit.at } : undefined
}

export function writeCache(key: string, data: unknown): void {
  if (store.size >= MAX_ENTRIES && !store.has(key)) {
    // Oldest insertion first. A Map preserves insertion order, so the first
    // key is the least recently *written* — good enough, and far cheaper than
    // tracking real LRU for a cache this size.
    const oldest = store.keys().next().value
    if (oldest !== undefined) store.delete(oldest)
  }
  store.set(key, { data, at: Date.now() })
  listeners.get(key)?.forEach((fn) => fn())
}

export function subscribe(key: string, fn: () => void): () => void {
  let set = listeners.get(key)
  if (!set) {
    set = new Set()
    listeners.set(key, set)
  }
  set.add(fn)
  return () => {
    set!.delete(fn)
    if (set!.size === 0) listeners.delete(key)
  }
}

/**
 * One request per key at a time: a caller arriving while the same request is
 * in flight gets that promise instead of starting a second one. On a free-tier
 * API the duplicate is pure cost (Home and Today, say, both mounting
 * `quizzes:all`).
 */
export function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const running = inflight.get(key)
  if (running) return running as Promise<T>
  const p: Promise<T> = fn().finally(() => {
    if (inflight.get(key) === p) inflight.delete(key)
  })
  inflight.set(key, p)
  return p
}

/**
 * Drop cached entries after a mutation.
 *
 * Prefix-matched, because the keys are namespaced (`notes:<subspace>`), and a
 * mutation usually invalidates a family rather than one exact request. Callers
 * pass the family: creating a note invalidates `notes:`, not every key in the
 * app.
 *
 * Listeners are notified, and a mounted screen keeps what it is showing until
 * its own next fetch replaces it (`useAsync`) — it does not refetch by itself.
 * That is deliberate: a review session invalidates `decks:` on every graded
 * card, and a list nobody is looking at must not cost a request per card. The
 * flows that return to a list call `refresh()` on the way back.
 *
 * A request already in flight for the family is forgotten too, so a refresh
 * after the mutation cannot be handed the pre-mutation answer.
 */
export function invalidate(prefix: string): void {
  for (const key of [...inflight.keys()]) if (key.startsWith(prefix)) inflight.delete(key)
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) {
      store.delete(key)
      listeners.get(key)?.forEach((fn) => fn())
    }
  }
}

const clearHooks = new Set<() => void>()

/** For other per-account stores (not keyed entries) to be dropped with this one at sign-out. */
export function onCleared(fn: () => void): void {
  clearHooks.add(fn)
}

/** Everything, for sign-out — the next account must not inherit this one's data. */
export function clearCache(): void {
  clearHooks.forEach((fn) => fn())
  epoch++
  inflight.clear()
  store.clear()
  listeners.forEach((set) => set.forEach((fn) => fn()))
}
