import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { cn } from '../../lib/cn'
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
const COLLAPSE_KEY = 'sl:rail-collapsed'

export function AppShell() {
  const [navOpen, setNavOpen] = useState(false)
  // Persisted: a rail you collapsed should stay collapsed tomorrow.
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === '1',
  )
  const { pathname } = useLocation()

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      localStorage.setItem(COLLAPSE_KEY, prev ? '0' : '1')
      return !prev
    })
  }

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
          <div
            className={cn(
              'hidden h-full min-h-0 shrink-0 border-r border-line transition-[width] duration-200 ease-out md:block',
              collapsed ? 'w-[60px]' : 'w-[238px]',
            )}
          >
            <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} />
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
              className={`absolute inset-0 bg-well/80 backdrop-blur-[2px] transition-opacity duration-200 motion-reduce:transition-none ${
                navOpen ? 'opacity-100' : 'opacity-0'
              }`}
            />
            <div
              className={`absolute inset-y-0 left-0 w-[270px] max-w-[85vw] overflow-hidden rounded-r-2xl border-r border-line shadow-[0_0_60px_rgba(0,0,0,0.7)] transition-transform duration-200 ease-out motion-reduce:transition-none ${
                navOpen ? 'translate-x-0' : '-translate-x-full'
              }`}
            >
              <Sidebar onNavigate={() => setNavOpen(false)} />
            </div>
          </div>

          <main
            className="relative flex min-w-0 flex-1 flex-col overflow-hidden"
            style={{
              backgroundImage:
                'radial-gradient(90ch 60ch at 14% -6%, #2a211b 0%, transparent 58%),' +
                'radial-gradient(70ch 52ch at 100% 8%, #2c1a18 0%, transparent 55%),' +
                'radial-gradient(60ch 46ch at 60% 100%, #241a17 0%, transparent 56%)',
            }}
          >
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
