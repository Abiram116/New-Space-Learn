import { NavLink } from 'react-router-dom'
import { cn } from '../../lib/cn'
import type { DockPanel } from './DockPanels'

/** The sections a topic's chat can open beside the conversation. */
const SECTIONS: { key: 'chat' | NonNullable<DockPanel>; label: string; path: string }[] = [
  { key: 'chat', label: 'Chat', path: '' },
  { key: 'docs', label: 'Docs', path: '/docs' },
  { key: 'notes', label: 'Notes', path: '/notes' },
  { key: 'quizzes', label: 'Quizzes', path: '/quizzes' },
  { key: 'flashcards', label: 'Cards', path: '/flashcards' },
]

/**
 * Chat's own row of sections — only on the chat page.
 *
 * With the right-hand dock on screen each one swaps the dock's panel, so
 * opening this topic's notes or cards never throws away the conversation.
 * Below `lg` there is no dock, so they stay real links to the topic's pages.
 */
export function ChatSections({
  base,
  active,
  hasDock,
  onSelect,
}: {
  base: string
  active: 'chat' | NonNullable<DockPanel>
  hasDock: boolean
  onSelect: (panel: DockPanel) => void
}) {
  return (
    <nav
      aria-label="Topic sections"
      className="-mx-4 flex w-[calc(100%+2rem)] gap-1.5 overflow-x-auto px-4 py-0.5 [scrollbar-width:none] sm:mx-0 sm:ml-auto sm:w-auto sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {SECTIONS.map((s) => {
        const look = (on: boolean) =>
          cn(
            'flex min-h-10 shrink-0 cursor-pointer items-center rounded-[10px] px-3.5 py-2 text-[14px] transition-colors pointer-coarse:min-h-11',
            on ? 'bg-brand-soft font-semibold text-brand' : 'font-medium text-ink-3 hover:bg-line-soft hover:text-ink',
          )
        // With the dock these switch a panel on this page, so they are buttons,
        // not links: nothing navigates, and "current" is the open panel.
        return hasDock ? (
          <button
            key={s.key}
            type="button"
            onClick={() => onSelect(s.key === 'chat' ? null : s.key)}
            aria-pressed={active === s.key}
            className={look(active === s.key)}
          >
            {s.label}
          </button>
        ) : (
          <NavLink key={s.key} to={`${base}${s.path}`} end={s.key === 'chat'} className={({ isActive }) => look(isActive)}>
            {s.label}
          </NavLink>
        )
      })}
    </nav>
  )
}
