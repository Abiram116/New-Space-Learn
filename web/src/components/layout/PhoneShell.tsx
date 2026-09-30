import { useEffect, useState, type CSSProperties } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { cn } from '../../lib/cn'
import { prefetchRouteChunks } from '../../routes/lazyRoutes'
import { useCurrentTopic } from '../../features/mobile/currentTopic'
import { TopicSwitcher } from '../../features/mobile/TopicSwitcher'
import { useDueCount } from '../../features/mobile/useDueCount'
import { PageTransition } from '../ui/motion'
import { useKeyboard } from '../ui/useKeyboard'
import { BottomTabBar } from './BottomTabBar'
import { useIsImmersive } from './immersive'
import { OfflineBanner } from './OfflineBanner'
import { PhoneTopBar } from './PhoneTopBar'

/** Same lamp-light pools as the desktop <main>, so both shells share a ground. */
const GROUND: CSSProperties = {
  backgroundImage:
    'radial-gradient(90ch 60ch at 14% -6%, #2a211b 0%, transparent 58%),' +
    'radial-gradient(70ch 52ch at 100% 8%, #2c1a18 0%, transparent 55%),' +
    'radial-gradient(60ch 46ch at 60% 100%, #241a17 0%, transparent 56%)',
}

/** Tab bar height above the safe area — toasts float clear of it. */
const TAB_BAR_PX = 61

/**
 * The phone app: a revision companion, not a shrunk desktop.
 *
 * One column, three rows — a slim top bar, the page, a bottom tab bar — sized
 * to the dynamic viewport so a collapsing URL bar never hides the tabs and the
 * page is the only thing that scrolls. No rail, no drawer, no chat: topics
 * are switched from a sheet, and chat routes resolve to the topic hub (see
 * `routes/TopicRoutes`).
 *
 * The bars step aside for immersive screens (`useImmersive`) and the tab bar
 * also while the keyboard is up, so typing gets the room.
 */
export function PhoneShell() {
  const { pathname } = useLocation()
  const immersive = useIsImmersive()
  const keyboard = useKeyboard()
  const topic = useCurrentTopic()
  const dueCount = useDueCount()
  const [switcherOpen, setSwitcherOpen] = useState(false)

  const showTabs = !immersive && !keyboard.open

  useEffect(() => setSwitcherOpen(false), [pathname])
  useEffect(() => prefetchRouteChunks(), [])

  // Toasts render at the root, outside this tree, so the lift goes on <html>.
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--sl-toast-lift', showTabs ? `calc(${TAB_BAR_PX}px + env(safe-area-inset-bottom))` : '0px')
    return () => {
      root.style.removeProperty('--sl-toast-lift')
    }
  }, [showTabs])

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas" data-phone-shell="">
      <OfflineBanner />
      {!immersive && (
        <PhoneTopBar
          space={topic.space}
          subspace={topic.subspace}
          loading={topic.loading}
          onOpenSwitcher={() => setSwitcherOpen(true)}
        />
      )}

      <main
        className={cn(
          'relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
          immersive && 'pt-[env(safe-area-inset-top)]',
        )}
        style={GROUND}
      >
        <PageTransition routeKey={pathname}>
          <Outlet />
        </PageTransition>
      </main>

      {showTabs && <BottomTabBar topicBase={topic.base} dueCount={dueCount} />}

      <TopicSwitcher
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        currentId={topic.subspace?.id ?? null}
      />
    </div>
  )
}
