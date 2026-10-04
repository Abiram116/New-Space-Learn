/**
 * The dock's first screen. It shows one of two things, depending on what is
 * actually true of the topic — never a story that contradicts the chat beside it.
 *
 * **A new topic** (nothing made yet) gets the three steps, with a thread through
 * them and a ring that counts them off: add a file, ask a question, practice.
 * This is where the app has to explain itself, and where finishing a step is
 * worth a flourish.
 *
 * **A topic in use** gets a calm summary of what is there: its files, the answer
 * style that is on, and what has been made — with the cards that are due
 * called out. No funnel: someone with eight cards and three notes is not being
 * told to "get started".
 *
 * In both, one orange button is pinned at the foot, always saying the next thing
 * to do (see `dockNext`), and Help is one click away at the top.
 *
 * Some choices, because the first version of this got them wrong:
 *  - **One way to do each thing.** Files are added in one box and one button;
 *    the stat tiles open the panels, whose own button makes more, so there is no
 *    third row of "make" buttons repeating them.
 *  - **Say it once.** The headline, the ring, the step marks and the thread all
 *    said how far along you were; now the ring and the marks do, and the words
 *    say only what to do.
 *  - **Motion announces, then rests.** A looping animation is nagging.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Document } from '../../api/types'
import { Icon, type IconName } from '../../components/ui/Icon'
import { Skeleton } from '../../components/ui/Skeleton'
import { cn } from '../../lib/cn'
import { type AgentKey, AGENT_BUSY_LABELS, AGENT_ICON } from './agents'
import type { AgentBusy } from './ContextDock'
import { DockAction, DockSectionHead } from './dockParts'
import { nextStep, novaSays, steps, type Next, type NovaLine, type Progress, type StepStatus } from './dockNext'
import { DockInsights, type DockLists } from './DockInsights'
import { DockSkills } from './DockSkills'
import { DockSources, sourcesState, type SourcesHandle } from './DockSources'
import type { DockPanel } from './DockPanels'

/** What can be made, with the icon each one wears everywhere else. */
const MAKES: { make: AgentKey; word: string }[] = [
  { make: 'notes', word: 'Note' },
  { make: 'flashcards', word: 'Flashcards' },
  { make: 'quiz', word: 'Quiz' },
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
  base,
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
  /** The topic's route prefix, for links into its pages. */
  base: string
  /** What the topic holds, for the study section. */
  lists: DockLists
  docs: Document[]
  docsLoading: boolean
  docsError: string | null
  onDocsChanged: () => void
  counts: DockCounts
  /** Everything this is worked out from has arrived. Until it has, nothing is
   *  shown that might be wrong, and nothing is celebrated: a step that is "done"
   *  because the data just loaded is not one the person just finished. */
  loaded: boolean
  busy: AgentBusy
  onRunAgent: (agent: AgentKey) => void
  onOpenPanel: (panel: DockPanel) => void
  /** Opens the review of the deck with the most due, as a full page. */
  onReviewDue: () => void
}) {
  const sources = useRef<SourcesHandle>(null)
  const files = sourcesState(docs, docsLoading)
  const progress: Progress = { files, ...counts }
  const status = steps(progress)
  const next = nextStep(progress)
  const made = counts.notes + counts.quizzes + counts.decks > 0
  const statuses: StepStatus[] = [status.files, status.ask, status.practice]

  // A step that has just been finished, for a moment. Never on first load.
  const [justDone, setJustDone] = useState<number[]>([])
  const before = useRef<StepStatus[] | null>(null)
  const key = statuses.join()
  useEffect(() => {
    if (!loaded) {
      before.current = null
      return
    }
    const was = before.current
    before.current = statuses
    if (!was) return
    const fresh = statuses.flatMap((s, i) => (s === 'done' && was[i] !== 'done' ? [i] : []))
    if (fresh.length === 0) return
    setJustDone(fresh)
    const t = window.setTimeout(() => setJustDone([]), 1700)
    return () => window.clearTimeout(t)
    // `statuses` is rebuilt every render; `key` is what actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, key])

  const press = () => {
    switch (next.kind) {
      case 'add':
        return sources.current?.choose()
      case 'retry':
        return sources.current?.retryFailed()
      case 'ask':
        return focusChat()
      case 'review':
        return onReviewDue()
      case 'waiting':
        return
      default:
        return onRunAgent(next.kind)
    }
  }

  const common = { subspaceId, base, lists, docs, docsLoading, docsError, onDocsChanged, sources, onOpenPanel, onReviewDue }

  // Hooks first: this must run on every render, loaded or not.
  const grown = useGrown(subspaceId, loaded && made && justDone.length === 0)
  const guideAllowed = useGuideAllowed(subspaceId, loaded && !grown)

  if (!loaded) return <Waiting />

  // A new topic gets the guide; once anything has been made it gets the summary,
  // and keeps it. The guide lingers a moment after the first thing is made so
  // finishing is seen, and the switch is remembered per topic: deleting the
  // note later does not bring the "get started" steps back.
  //
  // And only for the first few topics on this device: the steps teach the app,
  // and by the fourth topic nobody needs them again. A later new topic opens
  // straight into the summary, whose button still says what to do next.
  const guided = !grown && guideAllowed

  return (
    <>
      {guided ? (
        <Guided
          {...common}
          nova={novaSays(progress)}
          statuses={statuses}
          justDone={justDone}
          counts={counts}
          filesReady={files.ready > 0}
          next={next}
          busy={busy}
          onRunAgent={onRunAgent}
        />
      ) : (
        <Summary {...common} title={files.title} kind={files.kind} counts={counts} />
      )}
      <footer className="shrink-0 border-t border-line px-3.5 pb-3.5 pt-3">
        <p className="setcode mb-2">Next step</p>
        <NextButton next={next} busy={busy} onPress={press} />
      </footer>
    </>
  )
}

type Shared = {
  subspaceId: string
  base: string
  lists: DockLists
  docs: Document[]
  docsLoading: boolean
  docsError: string | null
  onDocsChanged: () => void
  sources: React.RefObject<SourcesHandle | null>
  onOpenPanel: (panel: DockPanel) => void
  onReviewDue: () => void
}

function HelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[12px] font-bold text-ink-2 transition-colors hover:bg-line-soft hover:text-ink"
    >
      <Icon name="help" size={14} /> Help
    </button>
  )
}

