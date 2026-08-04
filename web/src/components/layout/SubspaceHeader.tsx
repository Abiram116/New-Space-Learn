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
    <header className="flex shrink-0 items-center gap-2.5 border-b-[1.5px] border-line bg-surface px-6 py-3">
      <div className="min-w-0">
        <div className="truncate text-[11.5px] text-faint">
          {title ? `${spaceName} › ${subspaceName}` : spaceName}
        </div>
        <h1 className="truncate font-display text-[17px] font-semibold">{displayTitle}</h1>
      </div>

      {actions ? (
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      ) : (
        <nav className="ml-auto flex gap-1.5 text-[12.5px]">
          {tabs.map((tab) => (
            <NavLink
              key={tab.label}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  'rounded-[9px] px-2.5 py-1.5 transition-colors',
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
