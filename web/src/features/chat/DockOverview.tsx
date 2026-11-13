/**
 * The dock's first screen: four plain sections, the same for every topic, so a
 * student learns it once.
 *
 *   Your material        the files answers come from, and Add files — with
 *                        the topics linked to this one drawn as a small map
 *   Make from this chat  Notes · Quiz · Cards — three tiles that say, when
 *                        they can't be pressed yet, what they are waiting for
 *   Saved here           this topic's notes, quizzes and cards (and what's due)
 *   How I answer         the skill that's on, as one chip, with Change
 *
 * One button on the screen is orange: the one that does the next useful thing
 * (see `dockNext`). Everything else is quiet. The list of questions asked
 * folds away behind a small row.
 *
 * An earlier version had two layouts (a step-by-step guide for new topics, a
 * summary for busy ones). Two layouts meant two things to learn, and the step
 * list took over the whole column. One layout whose empty states say what to
 * do next does the guide's job in a line each.
 */

import { useRef, useState } from 'react'
import type { Document } from '../../api/types'
import { Icon, type IconName } from '../../components/ui/Icon'
import { Skeleton } from '../../components/ui/Skeleton'
import { cn } from '../../lib/cn'
import { toneSoft, toneText } from '../../lib/tone'
import { AGENT_ICON, AGENT_TONE, type AgentKey } from './agents'
import type { AgentBusy } from './ContextDock'
import { DockSectionHead, Spinner } from './dockParts'
import { DockLinkedTopics } from './DockLinkedTopics'
import { nextStep, type Progress } from './dockNext'
import { jumpToQuestion, worthAnotherGo, type DockLists } from './DockInsights'
import { DockSkills } from './DockSkills'
import { DockSources, sourcesState, type SourcesHandle } from './DockSources'
import type { DockPanel } from './DockPanels'

/** The three things a chat can be turned into, with their short names. */
const MAKES: { make: AgentKey; word: string; does: string; ready: string; blocked: string }[] = [
  { make: 'notes', word: 'Notes', does: 'Save the last answer as a note', ready: 'Save last answer', blocked: 'After an answer' },
  { make: 'quiz', word: 'Quiz', does: 'Make a quiz to test yourself', ready: 'Test yourself', blocked: 'Needs a file' },
  { make: 'flashcards', word: 'Cards', does: 'Turn this into flashcards', ready: 'Practise recall', blocked: 'Needs a file' },
]

/** How many files are listed before pointing at the rest. */
const SOURCES_SHOWN = 3

export type DockCounts = Pick<Progress, 'asked' | 'notes' | 'quizzes' | 'decks' | 'due'> & {
  /** Cards across all the topic's decks. */
  cards: number
  /** Quizzes never taken, or last taken under 80% — the ones worth a go. */
  quizToTake: number
}