const GROWN_KEY = 'sl:dock-grown:'

/** True once the topic has outgrown the guide, remembered on this device. */
function useGrown(subspaceId: string, now: boolean): boolean {
  const read = () => {
    try {
      return localStorage.getItem(GROWN_KEY + subspaceId) === '1'
    } catch {
      return false
    }
  }
  const [stored, setStored] = useState(read)
  useEffect(() => setStored(read()), [subspaceId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!now || stored) return
    try {
      localStorage.setItem(GROWN_KEY + subspaceId, '1')
    } catch {
      /* private mode: it just won't be remembered */
    }
    setStored(true)
  }, [now, stored, subspaceId])
  return stored || now
}

const GUIDED_KEY = 'sl:dock-guided'
/** How many topics get the step-by-step guide before the summary takes over for good. */
export const GUIDED_TOPICS = 3

function readGuided(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(GUIDED_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/**
 * Whether this topic may show the guide: it already has, or fewer than
 * `GUIDED_TOPICS` topics have. A topic only takes one of the places when the
 * guide is actually on screen (`active`), so opening old topics doesn't use
 * them up. Remembered on this device, like the "outgrown" flag above.
 */
function useGuideAllowed(subspaceId: string, active: boolean): boolean {
  const [allowed, setAllowed] = useState(() => {
    const list = readGuided()
    return list.includes(subspaceId) || list.length < GUIDED_TOPICS
  })
  useEffect(() => {
    const list = readGuided()
    if (list.includes(subspaceId)) return setAllowed(true)
    if (list.length >= GUIDED_TOPICS) return setAllowed(false)
    setAllowed(true)
    if (!active) return
    try {
      localStorage.setItem(GUIDED_KEY, JSON.stringify([...list, subspaceId]))
    } catch {
      /* private mode: the guide may show again, which is harmless */
    }
  }, [subspaceId, active])
  return allowed
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
        <Skeleton className="h-11 rounded-[10px]" />
        <Skeleton className="h-16 rounded-[10px]" />
      </div>
    </>
  )
}

/* ── A topic in use ─────────────────────────────────────────────────────── */

function Summary({
  title,
  kind,
  counts,
  ...s
}: Shared & { title: string; kind: string; counts: DockCounts }) {
  const dot = kind === 'ready' ? 'bg-mint' : kind === 'failed' ? 'bg-coral' : 'bg-sun'
  return (
    <>
      <header className="flex min-h-[3.75rem] shrink-0 items-center gap-2 border-b border-line py-2 pl-2.5 pr-2">
        <div className="flex min-w-0 flex-1 items-start gap-2 pl-1">
          <span aria-hidden className={cn('mt-[7px] h-2 w-2 shrink-0 rounded-full', dot, kind === 'reading' && 'animate-pulse')} />
          <div className="min-w-0">
            <p className="line-clamp-2 text-[14px] font-extrabold leading-tight text-ink">{title}</p>
            {kind === 'none' && <p className="text-[11.5px] leading-snug text-muted">Add one to get answers with page numbers.</p>}
          </div>
        </div>
        <HelpButton onClick={() => s.onOpenPanel('help')} />
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden p-3.5">
        <DockSources
          ref={s.sources}
          subspaceId={s.subspaceId}
          docs={s.docs}
          loading={s.docsLoading}
          error={s.docsError}
          onChanged={s.onDocsChanged}
          compactEmpty
          listenForAdd
          limit={SOURCES_SHOWN}
          onSeeAll={() => s.onOpenPanel('docs')}
          onManage={() => s.onOpenPanel('docs')}
        />

        <DockSkills subspaceId={s.subspaceId} />

        <DockInsights base={s.base} lists={s.lists} onOpenPanel={s.onOpenPanel} />
      </div>
    </>
  )
}

/* ── A new topic ────────────────────────────────────────────────────────── */

function Guided({
  nova,
  statuses,
  justDone,
  counts,
  filesReady,
  next,
  busy,
  onRunAgent,
  ...s
}: Shared & {
  nova: NovaLine
  statuses: StepStatus[]
  justDone: number[]
  counts: DockCounts
  filesReady: boolean
  next: Next
  busy: AgentBusy
  onRunAgent: (agent: AgentKey) => void
}) {
  // Each one waits for what it actually needs: a note is written from an answer;
  // cards and a quiz are written from a file that has been read.
  const canMake: Record<AgentKey, boolean> = {
    notes: counts.asked > 0,
    flashcards: filesReady,
    quiz: filesReady,
  }
  const waitingFor: Record<AgentKey, string> = {
    notes: 'after your first answer',
    flashcards: 'after your file is read',
    quiz: 'after your file is read',
  }
  return (
    <>
      <header className="flex min-h-[5.25rem] shrink-0 items-center gap-2 border-b border-line py-2.5 pl-3 pr-2">
        <p role="status" className="min-w-0 flex-1 pl-1 text-[13.5px] font-bold leading-snug text-ink">
          {nova.line}
        </p>
        <HelpButton onClick={() => s.onOpenPanel('help')} />
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden p-3.5">
        <ol className="flex min-h-0 flex-1 flex-col">
          <Step n={1} index={0} title="Add a file" status={statuses[0]} celebrate={justDone.includes(0)}>
            <DockSources
              ref={s.sources}
              subspaceId={s.subspaceId}
              docs={s.docs}
              loading={s.docsLoading}
              error={s.docsError}
              onChanged={s.onDocsChanged}
              bare
              compactEmpty
              listenForAdd
              limit={SOURCES_SHOWN}
              onSeeAll={() => s.onOpenPanel('docs')}
            />
          </Step>

          <Step n={2} index={1} title="Ask a question" status={statuses[1]} celebrate={justDone.includes(1)}>
            {statuses[1] === 'current' ? (
              <div className="flex items-center gap-3 rounded-[10px] border border-line bg-well px-3 py-2.5">
                <p className="flex-1 text-[12px] leading-snug text-muted">
                  In the chat on the left. Each answer shows the page it came from.
                </p>
                <span aria-hidden className="flex shrink-0 gap-1 text-ink-3">
                  {[0, 1, 2].map((i) => (
                    <i key={i} className="dock-dot" style={{ animationDelay: `${i * 160}ms` }} />
                  ))}
                </span>
              </div>
            ) : (
              <p className="text-[12px] leading-snug text-muted">
                {counts.asked > 0
                  ? `You’ve asked ${counts.asked}. Keep going in the chat.`
                  : 'In the chat on the left. Each answer shows the page it came from.'}
              </p>
            )}
          </Step>

          <Step
            n={3}
            index={2}
            title="Practice"
            status={statuses[2]}
            celebrate={justDone.includes(2)}
            last
          >
            <p className="mb-2 text-[12px] leading-snug text-muted">
              {canMake.flashcards ? 'What do you want to make?' : 'Ready once your file is read.'}
            </p>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Make something">
              {MAKES.map(({ make, word }) => {
                const working = busy[make] === true
                return (
                  <button
                    key={make}
                    type="button"
                    onClick={() => onRunAgent(make)}
                    disabled={!canMake[make] || working}
                    aria-busy={working || undefined}
                    title={canMake[make] ? undefined : `Ready ${waitingFor[make]}`}
                    className={cn(
                      'flex min-h-[5.5rem] cursor-pointer flex-col items-center justify-center gap-2 rounded-[12px] border bg-raised px-1 py-3 transition-colors',
                      'hover:border-brand/40 disabled:cursor-not-allowed',
                      canMake[make] && next.kind === make ? 'border-ink-3' : 'border-line',
                      working && 'cursor-progress border-ink-3',
                    )}
                  >
                    <span
                      className={cn(
                        'grid h-10 w-10 place-items-center rounded-xl bg-well text-ink-2 ring-1 ring-line-soft',
                        !canMake[make] && 'opacity-50',
                        working && 'animate-pulse',
                      )}
                    >
                      <Icon name={AGENT_ICON[make]} size={20} />
                    </span>
                    <span className={cn('text-[12px] font-bold', canMake[make] ? 'text-ink' : 'text-muted')}>
                      {working ? 'Making…' : word}
                    </span>
                  </button>
                )
              })}
            </div>
            {filesReady && !canMake.notes && (
              <p className="mt-2 text-[11.5px] leading-snug text-muted">Note is ready after your first answer.</p>
            )}
          </Step>
        </ol>

        {/* "Answer style" means nothing before the first question; it appears with it. */}
        {counts.asked > 0 && <DockSkills subspaceId={s.subspaceId} />}
      </div>
    </>
  )
}

/* ── The main button ────────────────────────────────────────────────────── */

function NextButton({ next, busy, onPress }: { next: Next; busy: AgentBusy; onPress: () => void }) {
  const make = next.kind === 'notes' || next.kind === 'quiz' || next.kind === 'flashcards' ? next.kind : null
  const working = make ? busy[make] === true : false
  const icon: IconName =
    next.kind === 'add'
      ? 'upload'
      : next.kind === 'retry'
        ? 'refresh'
        : next.kind === 'ask'
          ? 'chat'
          : next.kind === 'review'
            ? 'deck'
            : next.kind === 'waiting'
              ? 'clock'
              : AGENT_ICON[make ?? 'notes']
  return (
    <DockAction
      icon={icon}
      onClick={onPress}
      disabled={next.disabled}
      busy={working}
      busyLabel={make ? AGENT_BUSY_LABELS[make] : undefined}
      className={next.disabled ? 'bg-raised text-muted' : working ? undefined : 'dock-breathe'}
    >
      {/* Keyed on the words: when the next step changes, the new label arrives
          instead of silently replacing the old one. */}
      <span key={next.label} className="dock-swap">
        {next.label}
      </span>
    </DockAction>
  )
}

/** The chat's text box, wherever it is on the page. */
function focusChat() {
  document.querySelector<HTMLTextAreaElement>('[data-chat-input]')?.focus()
}

/* ── One step, on the thread ────────────────────────────────────────────── */

function Step({
  n,
  index,
  title,
  status,
  celebrate,
  last = false,
  children,
}: {
  n: number
  index: number
  title: string
  status: StepStatus
  celebrate: boolean
  last?: boolean
  children: ReactNode
}) {
  return (
    <li
      aria-current={status === 'current' ? 'step' : undefined}
      className={cn('dock-in relative grid grid-cols-[28px_minmax(0,1fr)] gap-x-3', last && 'min-h-0 flex-1')}
      style={{ animationDelay: `${index * 90}ms` }}
    >
      <div className="flex flex-col items-center">
        <Mark n={n} status={status} celebrate={celebrate} />
        {!last && (
          <span aria-hidden className="mt-1.5 w-[2px] flex-1 overflow-hidden rounded-full bg-line">
            <span
              key={status === 'done' ? 'full' : 'empty'}
              className={cn('block h-full w-full bg-mint/60', status === 'done' ? 'dock-fill' : 'scale-y-0')}
            />
          </span>
        )}
      </div>
      <div className={cn('min-w-0', last ? 'flex min-h-0 flex-col pb-0' : 'pb-5', status === 'todo' && 'opacity-60')}>
        <h3 className={cn('mb-1.5 flex min-h-7 items-center text-[14px] font-extrabold', status === 'todo' ? 'text-ink-2' : 'text-ink')}>
          {title}
        </h3>
        {children}
      </div>
    </li>
  )
}

const SPARKS: [number, number][] = [
  [0, -24],
  [21, -12],
  [21, 12],
  [0, 24],
  [-21, 12],
  [-21, -12],
]

function Sparks() {
  return (
    <>
      {SPARKS.map(([dx, dy], i) => (
        <span
          key={i}
          aria-hidden
          className={cn('dock-spark pointer-events-none absolute left-1/2 top-1/2 -ml-[2.5px] -mt-[2.5px] h-[5px] w-[5px] rounded-full', i % 2 ? 'bg-sun' : 'bg-mint')}
          style={{ '--dx': `${dx}px`, '--dy': `${dy}px`, animationDelay: `${i * 25}ms` } as CSSProperties}
        />
      ))}
    </>
  )
}

function Mark({ n, status, celebrate }: { n: number; status: StepStatus; celebrate: boolean }) {
  const base = 'relative grid h-7 w-7 shrink-0 place-items-center rounded-full'
  if (status === 'done')
    return (
      <span className={cn(base, 'bg-mint-soft text-mint-deep ring-1 ring-mint/40', celebrate && 'dock-pop')}>
        <Icon name="check" size={15} />
        <span className="sr-only">Done</span>
        {celebrate && <Sparks />}
      </span>
    )
  if (status === 'problem')
    return (
      <span className={cn(base, 'bg-coral text-[#2a0d0a]')}>
        <Icon name="alert" size={14} />
        <span className="sr-only">Needs attention</span>
      </span>
    )
  if (status === 'current')
    return (
      <span className={cn(base, 'dock-ring bg-ink font-mono text-[11px] font-bold text-canvas')}>{n}</span>
    )
  return (
    <span className={cn(base, 'border border-line-dash bg-surface font-mono text-[11px] font-bold text-ink-3')}>{n}</span>
  )
}
