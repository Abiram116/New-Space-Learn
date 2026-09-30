/**
 * "The student just did something that changes where they stand."
 *
 * Home's message and stats are computed from progress — cards graded, quizzes
 * taken, material added, goals changed — so they go out of date the moment the
 * student does any of it. Making each screen remember to clear the right cache
 * is how a page ends up describing yesterday; this puts the knowledge where
 * every write already passes: `api/client.ts` reports each successful write
 * here, and anything that shows progress subscribes once.
 *
 * Dependency-free on purpose. `api/client` must be able to import this without
 * pulling in the caches (which import the API), so the two never form a cycle.
 */

const listeners = new Set<() => void>()

/** Subscribe to progress changes. Returns the unsubscribe function. */
export function onProgress(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Something progress-relevant happened. Cheap and safe to call often: it only
 *  tells subscribers to mark their data out of date, it fetches nothing. */
export function notifyProgress(): void {
  for (const fn of [...listeners]) {
    try {
      fn()
    } catch {
      /* one subscriber failing must not stop the others */
    }
  }
}

/**
 * Writes that change progress, by method and route.
 *
 * Matched on the route rather than listed at each call site so a mutation
 * added later is covered without anyone having heard of this. Reads, and
 * writes that change nothing the brief or stats see (`/notes/ai-inline`,
 * feedback, skills), are deliberately absent.
 */
const PROGRESS_WRITES: { method: string; path: RegExp }[] = [
  // Study activity
  { method: 'POST', path: /^\/quizzes\/[^/]+\/submit$/ },
  { method: 'POST', path: /^\/cards\/[^/]+\/grade$/ },
  // Material generated or added
  { method: 'POST', path: /^\/subspaces\/[^/]+\/(quiz|cards|notes)\/generate$/ },
  { method: 'POST', path: /^\/subspaces\/[^/]+\/(notes|decks|documents)$/ },
  { method: 'POST', path: /^\/decks\/[^/]+\/cards$/ },
  { method: 'POST', path: /^\/documents\/[^/]+\/reprocess$/ },
  // Removed, or renamed (the brief names topics)
  { method: 'DELETE', path: /^\/(notes|decks|cards|documents|spaces|subspaces)\/[^/]+$/ },
  { method: 'POST', path: /^\/spaces(\/[^/]+\/subspaces)?$/ },
  { method: 'PATCH', path: /^\/(spaces|subspaces)\/[^/]+$/ },
  // The goal, the streak freeze, the student's own description of themselves
  { method: 'PATCH', path: /^\/me\/(settings|student-model)$/ },
]

/** A note is edited constantly while it is written; only a change to what it
 *  says counts, not a flag such as `ai_touched`. */
const NOTE_EDIT = /^\/notes\/[^/]+$/

export function isProgressWrite(method: string, path: string, body?: unknown): boolean {
  const m = method.toUpperCase()
  const p = path.split('?')[0]
  if (m === 'PATCH' && NOTE_EDIT.test(p)) {
    const b = (body ?? {}) as Record<string, unknown>
    return typeof b.body_md === 'string' || typeof b.title === 'string'
  }
  return PROGRESS_WRITES.some((r) => r.method === m && r.path.test(p))
}

/** Called by the API client after every successful write. */
export function notifyIfProgress(method: string, path: string, body?: unknown): void {
  if (isProgressWrite(method, path, body)) notifyProgress()
}
