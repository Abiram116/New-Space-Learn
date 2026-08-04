import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { cn } from '../../lib/cn'
import { useFallbackSubspace } from '../../lib/nav'
import { NewSpaceModal } from '../../features/spaces/NewSpaceModal'
import { SpaceTree } from '../../features/spaces/SpaceTree'
import { useSpaces } from '../../features/spaces/SpacesProvider'
import { SectionLabel } from '../ui/Bits'
import { Skeleton } from '../ui/Skeleton'

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded-[10px] px-2.5 py-2 transition-colors',
    isActive ? 'bg-brand-soft font-semibold text-brand' : 'text-ink-3 hover:bg-line-soft',
  )

/**
 * The space navigator. On desktop it's a persistent rail; below `md` the same
 * markup is rendered inside a drawer (see AppShell), so every nav target calls
 * `onNavigate` to dismiss it — otherwise tapping a space leaves the panel
 * covering the page you just asked for.
 */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth()
  const { loading } = useSpaces()
  const { base, hasAny } = useFallbackSubspace()
  const [newSpaceOpen, setNewSpaceOpen] = useState(false)

  const displayName =
    (user?.user_metadata?.display_name as string | undefined) ||
    user?.email?.split('@')[0] ||
    'You'
  const initials = displayName.slice(0, 2).toUpperCase()

  const disabledNav = 'pointer-events-none opacity-50'

  return (
    <>
      <aside className="flex h-full w-full min-h-0 flex-col gap-4 bg-surface p-4">
        <Link to="/" onClick={onNavigate} className="flex items-center gap-2.5">
          <span className="h-[26px] w-[26px] rounded-lg bg-brand" />
          <span className="font-display font-semibold">Space Learn</span>
        </Link>

        <nav className="flex flex-col gap-0.5 text-[13.5px]">
          <NavLink to="/" end onClick={onNavigate} className={navItemClass}>
            🏠 Home
          </NavLink>
          <NavLink
            to={hasAny ? `${base}/notes` : '#'}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(navItemClass({ isActive: isActive && hasAny }), !hasAny && disabledNav)
            }
          >
            📝 Notes
          </NavLink>
          <NavLink
            to={hasAny ? `${base}/flashcards` : '#'}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(navItemClass({ isActive: isActive && hasAny }), !hasAny && disabledNav)
            }
          >
            🗂 Flashcards
          </NavLink>
          <NavLink
            to={hasAny ? `${base}/quizzes` : '#'}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(navItemClass({ isActive: isActive && hasAny }), !hasAny && disabledNav)
            }
          >
            ✅ Tasks &amp; Quizzes
          </NavLink>
        </nav>

        <div className="flex items-center">
          <SectionLabel>SPACES</SectionLabel>
          <button
            className="ml-auto text-[15px] text-brand cursor-pointer"
            aria-label="New space"
            onClick={() => setNewSpaceOpen(true)}
          >
            +
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-7" />
              <Skeleton className="h-7" />
              <Skeleton className="h-7" />
            </div>
          ) : (
            <SpaceTree onNavigate={onNavigate} />
          )}
        </div>

        {hasAny && (
          <Link
            to={`${base}/skills`}
            onClick={onNavigate}
            className="rounded-xl bg-brand-soft p-2.5 text-xs text-brand-deep transition-colors hover:bg-brand-200/60"
          >
            <b>Skills for this space</b>
            <div className="mt-1 text-muted">manage AI personas →</div>
          </Link>
        )}

        <div className="flex items-center gap-2.5 border-t-[1.5px] border-line pt-3">
          <Link to="/profile" onClick={onNavigate} className="flex items-center gap-2.5 transition-colors hover:text-brand">
            <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-coral-soft text-[11px] font-semibold text-coral-deep">
              {initials}
            </span>
            <span className="text-[13px]">
              <span className="font-semibold">{displayName}</span>
              <span className="block text-[11px] font-normal text-muted">
                Free plan
              </span>
            </span>
          </Link>
          <Link
            to="/settings"
            onClick={onNavigate}
            className="ml-auto text-faint hover:text-brand"
            aria-label="Settings"
          >
            ⚙
          </Link>
        </div>
      </aside>

      <NewSpaceModal open={newSpaceOpen} onClose={() => setNewSpaceOpen(false)} />
    </>
  )
}
