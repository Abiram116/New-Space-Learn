import { createContext, useContext } from 'react'
import { useLocation, type Location } from 'react-router-dom'

/**
 * The address actually in the browser bar.
 *
 * Under a page that stays rendered beneath an overlay (App renders
 * `<Routes location={background}>` while a trust page is open over the landing
 * page), `useLocation()` returns that background address. Anything under it
 * that must know what is really open — the landing page's trust links — reads
 * this instead. Outside such a page it is simply the current location.
 */
export const RealLocationContext = createContext<Location | null>(null)

export function useRealLocation(): Location {
  const routed = useLocation()
  return useContext(RealLocationContext) ?? routed
}
