/**
 * The dock's first screen: four plain sections, the same for every topic, so a
 * student learns it once.
 *
 *   Your material        the files answers come from, and Add files
 *   Make from this chat  Notes · Quiz · Cards — three buttons, nothing else
 *   Saved here           this topic's notes, quizzes and cards (and what's due)
 *   How I answer         the skill that's on, as one chip, with Change
 *
 * One button on the screen is orange: the one that does the next useful thing
 * (see `dockNext`). Everything else is quiet. Rarely used things — linked
 * topics, the list of questions asked — fold away behind a small row.
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
import { RelatedTopics } from '../spaces/RelatedTopics'
import { AGENT_ICON, AGENT_TONE, type AgentKey } from './agents'
import type { AgentBusy } from './ContextDock'
import { DockSectionHead, Spinner } from './dockParts'
import { nextStep, type Progress } from './dockNext'
import { jumpToQuestion, worthAnotherGo, type DockLists } from './DockInsights'
import { DockSkills } from './DockSkills'
import { DockSources, sourcesState, type SourcesHandle } from './DockSources'
import type { DockPanel } from './DockPanels'

/** The three things a chat can be turned into, with their short names. */
const MAKES: { make: AgentKey; word: string; does: string }[] = [
  { make: 'notes', word: 'Notes', does: 'Save the last answer as a note' },
  { make: 'quiz', word: 'Quiz', does: 'Make a quiz to test yourself' },
  { make: 'flashcards', word: 'Cards', does: 'Turn this into flashcards' },
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
      <header className="flex min-h-[3.25rem] shrink-0 items-center gap-2 border-b border-line py-2 pl-3.5 pr-2">
        <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', dot, files.kind === 'reading' && 'animate-pulse')} />
        <p role="status" className="min-w-0 flex-1 truncate text-[13.5px] font-extrabold text-ink">
          {files.title}
        </p>
        <button
          type="button"
          onClick={() => onOpenPanel('help')}
          className="flex min-h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[12px] font-bold text-ink-2 transition-colors hover:bg-line-soft hover:text-ink"
        >
          <Icon name="help" size={14} /> Help
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overflow-x-hidden px-3.5 pb-4 pt-3.5">
        {/* ── Your material ── */}
        <div className="flex flex-col gap-2">
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
              className="flex min-h-9 cursor-pointer items-center gap-2 rounded-[10px] bg-mint-soft/60 px-3 text-left text-[12.5px] font-semibold text-mint-deep transition-colors hover:bg-mint-soft"
            >
              <Icon name="chat" size={14} className="shrink-0" />
              <span className="flex-1">All set. Ask me anything in the chat.</span>
              <Icon name="arrowLeft" size={13} className="shrink-0" />
            </button>
          )}
          <LinkedTopics subspaceId={subspaceId} />
        </div>

        {/* ── Make from this chat ── */}
        <section aria-labelledby="dock-make-label" className="flex flex-col gap-2">
          <DockSectionHead id="dock-make-label">Make from this chat</DockSectionHead>
          <div className="grid grid-cols-3 gap-2" role="group" aria-labelledby="dock-make-label">
            {MAKES.map(({ make, word, does }) => {
              const working = busy[make] === true
              const lead = next.kind === make && canMake[make] && !working
              return (
                <button
                  key={make}
                  type="button"
                  onClick={() => onRunAgent(make)}
                  disabled={!canMake[make] || working}
                  aria-busy={working || undefined}
                  aria-label={working ? `${word}: making…` : `${word}: ${does.toLowerCase()}`}
                  title={canMake[make] ? does : make === 'notes' ? 'Ready after your first answer' : 'Ready once a file is read'}
                  className={cn(
                    'group flex min-h-[4.75rem] flex-col items-center justify-center gap-1.5 rounded-[12px] border px-1 py-2.5 t-control duration-200',
                    'cursor-pointer disabled:cursor-not-allowed',
                    lead
                      ? 'border-brand bg-brand-tint shadow-[0_6px_18px_-10px_rgba(255,90,60,0.7)] hover:bg-brand-soft'
                      : 'border-line bg-raised hover:border-ink-3/60',
                    !canMake[make] && 'opacity-55 hover:border-line',
                    working && 'cursor-progress',
                  )}
                >
                  <span
                    className={cn(
                      'grid h-9 w-9 place-items-center rounded-[10px] transition-transform',
                      canMake[make] && !working && 'group-hover:-translate-y-0.5',
                      toneSoft[AGENT_TONE[make]],
                      toneText[AGENT_TONE[make]],
                    )}
                  >
                    {working ? <Spinner size={15} /> : <Icon name={AGENT_ICON[make]} size={18} />}
                  </span>
                  <span className="text-[12.5px] font-bold text-ink">{working ? 'Making…' : word}</span>
                </button>
              )
            })}
          </div>
          {makeHint && <p className="text-[11.5px] leading-snug text-muted">{makeHint}</p>}
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
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
  return (
    <section aria-labelledby="dock-saved-label" className="flex flex-col gap-2">
      <DockSectionHead id="dock-saved-label">Saved in this topic</DockSectionHead>
      {nothing && <p className="text-[11.5px] leading-snug text-muted">Nothing yet. What you make shows up here.</p>}
      <ul className="flex flex-col overflow-hidden rounded-[10px] border border-line bg-raised">
        <SavedRow
          icon="note"
          tone="brand"
          label="Notes"
          detail={counts.notes > 0 ? String(counts.notes) : undefined}
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
                  'mr-2 inline-flex min-h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12px] font-bold t-control duration-200',
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
        className="group flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors hover:bg-line-soft"
      >
        <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-md', toneSoft[tone], toneText[tone])}>
          <Icon name={icon} size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold text-ink">{label}</span>
          {/* With a button beside it there's no room on the right, so the count moves under the name. */}
          {(sub || (action && detail)) && (
            <span className="block truncate text-[11.5px] text-muted">{sub ?? detail}</span>
          )}
        </span>
        {!action && (
          <span className={cn('shrink-0 text-[12px] tabular-nums', detail ? 'font-semibold text-ink-3' : 'text-faint')}>
            {detail ?? 'None'}
          </span>
        )}
        <Icon name="chevronRight" size={13} className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5" />
      </button>
      {action}
    </li>
  )
}

