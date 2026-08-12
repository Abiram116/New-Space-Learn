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
 * Drop cached entries after a mutation.
 *
 * Prefix-matched, because the keys are namespaced (`notes:<subspace>`), and a
 * mutation usually invalidates a family rather than one exact request. Callers
 * pass the family: creating a note invalidates `notes:`, not every key in the
 * app.
 *
 * Listeners are notified so a mounted screen refetches rather than sitting on
 * data it has just been told is wrong.
 */
export function invalidate(prefix: string): void {
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) {
      store.delete(key)
      listeners.get(key)?.forEach((fn) => fn())
    }
  }
}

/** Everything, for sign-out — the next account must not inherit this one's data. */
export function clearCache(): void {
  store.clear()
  listeners.forEach((set) => set.forEach((fn) => fn()))
}