export function DockOverview({
  subspaceId,
  lists,
  docs,
  docsLoading,
  docsError,
  onDocsChanged,
  counts,
  loaded,
  busy,
  onRunAgent,
  onOpenPanel,
  onReviewDue,
}: {
  subspaceId: string
  /** What the topic holds, for the saved section and the questions list. */
  lists: DockLists
  docs: Document[]
  docsLoading: boolean
  docsError: string | null
  onDocsChanged: () => void
  counts: DockCounts
  /** Everything this is worked out from has arrived. Until it has, nothing is
   *  shown that might be wrong. */
  loaded: boolean
  busy: AgentBusy
  onRunAgent: (agent: AgentKey) => void
  onOpenPanel: (panel: DockPanel) => void
  /** Opens the review of the deck with the most due, as a full page. */
  onReviewDue: () => void
}) {
  const sources = useRef<SourcesHandle>(null)
  const files = sourcesState(docs, docsLoading)
  const next = nextStep({ files, ...counts })

  if (!loaded) return <Waiting />

  const filesReady = files.ready > 0
  // Each one waits for what it needs: a note is written from an answer; cards
  // and a quiz are written from a file that has been read.
  const canMake: Record<AgentKey, boolean> = {
    notes: counts.asked > 0,
    flashcards: filesReady,
    quiz: filesReady,
  }
  const makeHint = !filesReady
    ? 'Add a file first. Then turn what you learn into practice.'
    : counts.asked === 0
      ? 'Quiz and Cards are ready. Notes come from your first answer.'
      : null

  const dot = files.kind === 'ready' ? 'bg-mint' : files.kind === 'failed' ? 'bg-coral' : files.kind === 'none' ? 'bg-faint' : 'bg-sun'

  return (
    <>
      <header className="flex min-h-14 shrink-0 items-center gap-2.5 border-b border-line py-2 pl-4 pr-2">
        <span aria-hidden className={cn('h-2.5 w-2.5 shrink-0 rounded-full', dot, files.kind === 'reading' && 'animate-pulse')} />
        <p role="status" className="min-w-0 flex-1 truncate text-[15px] font-extrabold text-ink">
          {files.title}
        </p>
        <button
          type="button"
          onClick={() => onOpenPanel('help')}
          className="flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13.5px] font-bold text-ink-2 transition-colors hover:bg-line-soft hover:text-ink"
        >
          <Icon name="help" size={16} /> Help
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto overflow-x-hidden px-4 pb-5 pt-4">
        {/* ── Your material ── */}
        <div className="flex flex-col gap-3">
          <DockSources
            ref={sources}
            subspaceId={subspaceId}
            docs={docs}
            loading={docsLoading}
            error={docsError}
            onChanged={onDocsChanged}
            listenForAdd
            limit={SOURCES_SHOWN}
            onSeeAll={() => onOpenPanel('docs')}
            addButton={next.kind === 'add' ? 'primary' : 'quiet'}
          />
          {next.kind === 'ask' && (
            <button
              type="button"
              onClick={focusChat}
              className="flex min-h-12 cursor-pointer items-center gap-2.5 rounded-[12px] bg-mint-soft/70 px-3.5 text-left text-[14px] font-semibold text-mint-deep transition-colors hover:bg-mint-soft"
            >
              <Icon name="chat" size={17} className="shrink-0" />
              <span className="flex-1">All set. Ask me anything in the chat.</span>
              <Icon name="arrowLeft" size={15} className="shrink-0" />
            </button>
          )}
        </div>

        {/* ── Linked topics: part of "your material", drawn as a small map ── */}
        <DockLinkedTopics subspaceId={subspaceId} />

        {/* ── Make from this chat ── */}
        <section aria-labelledby="dock-make-label" className="flex flex-col gap-2.5">
          <DockSectionHead id="dock-make-label">Make from this chat</DockSectionHead>
          <div className="grid grid-cols-3 gap-2" role="group" aria-labelledby="dock-make-label">
            {MAKES.map(({ make, word, does, ready, blocked }) => {
              const working = busy[make] === true
              const can = canMake[make]
              const lead = next.kind === make && can && !working
              return (
                <button
                  key={make}
                  type="button"
                  onClick={() => onRunAgent(make)}
                  disabled={!can || working}
                  aria-busy={working || undefined}
                  aria-label={working ? `${word}: making…` : can ? `${word}: ${does.toLowerCase()}` : `${word}: ${blocked.toLowerCase()}`}
                  title={can ? does : make === 'notes' ? 'Ready after your first answer' : 'Ready once a file is read'}
                  className={cn(
                    'group relative flex min-h-[7.25rem] flex-col items-center justify-center gap-1.5 rounded-[14px] border px-1.5 pb-3 pt-3.5 text-center t-control duration-200',
                    'cursor-pointer disabled:cursor-not-allowed',
                    !can
                      ? 'border-dashed border-line-dash bg-transparent'
                      : lead
                        ? 'border-brand bg-brand-tint shadow-[0_8px_22px_-12px_rgba(255,90,60,0.75)] hover:-translate-y-0.5 hover:bg-brand-soft'
                        : 'cardstock hover:-translate-y-0.5 hover:border-ink-3/50',
                    working && 'cursor-progress',
                  )}
                >
                  <span
                    className={cn(
                      'grid h-11 w-11 place-items-center rounded-[12px] transition-transform',
                      can && !working && 'group-hover:scale-105',
                      can ? `${toneSoft[AGENT_TONE[make]]} ${toneText[AGENT_TONE[make]]}` : 'bg-line-soft text-faint',
                    )}
                  >
                    {working ? (
                      <Spinner size={18} />
                    ) : can ? (
                      <Icon name={AGENT_ICON[make]} size={21} />
                    ) : (
                      <Icon name="lock" size={17} />
                    )}
                  </span>
                  <span className={cn('text-[15px] font-bold leading-tight', can ? 'text-ink' : 'text-ink-3')}>
                    {working ? 'Making…' : word}
                  </span>
                  <span
                    className={cn(
                      'text-[12px] font-medium leading-tight',
                      !can ? 'text-faint' : lead ? 'text-brand-deep' : 'text-muted',
                    )}
                  >
                    {working ? 'One moment' : can ? ready : blocked}
                  </span>
                </button>
              )
            })}
          </div>
          {makeHint && <p className="text-[13px] leading-snug text-muted">{makeHint}</p>}
        </section>

        {/* ── Saved here ── */}
        <Saved lists={lists} counts={counts} leadReview={next.kind === 'review'} onOpenPanel={onOpenPanel} onReviewDue={onReviewDue} />

        {/* ── How I answer ── */}
        <DockSkills subspaceId={subspaceId} />

        {/* ── Your questions (folded) ── */}
        <Questions questions={lists.questions} />
      </div>
    </>
  )
}

