/**
 * The landing page's entry: a phone gets `PhoneLanding`, everything else the
 * scroll-scrubbed film in `DesktopLanding`.
 *
 * The split is a download split too. The film carries GSAP's ScrollTrigger,
 * SplitText, Lenis and the four feature diagrams; a phone visitor used to
 * download all of it to show a plain native-scroll page. Now this module is
 * small, a phone never fetches the film, and a desktop starts fetching it the
 * moment this module is evaluated — before React has rendered anything — so
 * the extra hop costs a desktop visitor next to nothing.
 */

import { lazy, Suspense, useEffect } from 'react'
import { isMobileNow, useIsMobile } from '../../lib/useIsMobile'
import { PhoneLanding } from './PhoneLanding'

const loadDesktop = () => import('./DesktopLanding')
const DesktopLanding = lazy(() => loadDesktop().then((m) => ({ default: m.DesktopLanding })))

// Start the film's download alongside this module rather than after it renders.
if (typeof window !== 'undefined' && !isMobileNow()) void loadDesktop()

export function Landing() {
  // No scrollbars on the landing page, on any axis: it is a scroll-driven film,
  // and the bars (and a stray horizontal one) read as browser chrome over it.
  // Scrolling still works by wheel, trackpad, keys and touch. Scoped to this
  // page by a class on <html>, removed again when you leave it.
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('no-scrollbars')
    return () => root.classList.remove('no-scrollbars')
  }, [])
  return useIsMobile() ? (
    <PhoneLanding />
  ) : (
    // The page's own ground while the film arrives, so nothing flashes.
    <Suspense fallback={<div className="min-h-dvh bg-canvas" />}>
      <DesktopLanding />
    </Suspense>
  )
}
