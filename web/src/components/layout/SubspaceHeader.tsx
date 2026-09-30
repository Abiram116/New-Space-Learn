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

  const tabStrip = showTabs && (
    <nav
      aria-label="Topic sections"
      // Scrolls sideways on a phone rather than truncating a label. The
      // negative margin lets the strip bleed to the screen edge while the
      // first tab still lines up with the title.
      className={cn(
        'flex gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        // With a page action the tabs get their own full-width row under the
        // title, so the action can hold the top-right corner on every screen
        // size. Without one (Chat) they share the title's row from `sm` up.
        actions
          ? '-mx-4 w-[calc(100%+2rem)] px-4 sm:-mx-6 sm:w-[calc(100%+3rem)] sm:px-6'
          : '-mx-4 w-[calc(100%+2rem)] px-4 sm:mx-0 sm:ml-auto sm:w-auto sm:overflow-visible sm:px-0',
      )}
    >
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
              'flex min-h-10 shrink-0 items-center rounded-[10px] px-3.5 py-2 text-[14px] transition-colors pointer-coarse:min-h-11',
              // When the caller is driving, its state decides what is
              // current — the router still thinks we are on /chat.
              (activeTab ? activeTab === tab.key : isActive)
                ? 'bg-brand-soft font-semibold text-brand'
                : 'font-medium text-ink-3 hover:bg-line-soft hover:text-ink',
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )

  return (
    // DOM order is visual order: title, then the page action (top-right), then
    // the tab strip. With no action the tabs sit beside the title on wide
    // screens instead, and below `sm` they drop under it.
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b-[1.5px] border-line bg-surface px-4 py-3 sm:px-6">
      <div className="min-w-0 flex-1 basis-40">
        {/* Same signal as the tab strip: a "Subject › Topic" breadcrumb over a
            screen that lists every topic's notes/cards/quizzes at once claims a
            scope the screen doesn't have anymore. */}
        {showTabs && (
          <div className="truncate text-[12.5px] text-faint">
            {title ? `${spaceName} › ${subspaceName}` : spaceName}
          </div>
        )}
        <h1 className="truncate font-display text-[19px] font-semibold leading-snug">{displayTitle}</h1>
      </div>

      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}

      {tabStrip}
    </header>
  )
}
