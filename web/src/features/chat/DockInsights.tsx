/**
 * The study section of a topic in use: three ways in, what is waiting for you,
 * and an outline of the conversation. No characters, no looping motion — the
 * chat beside it is already busy, and every row here is something you can use.
 *
 * Everything shown is worked out from data the dock already holds (the notes,
 * quizzes and decks it loads for its counts, and the chat's own messages).
 * Nothing here calls the AI, and nothing here needs a request of its own.
 *
 * Rows appear only when they have something real to say. Nothing is listed
 * just to be listed: a row of "100%" for every quiz tells you nothing, so the
 * only quiz that shows is the one worth another go.
 */

import { useNavigate } from 'react-router-dom'
import type { Deck, Note, Quiz } from '../../api/types'
import { Icon, type IconName } from '../../components/ui/Icon'
import { cn } from '../../lib/cn'
import { quizHref, reviewDeckHref } from '../../lib/fromChat'
import { prefersReducedMotion } from '../../components/mascot/runtime'
import { DockSectionHead } from './dockParts'
import type { DockPanel } from './DockPanels'

export type DockQuestion = { id: string; text: string }

export type DockLists = {
  decks: Deck[]
  quizzes: Quiz[]
  notes: Note[]
  /** What the student has asked in this chat, oldest first. */
  questions: DockQuestion[]
}

/** A quiz never taken, or best-scored under this, is worth another go. */
export const SOLID_AT = 80
/** The quiz that most deserves a go: the weakest score, or one never taken. */
export function worthAnotherGo(quizzes: Quiz[]): Quiz | null {
  const rank = (q: Quiz) => (typeof q.best_score === 'number' ? q.best_score : SOLID_AT - 0.5)
  return (
    quizzes
      .filter((q) => typeof q.best_score !== 'number' || q.best_score < SOLID_AT)
      .sort((a, b) => rank(a) - rank(b))[0] ?? null
  )
}

/** Scrolls the chat to a question, if it is still on the page. */
export function jumpToQuestion(id: string) {
  const el = document.getElementById(`msg-${id}`)
  el?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
}

export function DockInsights({
  base,
  lists,
  onOpenPanel,
}: {
  base: string
  lists: DockLists
  onOpenPanel: (panel: DockPanel) => void
}) {
  const navigate = useNavigate()
  const { decks, quizzes, notes, questions } = lists
  const due = decks.reduce((n, d) => n + d.due, 0)
  const dueDecks = decks.filter((d) => d.due > 0).sort((a, b) => b.due - a.due)
  const another = worthAnotherGo([...quizzes])
  // Newest first: the thing you are most likely to want back is the last thing you asked.
  const outline = [...questions].reverse()

  return (
    <section aria-labelledby="dock-study-label" className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-col gap-2">
        <DockSectionHead id="dock-study-label">Study</DockSectionHead>

        {/* Three ways in, always the same three, with real counts. */}
        <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Open">
          <Count icon="deck" label="Cards" n={decks.reduce((n, d) => n + d.total, 0)} onClick={() => onOpenPanel('flashcards')} />
          <Count icon="quiz" label="Quizzes" n={quizzes.length} onClick={() => onOpenPanel('quizzes')} />
          <Count icon="note" label="Notes" n={notes.length} onClick={() => onOpenPanel('notes')} />
        </div>

        {due > 0 && (
          <Row
            icon="deck"
            title={`${due} card${due === 1 ? '' : 's'} due`}
            sub={dueDecks.length > 1 ? `Across ${dueDecks.length} decks` : dueDecks[0]?.name}
            action="Review"
            strong
            onClick={() => navigate(reviewDeckHref(base, dueDecks[0].id))}
          />
        )}

        {another && (
          <Row
            icon="quiz"
            title={another.topic || 'Quiz'}
            sub={typeof another.best_score === 'number' ? `Best ${Math.round(another.best_score)}%. Worth another go` : 'Not taken yet'}
            action={typeof another.best_score === 'number' ? 'Retake' : 'Take'}
            onClick={() => navigate(quizHref(base, another.id))}
          />
        )}
      </div>

      {/* A long chat is hard to find your way around. This is its contents page:
          what you asked, newest first, one tap to be back at it. */}
      {outline.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="flex items-baseline justify-between text-[11.5px] font-semibold text-ink-3">
            <span>Your questions</span>
            <span className="font-normal text-muted">{outline.length}</span>
          </p>
          <ul
            className="-mx-1 flex max-h-[14rem] flex-col overflow-y-auto overscroll-contain px-1"
            aria-label="Jump to a question in the chat"
          >
            {outline.map((q, i) => (
              <li key={q.id}>
                <button
                  type="button"
                  onClick={() => jumpToQuestion(q.id)}
                  title={q.text}
                  className="group flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-ink-2 transition-colors hover:bg-line-soft hover:text-ink"
                >
                  <span className="w-4 shrink-0 text-right font-mono text-[10.5px] text-faint">{outline.length - i}</span>
                  <span className="min-w-0 flex-1 truncate">{q.text}</span>
                  <Icon name="chevronRight" size={12} className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function Count({ icon, label, n, onClick }: { icon: IconName; label: string; n: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[3.5rem] cursor-pointer flex-col items-start justify-between rounded-[10px] border border-line bg-raised px-2.5 py-2 text-left transition-colors hover:border-ink-3/60"
    >
      <span className="flex w-full items-center justify-between text-ink-3">
        <Icon name={icon} size={14} />
        <Icon name="chevronRight" size={12} className="text-faint" />
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className={cn('nameplate text-[20px] leading-none', n === 0 ? 'text-faint' : 'text-ink')}>{n}</span>
        <span className="text-[11.5px] font-semibold text-muted">{label}</span>
      </span>
    </button>
  )
}

function Row({
  icon,
  title,
  sub,
  action,
  strong = false,
  onClick,
}: {
  icon: IconName
  title: string
  sub?: string
  action: string
  strong?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex min-h-12 cursor-pointer items-center gap-2.5 rounded-[10px] border bg-raised px-2.5 py-2 text-left transition-colors',
        strong ? 'border-ink-3' : 'border-line hover:border-ink-3/60',
      )}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-well text-ink-2">
        <Icon name={icon} size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-bold text-ink">{title}</span>
        {sub && <span className="block truncate text-[11.5px] text-muted">{sub}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1 text-[11.5px] font-bold text-ink-2">
        {action}
        <Icon name="chevronRight" size={12} className="text-faint transition-transform group-hover:translate-x-0.5" />
      </span>
    </button>
  )
}
