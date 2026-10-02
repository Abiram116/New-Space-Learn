import { useEffect } from 'react'
import { useRealLocation } from '../../lib/realLocation'
import { slugFromPath, type TrustSlug } from './pages'
import { preloadTrustCard, type TrustState } from './TrustLayer'

/**
 * Props for the landing page's links to the trust pages (desktop corner, phone
 * row) — one place, so both behave the same.
 *
 *   - `state.background` keeps the landing page rendered under the card
 *     (TrustLayer), and stays the ORIGINAL page while you move between cards.
 *   - While a card is open the links replace the history entry instead of
 *     adding one, so Close (one step back) always lands on the landing page —
 *     not on the card before.
 *
 * Reads the real address (useRealLocation): under an open card, useLocation()
 * reports the landing page underneath, which is how every click used to push.
 */
export function useTrustLinks() {
  // Warm the card once the page has settled, so the first click is instant on
  // touch screens too (no hover to warm it there). A few KB, off the critical path.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 2500))
    const cancel = window.cancelIdleCallback ?? window.clearTimeout
    const id = idle(() => preloadTrustCard())
    return () => cancel(id)
  }, [])
  const location = useRealLocation()
  const open = slugFromPath(location.pathname)
  const background = (location.state as TrustState | null)?.background ?? location
  return {
    open,
    linkProps: (slug: TrustSlug) => ({
      to: `/${slug}`,
      state: { background } satisfies TrustState,
      replace: open !== null,
      'aria-current': open === slug ? ('page' as const) : undefined,
      onPointerEnter: preloadTrustCard,
      onFocus: preloadTrustCard,
    }),
  }
}
