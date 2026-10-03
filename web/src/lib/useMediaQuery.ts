import { useCallback, useSyncExternalStore } from 'react'

/** Tailwind's `lg:` — the width at which the chat sidebar exists at all. */
export const LG_QUERY = '(min-width: 1024px)'

/**
 * Whether a CSS media query currently matches, kept live.
 *
 * For STRUCTURE — which component is mounted — as opposed to styling. A `hidden`
 * or `lg:hidden` class still mounts the component, and a mounted component
 * still runs its effects and fetches: the chat page used to load the sidebar's
 * data on a phone-width window where the sidebar is `display: none`, and the
 * strip's data on a desktop where the strip is. Branching here means a width
 * pays only for what it actually shows.
 *
 * Where `matchMedia` is missing (tests, server render) it reads as `false`.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
      const mq = window.matchMedia(query)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    },
    [query],
  )
  const read = useCallback(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    [query],
  )
  return useSyncExternalStore(subscribe, read, () => false)
}
