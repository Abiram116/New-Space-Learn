import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { cn } from '../../lib/cn'
import { useActiveSubspace } from '../../lib/nav'

/**
 * Header rendered inside every subspace route. Shows the space > subspace
 * breadcrumb, the current title, the tab strip, and any `actions` the caller
 * supplies (Skills, Flashcards, etc. use this).
 *
 * The tabs and the actions both render. This used to be an either/or, which
 * silently removed primary navigation from every screen that passed an action
 * — Docs, Cards, deck detail, review, summary, quiz list, quiz runner, skills.
 * Nine screens with no way back except the browser button.
 */
/** The tab keys, so callers can intercept by name rather than by URL. */
export type SubspaceTab = 'chat' | 'docs' | 'notes' | 'quizzes' | 'flashcards'

export function SubspaceHeader({
  title,
  actions,
  onSelectTab,
  activeTab,
  tabs: showTabs = true,
}: {
  title?: string
  actions?: ReactNode
  /**
   * Handle a tab locally instead of navigating. Return `true` to say "I dealt
   * with it" and the link is suppressed.
   *
   * Chat uses this to swap the right-hand dock rather than replacing the whole
   * page: opening Docs to add one PDF should not throw away the conversation
   * you are having, and coming back should not be a browser-back away.
   * Everywhere else these stay ordinary links, so deep links and the back
   * button keep working exactly as before.
   */
  onSelectTab?: (tab: SubspaceTab) => boolean
  /** Which tab reads as current when the caller is handling them itself. */
  activeTab?: SubspaceTab
  /**
   * The tabs are "which of this TOPIC's screens am I on" — right for Chat and
   * Docs, which are genuinely scoped to one topic. Notes/Quizzes/Cards
   * stopped being that (see the 2026-08 audit: they're account-wide
   * libraries now, reached from whichever topic happens to be open, not
   * confined to it), so a strip implying five per-topic tabs was actively
   * misleading on exactly those three screens. Default `true` — this only
   * needs setting where a screen is no longer topic-scoped.
   */
  tabs?: boolean
}) {
  const { space, subspace, base } = useActiveSubspace()

  const spaceName = space?.name ?? 'Space'
  const subspaceName = subspace?.name ?? '—'
  const displayTitle = title ?? subspaceName

  const tabs: { key: SubspaceTab; to: string; label: string; end?: boolean }[] = [
    { key: 'chat', to: base, label: 'Chat', end: true },
    { key: 'docs', to: `${base}/docs`, label: 'Docs' },
    { key: 'notes', to: `${base}/notes`, label: 'Notes' },
    { key: 'quizzes', to: `${base}/quizzes`, label: 'Quizzes' },
    { key: 'flashcards', to: `${base}/flashcards`, label: 'Cards' },
  ]

  return (
    // Below `sm` the title and the tab strip stack: five tabs plus a breadcrumb
    // cannot share 375px without one of them truncating to uselessness.
    <header className="flex shrink-0 flex-col gap-2 border-b-[1.5px] border-line bg-surface px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5 sm:px-6">
      <div className="min-w-0">
        {/* Same signal as the tab strip below: a "Subject › Topic"
            breadcrumb over a screen that lists every topic's notes/cards/
            quizzes at once claims a scope the screen doesn't have anymore
            — it read as "you're still looking at just this topic" on
            account-wide libraries. */}
        {showTabs && (
          <div className="truncate text-[11.5px] text-faint">
            {title ? `${spaceName} › ${subspaceName}` : spaceName}
          </div>
        )}
        <h1 className="truncate font-display text-[17px] font-semibold">{displayTitle}</h1>
      </div>

      {showTabs && (
        <nav className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 text-[12.5px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:ml-auto sm:overflow-visible sm:px-0">
          {tabs.map((tab) => (
            <NavLink
              key={tab.label}
              to={tab.to}
              end={tab.end}
              onClick={(e) => {
                if (onSelectTab?.(tab.key)) e.preventDefault()
              }}
              className={({ isActive }) =>
                cn(
                  'shrink-0 rounded-[9px] px-2.5 py-1.5 transition-colors',
                  // When the caller is driving, its state decides what is
                  // current — the router still thinks we are on /chat.
                  (activeTab ? activeTab === tab.key : isActive)
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

      {actions ? (
        <div className={cn('flex items-center gap-2', !showTabs && 'sm:ml-auto')}>{actions}</div>
      ) : null}
    </header>
  )
}
