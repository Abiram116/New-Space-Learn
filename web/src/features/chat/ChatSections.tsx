import { NavLink } from 'react-router-dom'
import { cn } from '../../lib/cn'

/** The topic's pages, as links. */
const SECTIONS: { label: string; path: string }[] = [
  { label: 'Chat', path: '' },
  { label: 'Files', path: '/docs' },
  { label: 'Notes', path: '/notes' },
  { label: 'Quizzes', path: '/quizzes' },
  { label: 'Cards', path: '/flashcards' },
]

/**
 * Chat's row of links to the topic's own pages — only where there is no
 * sidebar (below `lg`).
 *
 * With the sidebar on screen this row is not shown at all: Files, Notes,
 * Quizzes and Cards are opened from the sidebar itself, so there is one way to
 * each. It used to be a second set of buttons for the same panels, and its
 * highlighted tab sat above a middle column that still showed the chat, which
 * read as a bug.
 */
export function ChatSections({ base }: { base: string }) {
  return (
    <nav
      aria-label="Topic sections"
      className="-mx-4 flex w-[calc(100%+2rem)] gap-1.5 overflow-x-auto px-4 py-0.5 [scrollbar-width:none] sm:mx-0 sm:ml-auto sm:w-auto sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {SECTIONS.map((s) => (
        <NavLink
          key={s.label}
          to={`${base}${s.path}`}
          end={s.path === ''}
          className={({ isActive }) =>
            cn(
              'flex min-h-10 shrink-0 cursor-pointer items-center rounded-[10px] px-3.5 py-2 text-[14px] transition-colors pointer-coarse:min-h-11',
              isActive ? 'bg-brand-soft font-semibold text-brand' : 'font-medium text-ink-3 hover:bg-line-soft hover:text-ink',
            )
          }
        >
          {s.label}
        </NavLink>
      ))}
    </nav>
  )
}