/* ── Saved here ─────────────────────────────────────────────────────────── */

function Saved({
  lists,
  counts,
  leadReview,
  onOpenPanel,
  onReviewDue,
}: {
  lists: DockLists
  counts: DockCounts
  leadReview: boolean
  onOpenPanel: (panel: DockPanel) => void
  onReviewDue: () => void
}) {
  const nothing = counts.notes + counts.quizzes + counts.decks === 0
  const retake = worthAnotherGo([...lists.quizzes])
  const latestNote = [...lists.notes]
    .filter((n) => n.title)
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))[0]?.title
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
  return (
    <section aria-labelledby="dock-saved-label" className="flex flex-col gap-2.5">
      <DockSectionHead id="dock-saved-label">Saved in this topic</DockSectionHead>
      {nothing && <p className="text-[13px] leading-snug text-muted">Nothing yet. What you make shows up here.</p>}
      <ul className="cardstock flex flex-col overflow-hidden rounded-[14px]">
        <SavedRow
          icon="note"
          tone="brand"
          label="Notes"
          detail={counts.notes > 0 ? String(counts.notes) : undefined}
          sub={latestNote ? `Latest: ${latestNote}` : undefined}
          onOpen={() => onOpenPanel('notes')}
        />
        <SavedRow
          icon="quiz"
          tone="sky"
          label="Quizzes"
          detail={counts.quizzes > 0 ? String(counts.quizzes) : undefined}
          sub={retake ? (typeof retake.best_score === 'number' ? `${retake.topic || 'One'} is worth another go` : `${retake.topic || 'One'} isn’t taken yet`) : undefined}
          onOpen={() => onOpenPanel('quizzes')}
        />
        <SavedRow
          icon="deck"
          tone="sun"
          label="Flashcards"
          detail={counts.cards > 0 ? plural(counts.cards, 'card') : undefined}
          onOpen={() => onOpenPanel('flashcards')}
          action={
            counts.due > 0 ? (
              <button
                type="button"
                onClick={onReviewDue}
                className={cn(
                  'mr-3 inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-[13.5px] font-bold t-control duration-200',
                  leadReview
                    ? 'bg-brand text-[#1a120f] hover:brightness-110'
                    : 'bg-sun-soft text-sun-deep hover:brightness-125',
                )}
              >
                Review {counts.due} due
              </button>
            ) : undefined
          }
        />
      </ul>
    </section>
  )
}

