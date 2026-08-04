import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { cn } from '../../lib/cn'
import { useActiveSubspace } from '../../lib/nav'

/**
 * Header rendered inside every subspace route. Shows the space > subspace
 * breadcrumb, the current title, and either the tab strip or a `actions`
 * region caller supplies (Skills, Flashcards, etc. use this).
 */
export function SubspaceHeader({
  title,
  actions,
}: {
  title?: string
  actions?: ReactNode
}) {
  const { space, subspace, base } = useActiveSubspace()

  const spaceName = space?.name ?? 'Space'
  const subspaceName = subspace?.name ?? '—'
  const displayTitle = title ?? subspaceName

  const tabs = [
    { to: base, label: 'Chat', end: true },
    { to: `${base}/docs`, label: 'Docs' },
    { to: `${base}/notes`, label: 'Notes' },
    { to: `${base}/quizzes`, label: 'Quizzes' },
    { to: `${base}/flashcards`, label: 'Cards' },
  ]

  return (
    // Below `sm` the title and the tab strip stack: five tabs plus a breadcrumb
    // cannot share 375px without one of them truncating to uselessness.
    <header className="flex shrink-0 flex-col gap-2 border-b-[1.5px] border-line bg-surface px-4 py-3 sm:flex-row sm:items-center sm:gap-2.5 sm:px-6">
      <div className="min-w-0">
        <div className="truncate text-[11.5px] text-faint">
          {title ? `${spaceName} › ${subspaceName}` : spaceName}
        </div>
        <h1 className="truncate font-display text-[17px] font-semibold">{displayTitle}</h1>
      </div>

      {actions ? (
        <div className="flex items-center gap-2 sm:ml-auto">{actions}</div>
      ) : (
        <nav className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 text-[12.5px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:ml-auto sm:overflow-visible sm:px-0">
          {tabs.map((tab) => (
            <NavLink
              key={tab.label}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  'shrink-0 rounded-[9px] px-2.5 py-1.5 transition-colors',
                  isActive
                    ? 'bg-brand-soft font-semibold text-brand'
                    : 'text-ink-3 hover:bg-line-soft',
                )
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  )
}
