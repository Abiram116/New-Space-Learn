import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { useActiveSubspace } from '../../lib/nav'
import { useIsMobile } from '../../lib/useIsMobile'
import { SHELL_TITLES } from '../../features/mobile/phoneNav'

/**
 * Header rendered inside every subspace route: the space > subspace breadcrumb,
 * the current title, and any `actions` the caller supplies.
 *
 * Every page used to carry a Chat / Docs / Notes / Quizzes / Cards tab strip.
 * It duplicated the sidebar (Notes, Cards and Quizzes are global pages), and on
 * the card and quiz stages it took keyboard focus, so Space / Enter activated a
 * tab instead of the shortcut. Only Chat keeps a section row now, passed in as
 * `sections` (see `features/chat/ChatSections`).
 */
type SubspaceHeaderProps = {
  title?: string
  actions?: ReactNode
  /**
   * The "Subject › Topic" line above the title — right for Chat and Docs,
   * which are genuinely scoped to one topic. Notes, Quizzes and Cards are
   * account-wide libraries now (2026-08 audit), so a breadcrumb over them
   * would claim a scope they don't have. Default `true`.
   */
  breadcrumb?: boolean
  /** A row of sections beside the title (Chat only). */
  sections?: ReactNode
}

/**
 * On a phone the shell's top bar already names the page and the topic, and
 * the bottom tab bar is the navigation — so this collapses to the screen's
 * own title (only when it adds something, e.g. a deck's name) and its
 * actions. No breadcrumb, and no tab strip: that strip is where the Chat tab
 * lives, and phones have no chat.
 */
export function SubspaceHeader(props: SubspaceHeaderProps) {
  const mobile = useIsMobile()
  if (mobile) return <PhoneSubspaceHeader title={props.title} actions={props.actions} />
  return <DesktopSubspaceHeader {...props} />
}

function PhoneSubspaceHeader({ title, actions }: { title?: string; actions?: ReactNode }) {
  const showTitle = Boolean(title) && !SHELL_TITLES.has(title!)
  if (!showTitle && !actions) return null
  return (
    <header className="flex min-h-[56px] shrink-0 items-center gap-3 border-b border-line-soft px-4 py-2">
      {showTitle && (
        <h2 className="min-w-0 flex-1 truncate font-display text-[18px] font-semibold leading-snug text-ink">{title}</h2>
      )}
      {actions ? (
        <div className={cn('flex min-w-0 shrink-0 items-center gap-2', !showTitle && 'ml-auto')}>{actions}</div>
      ) : null}
    </header>
  )
}

function DesktopSubspaceHeader({ title, actions, breadcrumb = true, sections }: SubspaceHeaderProps) {
  const { space, subspace } = useActiveSubspace()

  const displayTitle = title ?? subspace?.name ?? ''

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b-[1.5px] border-line bg-surface px-4 py-3 sm:px-6">
      <div className="min-w-0 flex-1 basis-40">
        {breadcrumb && space && subspace && (
          <div className="truncate text-[12.5px] text-faint">
            {title ? `${space.name} › ${subspace.name}` : space.name}
          </div>
        )}
        <h1 className="truncate font-display text-[19px] font-semibold leading-snug">{displayTitle}</h1>
      </div>

      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      {sections}
    </header>
  )
}