/* ── Folded rows ────────────────────────────────────────────────────────── */

/**
 * Other topics the AI also reads from. Rarely changed, so it is one quiet row;
 * the links (and the request that reads them) only load when it is opened.
 */
function LinkedTopics({ subspaceId }: { subspaceId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <Fold open={open} onToggle={() => setOpen((v) => !v)} icon="doc" label="Linked topics" hint="Use notes from another topic too" />
      {open && (
        <div className="flex flex-col gap-1.5 pl-1">
          <RelatedTopics subspaceId={subspaceId} layout="stack" />
        </div>
      )}
    </div>
  )
}

/** A long chat is hard to find your way around: what you asked, newest first. */
function Questions({ questions }: { questions: DockLists['questions'] }) {
  const [open, setOpen] = useState(false)
  if (questions.length === 0) return null
  const outline = [...questions].reverse()
  return (
    <div className="mt-auto flex flex-col gap-1.5 border-t border-line-soft pt-3">
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
                className="group flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-ink-2 transition-colors hover:bg-line-soft hover:text-ink"
              >
                <span className="w-4 shrink-0 text-right font-mono text-[10.5px] text-faint">{outline.length - i}</span>
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
      className="group flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-1.5 text-left transition-colors hover:bg-line-soft"
    >
      <Icon name={icon} size={13} className="shrink-0 text-ink-3" />
      <span className="text-[12.5px] font-bold text-ink-2 group-hover:text-ink">{label}</span>
      {!open && <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">{hint}</span>}
      <Icon
        name="chevronDown"
        size={13}
        className={cn('ml-auto shrink-0 text-faint transition-transform', open && 'rotate-180')}
      />
    </button>
  )
}

/** While the topic's files, chat and work are still arriving. */
function Waiting() {
  return (
    <>
      <div className="flex min-h-[3.25rem] shrink-0 items-center border-b border-line px-3.5">
        <Skeleton className="h-4 w-40 rounded" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-3.5">
        <Skeleton className="h-16 rounded-[10px]" />
        <Skeleton className="h-20 rounded-[10px]" />
        <Skeleton className="h-28 rounded-[10px]" />
      </div>
    </>
  )
}

/** The chat's text box, wherever it is on the page. */
function focusChat() {
  document.querySelector<HTMLTextAreaElement>('[data-chat-input]')?.focus()
}
