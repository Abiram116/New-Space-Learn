/**
 * `useAsync` — one hook, three states we always need: `loading | error | data`.
 *
 * Refuses stale updates when the input changes mid-request (last-write-wins).
 * Any thrown value is normalized via `friendlyMessage` so the state's `error`
 * is always a printable string. Callers can also call `refresh()` explicitly.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { friendlyMessage } from '../api/errors'

export type AsyncState<T> = {
  data: T | null
  error: string | null
  loading: boolean
  refresh: () => void
  setData: (updater: (prev: T | null) => T | null) => void
}

export function useAsync<T>(
  fn: () => Promise<T>,
  deps: ReadonlyArray<unknown> = [],
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [tick, setTick] = useState(0)
  const generation = useRef(0)
  // Keep the newest fn without triggering effects on every render.
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    const gen = ++generation.current
    setLoading(true)
    setError(null)
    fnRef.current()
      .then((result) => {
        if (gen !== generation.current) return
        setData(result)
        setLoading(false)
      })
      .catch((err) => {
        if (gen !== generation.current) return
        setError(friendlyMessage(err))
        setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps])

  const refresh = useCallback(() => setTick((t) => t + 1), [])

  const updateData = useCallback(
    (updater: (prev: T | null) => T | null) => setData(updater),
    [],
  )

  return { data, error, loading, refresh, setData: updateData }
}
