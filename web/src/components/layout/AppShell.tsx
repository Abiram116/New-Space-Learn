import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { SpacesProvider } from '../../features/spaces/SpacesProvider'
import { Sidebar } from './Sidebar'
import { MobileBar } from './MobileBar'
import { OfflineBanner } from './OfflineBanner'

/**
 * Two layouts, one tree.
 *
 * ≥ md: the sidebar is a persistent 238px rail, as designed.
 * < md: the rail would eat two-thirds of a phone screen, so it moves into an
 * off-canvas drawer opened from a compact top bar. Same component either way —
 * only the container changes.
 */
export function AppShell() {
  const [navOpen, setNavOpen] = useState(false)
  const { pathname } = useLocation()

  // Route changes can also come from inside the page (a card link, a redirect),
  // not just the drawer's own links — close on any of them.
  useEffect(() => setNavOpen(false), [pathname])

  // A drawer that scrolls the page behind it feels broken on touch.
  useEffect(() => {
    if (!navOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [navOpen])

  useEffect(() => {
    if (!navOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setNavOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navOpen])

  return (
    <SpacesProvider>
      <div className="flex h-full flex-col bg-canvas">
        <OfflineBanner />
        <MobileBar onOpenNav={() => setNavOpen(true)} />

        <div className="flex min-h-0 flex-1">
          {/* Desktop rail */}
          <div className="hidden w-[238px] shrink-0 border-r-[1.5px] border-line md:block">
            <Sidebar />
          </div>

          {/* Mobile drawer */}
          <div
            className={cnDrawerRoot(navOpen)}
            aria-hidden={!navOpen}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setNavOpen(false)}
              className={`absolute inset-0 bg-ink/25 transition-opacity duration-200 motion-reduce:transition-none ${
                navOpen ? 'opacity-100' : 'opacity-0'
              }`}
            />
            <div
              className={`absolute inset-y-0 left-0 w-[270px] max-w-[85vw] rounded-r-2xl border-r-[1.5px] border-line shadow-xl transition-transform duration-200 ease-out motion-reduce:transition-none ${
                navOpen ? 'translate-x-0' : '-translate-x-full'
              }`}
            >
              <Sidebar onNavigate={() => setNavOpen(false)} />
            </div>
          </div>

          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </main>
        </div>
      </div>
    </SpacesProvider>
  )
}

/** Keep the drawer mounted so it can animate, but out of the tab order when shut. */
function cnDrawerRoot(open: boolean): string {
  return [
    'fixed inset-0 z-40 md:hidden',
    open ? 'pointer-events-auto' : 'pointer-events-none invisible',
  ].join(' ')
}
