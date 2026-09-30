/**
 * The one definition of "phone" for structural layout decisions.
 *
 * Phones get a different product shape, not a squeezed desktop: a bottom tab
 * bar, no chat, bottom sheets, thumb-zone actions. That switch has to be ONE
 * rule that every screen agrees on, or a page can end up with a phone header
 * over a desktop body.
 *
 * Width alone isn't enough: a phone held sideways is ~850px wide but only
 * ~390px tall, and giving it the desktop shell would be the worst of both. So
 * "mobile" is a narrow viewport OR a short touch viewport. Tablets (>= 768px
 * wide and tall) keep the desktop layout — chat included.
 *
 * Use this for STRUCTURE (which components render, which routes exist).
 * Use Tailwind classes for pure styling tweaks inside one layout.
 */

import { useSyncExternalStore } from 'react'

export const MOBILE_QUERY = '(max-width: 767px), (pointer: coarse) and (max-height: 500px)'

function query(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(MOBILE_QUERY)
    : null
}

/** Non-React read (route guards, event handlers). False where matchMedia is missing (tests, SSR). */
export function isMobileNow(): boolean {
  return query()?.matches ?? false
}

function subscribe(onChange: () => void): () => void {
  const mq = query()
  if (!mq) return () => {}
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, isMobileNow, () => false)
}
