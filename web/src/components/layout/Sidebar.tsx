import { useEffect, useState } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { cn } from '../../lib/cn'
import { resolveTopicSegments, subspacePath, useFallbackSubspace } from '../../lib/nav'
import type { Space } from '../../api/types'
import { NewSpaceModal } from '../../features/spaces/NewSpaceModal'
import { SpaceTree } from '../../features/spaces/SpaceTree'
import { useSpaces } from '../../features/spaces/SpacesProvider'
import { SubjectIcon } from '../../features/spaces/SubjectIcon'
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
  const { loading, spaces } = useSpaces()
  const { hasAny } = useFallbackSubspace()
  const navigate = useNavigate()
  const [newSpaceOpen, setNewSpaceOpen] = useState(false)
  // A subject made together with its first topic used to land in the rail
  // closed (a subject with topics starts collapsed), so creating it appeared
  // to do nothing. Go to that topic instead: the subject you are inside is
  // open in the tree. The dialog only reports the subject's id, and the list
  // that holds its topic arrives a render later, hence the wait here.
  const [justCreated, setJustCreated] = useState<string | null>(null)
  useEffect(() => {
    if (!justCreated) return
    const space = spaces.find((s) => s.id === justCreated)
    if (!space) return
    setJustCreated(null)
    const first = space.subspaces[0]
    if (!first) return
    navigate(subspacePath(space, first))
    onNavigate?.()
  }, [justCreated, spaces, navigate, onNavigate])

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
    { to: hasAny ? '/notes' : '#', icon: 'note', label: 'Notes', enabled: hasAny, reason: whyDisabled },
    { to: hasAny ? '/flashcards' : '#', icon: 'deck', label: 'Cards', enabled: hasAny, reason: whyDisabled },
    { to: hasAny ? '/quizzes' : '#', icon: 'quiz', label: 'Quizzes', enabled: hasAny, reason: whyDisabled },
  ]

  return (
    <>
      <aside
        className={cn(
          'flex h-full min-h-0 w-full flex-col gap-3.5 overflow-x-hidden bg-surface p-2.5',
          collapsed && 'items-center gap-3 px-1.5',
        )}
      >
        {collapsed && onToggleCollapse ? (
          /* Collapsed: one slot, not a logo with a separate button stacked under
             it. The mark is the expand control — hover or focus it and it turns
             into the expand icon, so the rail stays one tidy column. Home is
             still one row below. */
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="group relative mt-1 grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-[10px] transition-colors hover:bg-line-soft focus-visible:bg-line-soft"
          >
            <span className="grid place-items-center transition duration-200 ease-out group-hover:scale-75 group-hover:opacity-0 group-focus-visible:scale-75 group-focus-visible:opacity-0 motion-reduce:transition-none">
              <LogoMark size={26} />
            </span>
            <span
              aria-hidden
              className="absolute inset-0 grid scale-75 place-items-center text-ink opacity-0 transition duration-200 ease-out group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
            >
              <Icon name="expand" size={18} />
            </span>
          </button>
        ) : (
          <div className="flex w-full items-center gap-2 px-1 pt-1">
            <Link
              to="/home"
              onClick={onNavigate}
              className="flex min-w-0 items-center gap-2.5"
              aria-label="Space Learn — home"
            >
              <LogoMark size={collapsed ? 26 : 28} />
              {!collapsed && (
                /* Sized to FIT the rail rather than be clipped by it: Archivo at
                   normal width and 16px clears the 232px rail beside the mark,
                   with `truncate` as a backstop. */
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
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                className="ml-auto hidden h-9 w-9 shrink-0 place-items-center rounded-[10px] text-faint transition-colors hover:bg-line-soft hover:text-ink md:grid"
              >
                <Icon name="collapse" size={17} />
              </button>
            )}
          </div>
        )}

        <nav aria-label="Primary" className={cn('flex w-full flex-col gap-0.5 text-[14px]', collapsed && 'items-center')}>
          {nav.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.end}
              // Marks this as "the student picked this page", so a click on the
              // page you are already on can take you back to its top (useNavReset).
              state={{ nav: true }}
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
                  'flex min-h-11 min-w-0 items-center gap-2.5 rounded-[10px] px-2.5 py-2 transition-colors md:min-h-10 pointer-coarse:min-h-11',
                  collapsed && 'w-10 justify-center px-0',
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
                    size={20}
                    lifted={isActive && item.enabled}
                  />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Search: opens the global search palette (owned elsewhere; it
            listens for this event and for Ctrl K itself). */}
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(new Event('sl:open-search'))
            onNavigate?.()
          }}
          aria-label="Search"
          aria-keyshortcuts="Control+K"
          title={collapsed ? 'Search (Ctrl K)' : undefined}
          className={cn(
            'flex min-h-10 shrink-0 cursor-pointer items-center gap-2.5 rounded-[10px] border border-line bg-well/60 text-[14px] text-muted transition-colors hover:border-brand/40 hover:text-ink pointer-coarse:min-h-11',
            collapsed ? 'h-10 w-10 justify-center px-0' : 'w-full px-2.5',
          )}
        >
          <Icon name="search" size={16} className="shrink-0" />
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate text-left">Search</span>
              <kbd className="shrink-0 rounded-[5px] border border-line bg-raised px-1.5 py-px font-mono text-[11px] text-faint">
                Ctrl K
              </kbd>
            </>
          )}
        </button>

        {!collapsed && (
          <div className="flex items-center gap-2 border-t border-line px-1 pt-4">
            <SectionLabel>Subjects</SectionLabel>
            <button
              type="button"
              className="ml-auto grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-[10px] text-muted transition-colors hover:bg-line-soft hover:text-brand pointer-coarse:h-11 pointer-coarse:w-11"
              aria-label="New subject"
              title="New subject"
              onClick={() => setNewSpaceOpen(true)}
            >
              <Icon name="plus" size={16} />
            </button>
          </div>
        )}

        {collapsed ? (
          /* Collapsed, the subjects used to be a lone "+" — you could make a
             subject from here but not see or reach one. Now each subject is
             its own icon (in its tone), opening its most recent topic, with
             "+" after them as the add action it always was. */
          <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden border-t border-line pt-3">
            {loading ? (
              <>
                <Skeleton className="h-10 w-10 rounded-[10px]" />
                <Skeleton className="h-10 w-10 rounded-[10px]" />
              </>
            ) : (
              <CollapsedSubjects onNavigate={onNavigate} onExpand={onToggleCollapse} />
            )}
            <button
              type="button"
              onClick={() => setNewSpaceOpen(true)}
              aria-label="New subject"
              title="New subject"
              className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-[10px] text-muted transition-colors hover:bg-line-soft hover:text-brand"
            >
              <Icon name="plus" size={18} />
            </button>
          </div>
        ) : (
          // -mx/px keeps a flush row's focus ring inside the clip box.
          <div className="-mx-1 min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-1 py-0.5">
            {loading ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            ) : (
              <SpaceTree onNavigate={onNavigate} />
            )}
          </div>
        )}

        {/* The account area: Skills, then who you are. One rule above the pair
            separates it from the topics, and Skills is deliberately NOT a
            nav row or a topic row — a bordered pill with its own tile, so it
            can't be mistaken for either. It is a library you visit now and
            then, so it stays compact. At rest it is completely still; the
            rainbow sweep on the label exists only while hovered (see
            `.rainbow-hover`), so it costs nothing in the common case and
            never runs on touch. */}
        <div className={cn('flex w-full flex-col gap-2 border-t border-line pt-3', collapsed && 'items-center')}>
          <NavLink
            to="/skills"
            onClick={onNavigate}
            title={collapsed ? 'Skills' : undefined}
            aria-label="Skills"
            className={({ isActive }) =>
              cn(
                'group flex min-h-10 items-center gap-2.5 rounded-xl border px-2 text-[14px] font-bold transition-colors',
                collapsed ? 'h-10 w-10 justify-center px-0' : 'w-full',
                isActive
                  ? 'border-brand/50 bg-brand-soft text-brand-deep'
                  : 'border-line bg-raised/60 text-ink-2 hover:border-brand/40 hover:text-ink',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    'grid h-6 w-6 shrink-0 place-items-center rounded-md',
                    isActive ? 'bg-surface text-brand' : 'bg-brand-soft text-brand-deep',
                  )}
                >
                  <Icon name="skill" size={14} />
                </span>
                {!collapsed && (
                  <>
                    <span className="rainbow-hover min-w-0 flex-1 truncate" data-text="Skills">
                      Skills
                    </span>
                    <Icon
                      name="arrowRight"
                      size={13}
                      className="shrink-0 text-faint transition-colors group-hover:text-brand"
                    />
                  </>
                )}
              </>
            )}
          </NavLink>

          <div className={cn('flex items-center gap-1', collapsed && 'w-full flex-col gap-2')}>
            <Link
              to="/profile"
              onClick={onNavigate}
              title={collapsed ? displayName : undefined}
              aria-label={collapsed ? `${displayName} — profile` : undefined}
              className={cn(
                'flex min-h-11 min-w-0 items-center gap-3 rounded-[10px] px-1.5 transition-colors hover:bg-line-soft',
                collapsed ? 'justify-center' : 'flex-1',
              )}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-coral-soft text-[12px] font-bold text-coral-deep">
                {initials}
              </span>
              {!collapsed && (
                <span className="min-w-0 text-[14px]">
                  <span className="block truncate font-bold text-ink">{displayName}</span>
                </span>
              )}
            </Link>
            <Link
              to="/settings"
              onClick={onNavigate}
              className={cn(
                'grid h-11 w-11 shrink-0 place-items-center rounded-[10px] text-muted transition-colors hover:bg-line-soft hover:text-ink',
              )}
              aria-label="Settings"
              title="Settings"
            >
              <Icon name="settings" size={18} />
            </Link>
          </div>
        </div>
      </aside>

      <NewSpaceModal open={newSpaceOpen} onClose={() => setNewSpaceOpen(false)} onCreated={setJustCreated} />
    </>
  )
}

