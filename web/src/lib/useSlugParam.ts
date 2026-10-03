import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { slugsFor } from './slug'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** True for a canonical UUID — how an id is told apart from a readable name. */
export const isUuid = (value: string): boolean => UUID.test(value)

export type SlugParam = {
  /** The id the parameter names, or null (none, still loading, or no such item). */
  id: string | null
  /** The raw value in the URL, whatever it is. */
  raw: string | null
  /** A readable value is in the URL but the list that gives it meaning hasn't loaded. */
  pending: boolean
  /** The URL names something that isn't in the loaded list. */
  missing: boolean
  /** What to write to the URL for `id`: its readable slug when known, else the id. */
  slugFor: (id: string) => string
}

/**
 * A query parameter that names one item — `?q=` a quiz, `?n=` a note,
 * `?deck=` a deck — written as the item's name instead of its id:
 * `?q=variables-basics`, not `?q=6c114e4a-d302-…`.
 *
 * - Reads either form. An id still resolves (old bookmarks, links the server or
 *   an agent builds), and is rewritten in place to the readable one once the
 *   list is loaded, so no code that builds such a link has to change.
 * - An id is usable immediately; a name needs the list, so `pending` is true
 *   until `items` arrives. A name that matches nothing is dropped from the URL.
 * - A list that disappears for a moment (the caches are cleared after every
 *   write) does not un-resolve what was already resolved, so an open quiz is
 *   never swapped for a spinner mid-way.
 * - Names change (a note's title is edited as you type). When the value in the
 *   URL is exactly what this hook last resolved, the item is followed to its new
 *   name instead of being lost.
 *
 * `settled` is false while `items` may still be a stale copy being refreshed (a
 * cached list). A name that isn't found then is treated as "not yet" rather than
 * "no such item", so a link is never dropped just because the cache was old.
 *
 * `nameOf` and `fallback` must be stable (a module-level function and
 * constant): the slug table is rebuilt only when `items` changes.
 */
export function useSlugParam<T extends { id: string }>(
  key: string,
  items: readonly T[] | null | undefined,
  nameOf: (item: T) => string | null | undefined,
  fallback: string,
  settled = true,
): SlugParam {
  const [params, setParams] = useSearchParams()
  const raw = params.get(key)
  const seen = useRef<{ raw: string; id: string } | null>(null)

  const table = useMemo(() => {
    if (!items) return null
    const byId = slugsFor(items, nameOf, fallback)
    const bySlug = new Map<string, string>()
    for (const [id, slug] of byId) bySlug.set(slug, id)
    return { byId, bySlug }
  }, [items, nameOf, fallback])

  let id: string | null = null
  let missing = false
  let waiting = false
  if (raw) {
    if (!table) {
      // No list right now — not yet loaded, or just invalidated by a write (a
      // submitted quiz clears its list while the results are still on screen).
      // What this hook last resolved this very value to is still the answer.
      id = UUID.test(raw) ? raw : seen.current?.raw === raw ? seen.current.id : null
    } else if (table.byId.has(raw)) {
      id = raw
    } else if (table.bySlug.has(raw)) {
      id = table.bySlug.get(raw)!
    } else if (seen.current?.raw === raw && table.byId.has(seen.current.id)) {
      id = seen.current.id // renamed since the URL was written
    } else if (UUID.test(raw)) {
      id = raw // not in the list (deleted, or past its window) — let the page say so
    } else if (settled) {
      missing = true
    } else {
      waiting = true
    }
  }

  const slug = id && table ? table.byId.get(id) : undefined
  useEffect(() => {
    if (!raw) return
    if (missing) {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete(key)
          return next
        },
        { replace: true },
      )
      return
    }
    if (id) seen.current = { raw: slug ?? raw, id }
    if (slug && slug !== raw) {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set(key, slug)
          return next
        },
        { replace: true },
      )
    }
  }, [raw, id, slug, missing, key, setParams])

  const slugFor = useCallback((value: string) => table?.byId.get(value) ?? value, [table])

  return { id, raw, pending: !!raw && !id && (!table || waiting), missing, slugFor }
}
