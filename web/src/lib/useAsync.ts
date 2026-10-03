/**
 * `useAsync` — one hook, three states we always need: `loading | error | data`.
 *
 * Refuses stale updates when the input changes mid-request (last-write-wins).
 * Any thrown value is normalized via `friendlyMessage` so the state's `error`
 * is always a printable string. Callers can also call `refresh()` explicitly.
 *
 * **Pass a `key` and it stops flashing.** Without one this fetches from scratch
 * on every mount, so navigating away and back discards data the tab already has
 * and replaces it with a skeleton while an identical request goes out — the
 * split-second blank on every page switch. With a key, a cached result is
 * served on the first render and revalidated behind it, so a screen only shows
 * a loading state the first time it has genuinely never had the data.
 *
 * The key must describe the *request*, not the screen: two components asking
 * for the same thing should share an entry, and one component asking about two
 * different subspaces must not.
 *
 * ## What a screen gets, and what to do with it
 *
 * The returned `AsyncResult<T>` is deliberately more than `{data, loading}` —
 * this is the shape the resilience work (cold starts, flaky upstream, 429s
 * from the AI — see `AsyncState.tsx`) is built on, so a screen reading
 * through this hook already has what it needs without a second round of
 * plumbing:
 *
 *   - `loading` — true only for a *first* load (no cached or local data yet).
 *     Feed this into `useSlowState` (`./useSlowState.ts`) to turn a plain
 *     spinner into "waking up the server" / "still trying" copy once the
 *     wait crosses a few seconds — `AsyncState.tsx` already does this for a
 *     screen that renders one resource in its own region; Home/Profile call
 *     `useSlowState` directly instead, to slot the same copy into a bespoke,
 *     multi-resource layout that wrapper doesn't fit.
 *   - `validating` — true whenever a fetch is in flight *behind* data already
 *     on screen (a first load or a background revalidation — check `data`
 *     first if only the latter matters to you). Render a small, unobtrusive
 *     indicator, never a skeleton — the cache's whole point is that a revisit
 *     doesn't go blank.
 *   - `error` — set on a failed fetch. If `data` is still present, this is a
 *     failed *background* revalidation: the stale data is deliberately kept
 *     (nothing here clears it), so show a small inline notice next to it
 *     rather than blanking the screen. If `data` is null, it's a genuine
 *     failed first load — show `error` (already a friendly sentence, see
 *     `api/errors.ts`'s `friendlyMessage`) with a way to call `refresh()`.
 *   - `refresh()` — re-runs the request. Wire it to every Retry action.
 *   - `setData()` — optimistic local edits; see its own comment below for the
 *     invalidation race it's written to survive.
 *
 * **Reconnection retries a failed load automatically.** This hook subscribes
 * to `./connectivity.ts`'s `onBackendReady` and calls its own `refresh()`
 * whenever the backend goes from unreachable back to ready *while this hook
 * currently holds an error* — a successful load is never touched by this.
 * `OfflineBanner` is what fires that signal, from its own `/ready` polling.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { classifyError, friendlyMessage, type ErrorKind } from '../api/errors'
import { cacheEpoch, dedupe, readCache, subscribe, writeCache } from './asyncCache'
import { onBackendReady } from './connectivity'

// Named `AsyncResult`, not `AsyncState` — `./AsyncState.tsx` is the wrapper
// COMPONENT the resilience work asked for by that exact name, and one file
// exporting both a type and a component called `AsyncState` is confusing to
// import from even though nothing stops it.
export type AsyncResult<T> = {
  data: T | null
  error: string | null
  /** `error`'s coarse bucket (offline / timeout / rate-limited / auth /
   *  server / other) — see `api/errors.ts`'s `classifyError`. `null`
   *  whenever `error` is, so a caller can check either together. */
  errorKind: ErrorKind | null
  loading: boolean
  /** True while a *background* revalidation runs over data already on screen. */
  validating: boolean
  refresh: () => void
  setData: (updater: (prev: T | null) => T | null) => void
}

const noopSubscribe = () => () => {}
const noSnapshot = () => undefined