/** The topic a subject's icon opens: the one touched last, else the first. */
function latestTopic(space: Space) {
  let best = space.subspaces[0]
  for (const sub of space.subspaces) {
    if ((sub.last_activity_at ?? '') > (best?.last_activity_at ?? '')) best = sub
  }
  return best
}

/**
 * The collapsed rail's subjects: one icon each, named by its tooltip and
 * label. A subject with a topic opens its latest one; a subject with none
 * expands the rail, where "Add topic" lives.
 */
function CollapsedSubjects({ onNavigate, onExpand }: { onNavigate?: () => void; onExpand?: () => void }) {
  const { spaces } = useSpaces()
  const params = useParams()
  const activeId = resolveTopicSegments(spaces, params.spaceId, params.subspaceId).space?.id
  const tile = (active: boolean) =>
    cn(
      'grid h-10 w-10 shrink-0 place-items-center rounded-[10px] transition-colors',
      active ? 'bg-brand-tint ring-1 ring-brand/40' : 'hover:bg-line-soft',
    )
  return (
    <ul aria-label="Subjects" className="flex flex-col items-center gap-1">
      {spaces.map((space) => {
        const topic = latestTopic(space)
        const active = space.id === activeId
        return (
          <li key={space.id}>
            {topic ? (
              <Link
                to={subspacePath(space, topic)}
                onClick={onNavigate}
                aria-label={space.name}
                aria-current={active ? 'true' : undefined}
                title={space.name}
                className={tile(active)}
              >
                <SubjectIcon space={space} size="md" />
              </Link>
            ) : (
              <button
                type="button"
                onClick={onExpand}
                disabled={!onExpand}
                aria-label={`${space.name} (no topics yet)`}
                title={`${space.name} — no topics yet`}
                className={cn(tile(false), 'cursor-pointer disabled:cursor-default')}
              >
                <SubjectIcon space={space} size="md" className="opacity-70" />
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
