/**
 * Shows the trust pages when the address asks for one, and nothing otherwise.
 *
 *   - `/privacy` (from the landing page, or a shared link) — a full-width card
 *     that grows out of the bottom-right corner under the hero's corner links
 *     (TrustCard). Another link shrinks it away and grows the next one; Close /
 *     Esc / Back shrink it away. The landing links pass the page they were clicked on as
 *     `state.background`, and App keeps rendering that page underneath, so the
 *     landing page never reloads behind the card.
 *   - `?info=privacy` on any other page — the quiet slide-over (TrustPanel).
 *
 * Mounted once at the app root. A few lines in the main bundle; the surfaces
 * and all the words load only when one is actually opened.
 */

import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, type Location } from 'react-router-dom'
import { isTrustSlug, slugFromPath, TRUST_PARAM, type TrustSlug } from './pages'
import type { CardMotion } from './TrustCard'

const TrustPanel = lazy(() => import('./TrustPanel').then((m) => ({ default: m.TrustPanel })))
const loadCard = () => import('./TrustCard')
const TrustCard = lazy(() => loadCard().then((m) => ({ default: m.TrustCard })))

/**
 * Fetch the card (and the words) before it is asked for, so the first click
 * opens it at once instead of waiting on a download. Called when a link is
 * hovered or focused, and once the landing page is idle. The module system
 * caches the import, so repeated calls cost nothing.
 */
export function preloadTrustCard(): void {
  void loadCard()
}

/** How long the card takes to shrink away — before it unmounts, or before
 *  the next page's card grows in. */
const LEAVE_MS = 460

/** The page a landing link was clicked on, kept so it stays rendered underneath. */
export type TrustState = { background?: Location }

/** The current page with `?info=<slug>` added: opens a trust page over it. */
export function trustOverlayHref(location: Pick<Location, 'pathname' | 'search'>, slug: TrustSlug): string {
  const params = new URLSearchParams(location.search)
  params.set(TRUST_PARAM, slug)
  return `${location.pathname}?${params}`
}

function withoutParam(search: string): string {
  const params = new URLSearchParams(search)
  params.delete(TRUST_PARAM)
  const rest = params.toString()
  return rest ? `?${rest}` : ''
}

export function TrustLayer() {
  const location = useLocation()
  const navigate = useNavigate()
  const routeSlug = slugFromPath(location.pathname)

  // The card outlives its address by one animation: when the address names a
  // different page, or none (Close, Esc, Back), the shown card shrinks away
  // first — then the next one grows in, or nothing does.
  const [card, setCard] = useState<{ slug: TrustSlug; motion: CardMotion } | null>(
    routeSlug ? { slug: routeSlug, motion: 'enter' } : null,
  )
  const shownSlug = useRef<TrustSlug | null>(routeSlug)
  useEffect(() => {
    const prev = shownSlug.current
    if (prev === routeSlug) return
    shownSlug.current = routeSlug
    if (!prev) {
      setCard(routeSlug ? { slug: routeSlug, motion: 'enter' } : null)
      return
    }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    setCard({ slug: prev, motion: 'leave' })
    const t = window.setTimeout(
      () => setCard(routeSlug ? { slug: routeSlug, motion: 'enter' } : null),
      reduced ? 0 : LEAVE_MS,
    )
    return () => window.clearTimeout(t)
  }, [routeSlug])

  if (card) {
    const state = location.state as TrustState | null
    // Back to the page it was opened from; a shared link has none, so home.
    const close = () => {
      if (!routeSlug) return
      if (state?.background) navigate(-1)
      else navigate('/', { replace: true })
    }
    return (
      <Suspense fallback={null}>
        <TrustCard slug={card.slug} motion={card.motion} onClose={close} />
      </Suspense>
    )
  }

  const asked = new URLSearchParams(location.search).get(TRUST_PARAM)
  if (!isTrustSlug(asked)) return null

  // Switching pages replaces the entry, so Back (and Close) leave the panel in
  // one step however many pages were read.
  const select = (next: TrustSlug) => navigate(trustOverlayHref(location, next), { replace: true })
  // Back to where the panel was opened from; arriving on a link that already
  // had `?info=`, it just drops the parameter.
  const close = () => {
    if (location.key !== 'default') navigate(-1)
    else navigate(`${location.pathname}${withoutParam(location.search)}`, { replace: true })
  }
  return (
    <Suspense fallback={null}>
      <TrustPanel slug={asked} onSelect={select} onClose={close} />
    </Suspense>
  )
}