export function useAsync<T>(
  fn: () => Promise<T>,
  deps: ReadonlyArray<unknown> = [],
  key?: string,
): AsyncResult<T> {
  // Subscribed rather than read once, so an `invalidate()` elsewhere reaches a
  // mounted screen instead of leaving it on data already known to be wrong.
  const subscribeToKey = useCallback(
    (cb: () => void) => (key ? subscribe(key, cb) : noopSubscribe()),
    [key],
  )
  const snapshot = useCallback(
    () => (key ? readCache<T>(key)?.data : undefined),
    [key],
  )
  const cached = useSyncExternalStore(subscribeToKey, snapshot, noSnapshot)

  const [local, setLocal] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null)
  const [validating, setValidating] = useState(true)
  const [tick, setTick] = useState(0)
  const generation = useRef(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  // Cache first: it is what makes the first paint real. `local` only carries
  // results for un-keyed callers.
  //
  // After an `invalidate` the entry is gone but the screen still has what it
  // was showing. Dropping that to `null` made every list on a page blank out
  // the moment anything was saved ("No decks yet" after a review, an empty
  // quiz list after a submit) and stay blank until something refetched. So the
  // last value is kept, for this key, until a fetch replaces it — but never
  // across `clearCache` (sign-out), which bumps the epoch.
  const lastKnown = useRef<{ key: string; epoch: number; data: T } | null>(null)
  if (key && cached !== undefined) lastKnown.current = { key, epoch: cacheEpoch(), data: cached as T }
  const kept = lastKnown.current
  const stale = key && kept && kept.key === key && kept.epoch === cacheEpoch() ? kept.data : undefined
  const data = (cached as T | undefined) ?? local ?? stale

  // Tracks the last value this hook actually rendered, kept in sync with
  // `data` on every render — see `updateData` below for why `setData`
  // needs this rather than reading straight from the cache at call time.
  const dataRef = useRef<T | null>(null)
  dataRef.current = data ?? null

  useEffect(() => {
    const gen = ++generation.current
    setValidating(true)
    setError(null)
    setErrorKind(null)
    ;(key ? dedupe(key, fnRef.current) : fnRef.current())
      .then((result) => {
        if (gen !== generation.current) return
        if (key) writeCache(key, result)
        else setLocal(result)
        setValidating(false)
      })
      .catch((err) => {
        if (gen !== generation.current) return
        setError(friendlyMessage(err))
        setErrorKind(classifyError(err))
        setValidating(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, key, ...deps])

  const refresh = useCallback(() => setTick((t) => t + 1), [])

  // Auto-retry on reconnect — but only a load that's actually dead. Reading
  // `error` through a ref (rather than depending on it) keeps this
  // subscribed exactly once per mount instead of re-subscribing on every
  // state change; `onBackendReady` only ever fires on the rare
  // unreachable→ready transition, so there's no freshness to lose by
  // checking the ref at call time instead of at subscribe time.
  const errorRef = useRef<string | null>(null)
  errorRef.current = error
  useEffect(() => onBackendReady(() => {
    if (errorRef.current) refresh()
  }), [refresh])

  const updateData = useCallback(
    (updater: (prev: T | null) => T | null) => {
      // An optimistic edit has to land in the cache, or the next mount of this
      // key serves the pre-edit value and the change appears to undo itself.
      //
      // `prev` falls back to `dataRef.current`, not just `readCache(key)?.data`
      // — a mutation that's already succeeded by the time its caller runs
      // `setData` (creating a card, deleting a deck, ...) has, by then,
      // *also* already invalidated this exact cache key (`client.ts` clears
      // it synchronously right after a successful non-GET response, before
      // the caller's own `await` even resumes). Reading the cache alone at
      // that moment sees nothing and `prev` becomes `null` — an optimistic
      // "append the new item" silently turns into "replace the whole list
      // with just the new item", and "update one item" turns into "the list
      // is now empty". `dataRef` still holds this hook's last real render —
      // untouched by the cache being cleared out from under it — so the
      // append/update/remove lands on the actual list instead of nothing.
      if (key) {
        const prev = readCache<T>(key)?.data ?? dataRef.current
        writeCache(key, updater(prev))
      } else {
        // Unaffected by the race above — no cache entry involved, and
        // passing the updater straight to `setState` lets React supply its
        // own latest `local`, which stays correct even across more than one
        // `setData` call in the same tick (unlike reading `dataRef` twice).
        setLocal(updater)
      }
    },
    [key],
  )

  return {
    data: data ?? null,
    error,
    errorKind,
    // Only a *first* load is "loading". A revalidation over content already on
    // screen must not put a skeleton back over it — that would reintroduce the
    // exact flash this exists to remove.
    loading: (data ?? null) === null && validating,
    validating,
    refresh,
    setData: updateData,
  }
}
