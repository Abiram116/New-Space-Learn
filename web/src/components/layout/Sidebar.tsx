import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { cn } from '../../lib/cn'
import { useFallbackSubspace } from '../../lib/nav'
import { NewSpaceModal } from '../../features/spaces/NewSpaceModal'
import { SpaceTree } from '../../features/spaces/SpaceTree'
import { useSpaces } from '../../features/spaces/SpacesProvider'
import { Icon, type IconName } from '../ui/Icon'
import { Icon3D } from '../ui/Icon3D'
import { LogoMark } from '../ui/Logo'
import { SectionLabel } from '../ui/Bits'
import { Skeleton } from '../ui/Skeleton'

/**
 * The rail. On desktop it collapses to an icon strip; below `md` the same
 * markup renders inside a drawer (see AppShell), so every nav target calls
 * `onNavigate` to dismiss it.
 *
 * Everything here is `min-w-0` and truncating: a long subject name used to
 * force the rail to scroll sideways, which looked like a bug because it was.
 */
export function Sidebar({
  onNavigate,
  collapsed = false,
  onToggleCollapse,
}: {
  onNavigate?: () => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}) {
  const { user } = useAuth()
  const { loading } = useSpaces()
  const { base, hasAny } = useFallbackSubspace()
  const [newSpaceOpen, setNewSpaceOpen] = useState(false)

  const displayName =
    (user?.user_metadata?.display_name as string | undefined) ||
    user?.email?.split('@')[0] ||
    'You'
  const initials = displayName.slice(0, 2).toUpperCase()

  // Disabled state needs a reason attached to it, not just a dimmer colour.
  // A greyed-out nav item with no explanation reads as broken, not as
  // "do this first" — the dim alone doesn't say what "this" is.
  const whyDisabled = 'Add a topic to a subject to unlock this'
  const nav: {
    to: string
    icon: IconName
    label: string
    enabled: boolean
    end?: boolean
    reason?: string
  }[] = [
    { to: '/home', icon: 'home', label: 'Home', enabled: true, end: true },
    { to: hasAny ? `${base}/notes` : '#', icon: 'note', label: 'Notes', enabled: hasAny, reason: whyDisabled },
    { to: hasAny ? `${base}/flashcards` : '#', icon: 'deck', label: 'Cards', enabled: hasAny, reason: whyDisabled },
    { to: hasAny ? `${base}/quizzes` : '#', icon: 'quiz', label: 'Quizzes', enabled: hasAny, reason: whyDisabled },
  ]

  return (
    <>
      <aside
        className={cn(
          'flex h-full min-h-0 w-full flex-col gap-3 overflow-x-hidden bg-surface p-3',
          collapsed && 'items-center px-2',
        )}
      >
        <div className={cn('flex items-center gap-2', collapsed && 'flex-col gap-3')}>
          <Link
            to="/home"
            onClick={onNavigate}
            className="flex min-w-0 items-center gap-2.5"
            aria-label="Space Learn — home"
          >
            <LogoMark size={26} />
            {!collapsed && (
              /* Sized to FIT the rail rather than be clipped by it. The display
                 face is now Archivo at a 112% width axis, which is materially
                 wider than the condensed face it replaced, so "Space Learn" no
                 longer cleared the 238px rail beside the mark and the truncate
                 rendered it "SPACE LEA…". Normal width and 16px fit with room;
                 `truncate` stays as a backstop for long display names. */
              <span
                className="nameplate truncate text-[16px] text-ink"
                style={{ fontStretch: '100%' }}
              >
                Space Learn
              </span>
            )}
          </Link>
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={cn(
                'hidden shrink-0 rounded-md p-1.5 text-faint transition-colors hover:bg-line-soft hover:text-ink md:block',
                !collapsed && 'ml-auto',
              )}
            >
              <Icon name={collapsed ? 'expand' : 'collapse'} size={16} />
            </button>
          )}
        </div>

        <nav className="flex flex-col gap-0.5 text-[14.5px]">
          {nav.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.end}
              onClick={(e) => {
                // `pointer-events-none` would have been the simpler way to
                // block a disabled item, but it also blocks :hover — which
                // means the title tooltip explaining WHY it's disabled would
                // never fire, and a dimmed item with no explanation just
                // reads as broken. Pointer events stay on; the click itself
                // is what's stopped.
                if (!item.enabled) {
                  e.preventDefault()
                  return
                }
                onNavigate?.()
              }}
              title={collapsed ? item.label : !item.enabled ? item.reason : undefined}
              aria-disabled={!item.enabled}
              className={({ isActive }) =>
                cn(
                  'flex min-w-0 items-center gap-2.5 rounded-[9px] px-2.5 py-2 transition-colors',
                  collapsed && 'justify-center px-0',
                  isActive && item.enabled
                    ? 'bg-brand-soft font-semibold text-brand-deep'
                    : 'font-semibold text-ink-2 hover:bg-line-soft hover:text-ink',
                  !item.enabled && 'cursor-not-allowed text-faint opacity-70 hover:bg-transparent hover:text-faint',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* Extruded rather than flat, and the active item is lifted
                      further off the surface so "where I am" is legible from
                      the shape alone, not only from the colour. */}
                  <Icon3D
                    name={item.icon}
                    size={17}
                    lifted={isActive && item.enabled}
                  />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {!collapsed && (
          <div className="flex items-center gap-2 pt-1">
            <SectionLabel>Subjects</SectionLabel>
            <button
              type="button"
              className="ml-auto rounded-md p-1 text-faint transition-colors hover:bg-line-soft hover:text-brand cursor-pointer"
              aria-label="New subject"
              title="New subject"
              onClick={() => setNewSpaceOpen(true)}
            >
              <Icon name="plus" size={14} />
            </button>
          </div>
        )}

        {collapsed ? (
          <button
            type="button"
            onClick={() => setNewSpaceOpen(true)}
            aria-label="New subject"
            title="New subject"
            className="rounded-[9px] p-2 text-faint transition-colors hover:bg-line-soft hover:text-brand"
          >
            <Icon name="plus" size={16} />
          </button>
        ) : (
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
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
        )}

        {collapsed && <div className="flex-1" />}

        {/* Skills belong to a topic, so this only appears once one exists. */}
        {hasAny && !collapsed && (
          <Link
            to={`${base}/skills`}
            onClick={onNavigate}
            className="group flex items-center gap-2.5 rounded-[10px] border border-line bg-raised px-2.5 py-2 transition-colors hover:border-brand/40"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-brand-soft text-brand-deep">
              <Icon name="skill" size={15} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13.5px] font-bold text-ink">Skills</span>
              <span className="setcode">AI personalities</span>
            </span>
          </Link>
        )}

        <div
          className={cn(
            'flex items-center gap-2.5 border-t border-line pt-2.5',
            collapsed && 'flex-col border-t-0 pt-0',
          )}
        >
          <Link
            to="/profile"
            onClick={onNavigate}
            title={collapsed ? displayName : undefined}
            className="flex min-w-0 items-center gap-2.5 transition-colors hover:text-brand-deep"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-coral-soft text-[11px] font-bold text-coral-deep">
              {initials}
            </span>
            {!collapsed && (
              <span className="min-w-0 text-[12.5px]">
                <span className="block truncate font-bold text-ink">{displayName}</span>
                <span className="setcode">Free</span>
              </span>
            )}
          </Link>
          <Link
            to="/settings"
            onClick={onNavigate}
            className={cn(
              'shrink-0 rounded-md p-1.5 text-faint transition-colors hover:bg-line-soft hover:text-ink',
              !collapsed && 'ml-auto',
            )}
            aria-label="Settings"
            title="Settings"
          >
            <Icon name="settings" size={16} />
          </Link>
        </div>
      </aside>

      <NewSpaceModal open={newSpaceOpen} onClose={() => setNewSpaceOpen(false)} />
    </>
  )
}
