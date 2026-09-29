/**
 * The one signal that crosses from "the backend just came back" to
 * "screens that gave up should try again."
 *
 * `OfflineBanner` is the only thing polling `/ready`, but it isn't the only
 * thing that cares when the answer flips from unreachable to healthy: a
 * screen whose `useAsync` load failed while the API was down is still
 * sitting on a dead error card with nothing to make it try again except the
 * student manually hitting Retry. `useAsync` subscribes here and re-runs
 * itself automatically the moment reconnection happens — but only when it
 * currently holds an error, never on a successful load, so this cannot
 * cause an unrelated refetch storm the instant the banner clears.
 *
 * A plain module-level pub-sub, not a context: `OfflineBanner` fires this
 * from wherever it's mounted, and any hook anywhere (inside or outside that
 * subtree) can listen, with no provider wiring either side needs to share.
 */

type Listener = () => void

const listeners = new Set<Listener>()

/** Subscribe to "the backend just became reachable and ready again."
 *  Returns the unsubscribe function, so a `useEffect` can return it directly. */
export function onBackendReady(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Called by `OfflineBanner` on the online→ready transition only — never on
 *  every successful poll, or every screen watching this would refetch on a
 *  15-second heartbeat. */
export function notifyBackendReady(): void {
  listeners.forEach((fn) => fn())
}