function SavedRow({
  icon,
  tone,
  label,
  detail,
  sub,
  action,
  onOpen,
}: {
  icon: IconName
  tone: 'brand' | 'sky' | 'sun'
  label: string
  detail?: string
  sub?: string
  action?: React.ReactNode
  onOpen: () => void
}) {
  return (
    <li className="flex items-center border-b border-line-soft last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        aria-label={detail ? `${label}, ${detail}` : label}
        className="group flex min-h-[3.75rem] min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-line-soft"
      >
        <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-[10px]', toneSoft[tone], toneText[tone])}>
          <Icon name={icon} size={19} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold leading-snug text-ink">{label}</span>
          {/* With a button beside it there's no room on the right, so the count moves under the name. */}
          {(sub || (action && detail)) && (
            <span className="mt-0.5 block truncate text-[13px] leading-snug text-muted">{sub ?? detail}</span>
          )}
        </span>
        {!action && (
          <span
            className={cn(
              'shrink-0 rounded-full px-2.5 py-0.5 text-[13px] tabular-nums',
              detail ? 'bg-line-soft font-bold text-ink-2' : 'text-faint',
            )}
          >
            {detail ?? 'None'}
          </span>
        )}
        <Icon name="chevronRight" size={16} className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5" />
      </button>
      {action}
    </li>
  )
}

/* ── Folded rows ────────────────────────────────────────────────────────── */

/** A long chat is hard to find your way around: what you asked, newest first. */
function Questions({ questions }: { questions: DockLists['questions'] }) {
  const [open, setOpen] = useState(false)
  if (questions.length === 0) return null
  const outline = [...questions].reverse()
  return (
    <div className="mt-auto flex flex-col gap-1.5 border-t border-line-soft pt-4">
      <Fold
        open={open}
        onToggle={() => setOpen((v) => !v)}
        icon="chat"
        label={`Your questions · ${questions.length}`}
        hint="Jump back to one"
      />
      {open && (
        <ul className="-mx-1 flex max-h-[14rem] flex-col overflow-y-auto overscroll-contain px-1" aria-label="Jump to a question in the chat">
          {outline.map((q, i) => (
            <li key={q.id}>
              <button
                type="button"
                onClick={() => jumpToQuestion(q.id)}
                title={q.text}
                className="group flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[14px] text-ink-2 transition-colors hover:bg-line-soft hover:text-ink"
              >
                <span className="w-5 shrink-0 text-right text-[12.5px] font-semibold tabular-nums text-faint">{outline.length - i}</span>
                <span className="min-w-0 flex-1 truncate">{q.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Fold({
  open,
  onToggle,
  icon,
  label,
  hint,
}: {
  open: boolean
  onToggle: () => void
  icon: IconName
  label: string
  hint: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="group flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 text-left transition-colors hover:bg-line-soft"
    >
      <Icon name={icon} size={16} className="shrink-0 text-ink-3" />
      <span className="text-[14px] font-bold text-ink-2 group-hover:text-ink">{label}</span>
      {!open && <span className="min-w-0 flex-1 truncate text-[13px] text-faint">{hint}</span>}
      <Icon
        name="chevronDown"
        size={16}
        className={cn('ml-auto shrink-0 text-faint transition-transform', open && 'rotate-180')}
      />
    </button>
  )
}

/** While the topic's files, chat and work are still arriving. */
function Waiting() {
  return (
    <>
      <div className="flex min-h-14 shrink-0 items-center border-b border-line px-4">
        <Skeleton className="h-5 w-44 rounded" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 p-4">
        <Skeleton className="h-20 rounded-[12px]" />
        <Skeleton className="h-28 rounded-[14px]" />
        <Skeleton className="h-44 rounded-[14px]" />
      </div>
    </>
  )
}

/** The chat's text box, wherever it is on the page. */
function focusChat() {
  document.querySelector<HTMLTextAreaElement>('[data-chat-input]')?.focus()
}
