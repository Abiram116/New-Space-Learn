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
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { friendlyMessage } from '../api/errors'
import { readCache, subscribe, writeCache } from './asyncCache'

export type AsyncState<T> = {
  data: T | null
  error: string | null
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
): AsyncState<T> {
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
  const [validating, setValidating] = useState(true)
  const [tick, setTick] = useState(0)
  const generation = useRef(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  // Cache first: it is what makes the first paint real. `local` only carries
  // results for un-keyed callers.
  const data = (cached as T | undefined) ?? local

  // Tracks the last value this hook actually rendered, kept in sync with
  // `data` on every render — see `updateData` below for why `setData`
  // needs this rather than reading straight from the cache at call time.
  const dataRef = useRef<T | null>(null)
  dataRef.current = data ?? null

  useEffect(() => {
    const gen = ++generation.current
    setValidating(true)
    setError(null)
    fnRef.current()
      .then((result) => {
        if (gen !== generation.current) return
        if (key) writeCache(key, result)
        else setLocal(result)
        setValidating(false)
      })
      .catch((err) => {
        if (gen !== generation.current) return
        setError(friendlyMessage(err))
        setValidating(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, key, ...deps])

  const refresh = useCallback(() => setTick((t) => t + 1), [])

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
    // Only a *first* load is "loading". A revalidation over content already on
    // screen must not put a skeleton back over it — that would reintroduce the
    // exact flash this exists to remove.
    loading: (data ?? null) === null && validating,
    validating,
    refresh,
    setData: updateData,
  }
}
