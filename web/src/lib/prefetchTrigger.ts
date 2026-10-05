/**
 * The triggers for `lib/prefetch`, kept apart so that the entry bundle carries only
 * these few lines and the data functions they call are fetched only when one fires.
 */

import { hasAuthToken } from '../api/client'
import { RESERVED_ROOTS } from './slug'

/** How long a pointer must rest on a link before it counts as intent. */
const HOVER_MS = 90
/** How long to wait for the sign-in token on a deep link. */
const TOKEN_WAIT_MS = 6_000

const load = () => import('./prefetch')

/** Reserved first segments that are screens with data of their own (and the old `/s/` topic form). */
const DATA_SCREENS = new Set(['flashcards', 'quizzes', 'notes', 'profile', 's'])

/** The in-app path a link points at, or null for anything that leaves the app. */
function appPath(anchor: HTMLAnchorElement): string | null {
  if (anchor.target && anchor.target !== '_self') return null
  if (anchor.hasAttribute('download')) return null
  const href = anchor.getAttribute('href')
  if (!href || href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return null
  const url = new URL(anchor.href, window.location.href)
  if (url.origin !== window.location.origin) return null
  return url.pathname
}

function intended(path: string): void {
  if (!hasAuthToken()) return
  void load().then((m) => m.intended(path))
}

/**
 * Listen, once, for the signs that a link is about to be followed. Returns the
 * function that stops listening (what `useEffect` wants back).
 */
export function watchIntent(): () => void {
  if (typeof document === 'undefined') return () => {}
  let timer: ReturnType<typeof setTimeout> | undefined

  const linkOf = (target: EventTarget | null): string | null => {
    const anchor = (target as Element | null)?.closest?.('a[href]')
    return anchor ? appPath(anchor as HTMLAnchorElement) : null
  }
  const onOver = (e: PointerEvent) => {
    // A finger has no "resting"; `pointerdown` below covers it.
    if (e.pointerType !== 'mouse') return
    const path = linkOf(e.target)
    clearTimeout(timer)
    if (path) timer = setTimeout(() => intended(path), HOVER_MS)
  }
  const onOut = () => clearTimeout(timer)
  const onDown = (e: PointerEvent) => {
    const path = linkOf(e.target)
    if (path) intended(path)
  }
  const onFocus = (e: FocusEvent) => {
    const path = linkOf(e.target)
    if (path) intended(path)
  }

  document.addEventListener('pointerover', onOver, { passive: true })
  document.addEventListener('pointerout', onOut, { passive: true })
  document.addEventListener('pointerdown', onDown, { passive: true })
  document.addEventListener('focusin', onFocus)
  return () => {
    clearTimeout(timer)
    document.removeEventListener('pointerover', onOver)
    document.removeEventListener('pointerout', onOut)
    document.removeEventListener('pointerdown', onDown)
    document.removeEventListener('focusin', onFocus)
  }
}

/**
 * On load: if the address is a topic this tab has seen, ask for its history and
 * files now, alongside `/spaces`, instead of after it answers.
 *
 * Runs at module load, before the session is known, so it waits (briefly, and
 * only while the app is still starting) for the sign-in token: a request sent
 * without one would be a 401, and a 401 signs the student out.
 */
export function warmDeepLink(): void {
  if (typeof window === 'undefined') return
  const path = window.location.pathname
  const first = path.split('/').filter(Boolean)[0]
  // Only addresses that can be a screen with data behind them: not the landing
  // page, sign-in, the auth callback, or anything else the app reserves.
  if (!first || (RESERVED_ROOTS.has(first) && !DATA_SCREENS.has(first))) return
  const started = Date.now()
  const tick = () => {
    if (hasAuthToken()) {
      void load().then((m) => m.prepareCurrent(path))
    } else if (Date.now() - started < TOKEN_WAIT_MS) {
      setTimeout(tick, 60)
    }
  }
  tick()
}
