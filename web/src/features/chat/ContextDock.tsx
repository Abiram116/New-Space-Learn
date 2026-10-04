/**
 * The right dock: where you are in Space Learn, and what to do next.
 *
 * Its first screen is a three-step checklist — add a file, ask a question,
 * practise — with the next step as one orange button pinned at the bottom (see
 * `DockOverview`). Files, Notes, Quizzes, Cards and Help open as panels over it,
 * each with its own main button in the same place.
 *
 * The two AI concepts keep different shapes, because naming them differently
 * was not enough:
 *
 *   Skills — cards with a switch. A stack you equip; each is a voice that stays
 *            on and changes how every answer is written.
 *   Agents — buttons. One-shot actions that hand you an artifact and finish.
 */

import { useEffect, useState } from 'react'
import { listDocuments } from '../../api/documents'
import { listDecks } from '../../api/flashcards'
import { listNotes } from '../../api/notes'
import { listQuizzes } from '../../api/quizzes'
import { listActiveSkills } from '../../api/skills'
import { useAsync } from '../../lib/useAsync'
import { Modal } from '../../components/ui/Modal'
import { DockSkills } from './DockSkills'
import { Spinner } from './dockParts'
import { DockOverview } from './DockOverview'
import { DockPanelBody, type DockPanel } from './DockPanels'
import { useDockPanelMotion } from './useDockPanelMotion'
import { useDockWidth } from './useDockWidth'
import { cn } from '../../lib/cn'
import { toneSoft, toneText } from '../../lib/tone'
import { Icon } from '../../components/ui/Icon'
import {
  AGENT_BUSY_LABELS,
  AGENT_ICON,
  AGENT_LABELS,
  AGENT_TONE,
  type AgentKey,
} from './agents'

/** Which agents have a request in flight; absent means none do. */
export type AgentBusy = Partial<Record<AgentKey, boolean>>

const AGENTS: AgentKey[] = ['notes', 'flashcards', 'quiz']

/**
 * The dock is `lg:`-only, and below that breakpoint nothing said which Skill
 * was rewriting every answer — the tutor's voice changed with no visible
 * cause. This strip is that one missing fact, sat directly above the composer.
 *
 * Skills only, by design — see `ActiveAgentsStrip` below for the dock's other
 * half (Notes/Quiz/Flashcards) at this width. Kept as two components rather
 * than merged into one, because they answer different questions: this one is
 * status ("here's what's on"), that one is actions ("here's what you can
 * do") — collapsing them would blur exactly the Skills-vs-Agents distinction
 * the rest of the product goes out of its way to keep separate (see
 * `agents.ts`).
 */
export function ActiveSkillStrip({ subspaceId }: { subspaceId: string }) {
  // Not under a shared cache key: the API client clears every `skills:` entry
  // after a skill is turned on or off, which would blank this strip. It is
  // re-read when the dialog closes instead.
  const skills = useAsync(() => listActiveSkills(subspaceId), [subspaceId])
  const [open, setOpen] = useState(false)
  const refreshSkills = skills.refresh

  if (skills.loading || skills.error) return null
  const list = skills.data ?? []

  // Below `lg:` there is no dock, so turning a skill on or off opens the same
  // section in a dialog — one implementation, two places to reach it.
  const change = (label: string) => (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="setcode ml-auto shrink-0 cursor-pointer font-bold text-brand-deep"
    >
      {label}
    </button>
  )

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-t border-line bg-surface px-5 py-2 lg:hidden">
        {list.length === 0 ? (
          <>
            <span className="setcode shrink-0">No skill on</span>
            {change('Turn one on')}
          </>
        ) : (
          <>
            <span className="setcode shrink-0">Skills on</span>
            {list.map((skill) => (
              <span
                key={skill.id}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-bold',
                  toneSoft[skill.tone],
                  toneText[skill.tone],
                )}
              >
                <Icon name="skill" size={12} />
                {skill.name}
              </span>
            ))}
            {change('Change')}
          </>
        )}
      </div>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false)
          refreshSkills()
        }}
        title="Skills for this topic"
      >
        <DockSkills subspaceId={subspaceId} />
      </Modal>
    </>
  )
}

/**
 * The dock's "Do something with this" section, at the one width the dock
 * itself doesn't reach.
 *
 * Below `lg:` there was no way to generate a note, quiz, or deck from the
 * conversation at all — a composer pill row that used to cover this was
 * removed on the assumption the dock replaced it everywhere, but the dock is
 * `lg:`-only, so below that width the assumption was simply wrong. Same three
 * actions, same `AGENTS`/`onRunAgent` the dock and the composer's typed
 * `/notes` `/quiz` `/flashcards` shortcuts already use — no new action logic,
 * only a second surface for the existing one.
 */
export function ActiveAgentsStrip({
  onRunAgent,
  busy = {},
}: {
  onRunAgent: (agent: AgentKey) => void
  busy?: AgentBusy
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-t border-line bg-surface px-5 py-2 lg:hidden">
      <span className="setcode shrink-0">Make something</span>
      {AGENTS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onRunAgent(key)}
          disabled={busy[key]}
          aria-busy={busy[key] || undefined}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-bold transition-colors cursor-pointer',
            toneSoft[AGENT_TONE[key]],
            toneText[AGENT_TONE[key]],
            'hover:brightness-95 disabled:cursor-progress disabled:hover:brightness-100',
          )}
        >
          {busy[key] ? <Spinner /> : <Icon name={AGENT_ICON[key]} size={12} />}
          {busy[key] ? AGENT_BUSY_LABELS[key] : AGENT_LABELS[key]}
        </button>
      ))}
    </div>
  )
}

export function ContextDock({
  subspaceId,
  base,
  onRunAgent,
  busy = {},
  panel,
  onClosePanel,
  onOpenPanel,
  questionsAsked = 0,
}: {
  subspaceId: string
  base: string
  onRunAgent: (agent: AgentKey) => void
  busy?: AgentBusy
  /** Which workspace panel is open, or null for the overview. */
  panel: DockPanel
  onClosePanel: () => void
  /** Opens a panel from the overview (the files list, Help). */
  onOpenPanel: (panel: DockPanel) => void
  /** How many questions have been sent in this topic's chat; `null` while the
   *  chat is still loading, so nothing is mistaken for progress. */
  questionsAsked?: number | null
}) {
  const docs = useAsync(() => listDocuments(subspaceId), [subspaceId], `docs:${subspaceId}`)
  const {
    width,
    ref: dockRef,
    dragging: resizing,
    onPointerDown,
    onKeyDown,
  } = useDockWidth()

  const view = useDockPanelMotion(panel)

  const docList = docs.data ?? []

  // What has been made so far, for the checklist's third step and the main
  // button. The same cache keys the panels use, so opening one costs nothing.
  const notes = useAsync(() => listNotes(subspaceId), [subspaceId], `notes:${subspaceId}`)
  const quizzes = useAsync(() => listQuizzes(subspaceId), [subspaceId], `quizzes:${subspaceId}`)
  const decks = useAsync(() => listDecks(subspaceId), [subspaceId], `decks:${subspaceId}`)
  const counts = {
    asked: questionsAsked ?? 0,
    notes: notes.data?.length ?? 0,
    quizzes: quizzes.data?.length ?? 0,
    decks: decks.data?.length ?? 0,
    cards: (decks.data ?? []).reduce((n, d) => n + d.total, 0),
    due: (decks.data ?? []).reduce((n, d) => n + d.due, 0),
  }
  const loaded =
    questionsAsked !== null && !docs.loading && !notes.loading && !quizzes.loading && !decks.loading

  // Uploads are ingested in the background now, so a new source arrives here
  // as `processing`. Re-check until it's ready — re-armed by each new `data`.
  const refreshDocs = docs.refresh
  const docsPending = docList.some((d) => d.status === 'processing' || d.status === 'uploading')
  useEffect(() => {
    if (!docsPending) return
    const t = window.setTimeout(refreshDocs, 4000)
    return () => window.clearTimeout(t)
  }, [docsPending, docs.data, refreshDocs])

  return (
    <aside
      ref={dockRef as React.RefObject<HTMLElement>}
      style={{ width }}
      className={cn(
        'relative hidden shrink-0 flex-col border-l border-line bg-surface lg:flex',
        // No width transition while dragging, or the panel lags the pointer.
        !resizing && 'transition-[width] duration-200 ease-out',
      )}
    >
      {/* Drag to resize. A wide hit area over a hairline rule: the rule is
          what you see, the 9px is what you can actually grab. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        className={cn(
          'absolute inset-y-0 -left-1 z-30 w-2.5 cursor-col-resize',
          'after:absolute after:inset-y-0 after:left-1 after:w-px after:transition-colors',
          resizing ? 'after:bg-brand' : 'after:bg-transparent hover:after:bg-brand/40',
          'focus-visible:outline-none focus-visible:after:bg-brand',
        )}
      />

      {/* The panel slides over the overview rather than replacing it, so the
          overview never has to re-mount or refetch.

          **Three moves, three animations.** This used to key on `panel` and
          replay one "slide in from the right" for every change, which told the
          wrong story twice over: switching Notes → Quizzes is a *lateral* move
          at the same depth, not another step deeper, and closing had no exit at
          all — the panel simply vanished, so going back felt like a glitch
          rather than a retreat. See `useDockPanelMotion`. */}
      {view.panel && (
        // The shell is keyed on nothing — it stays mounted across a switch, so
        // the header and this scroll container are not torn down and rebuilt
        // to change what is inside them.
        <div
          className={cn(
            'absolute inset-0 z-20 flex flex-col bg-surface',
            view.shellAnimation,
          )}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
            <button
              type="button"
              onClick={onClosePanel}
              className="flex min-h-8 items-center gap-1 rounded-[8px] px-1.5 py-1 text-[12.5px] text-ink-3 transition-colors cursor-pointer hover:bg-line-soft hover:text-ink"
            >
              <Icon name="arrowLeft" size={13} /> Back
            </button>
            {view.panel === 'help' ? (
              <span className="setcode ml-auto pr-1">Help</span>
            ) : (
              <button
                type="button"
                onClick={() => onOpenPanel('help')}
                className="ml-auto flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[12px] font-bold text-ink-2 transition-colors hover:bg-line-soft hover:text-ink"
              >
                <Icon name="help" size={14} /> Help
              </button>
            )}
          </div>
          {/* A flex column whose panel child is `flex-1`, so panels stretch to
              the dock rather than stacking into a strip at the top over a dead
              half-screen. The first attempt gave the children `min-h-full`,
              which looked equivalent and wasn't: a percentage min-height needs
              every ancestor up the chain to have a definite height, and this
              scroll container breaks that chain. Growth via flex asks nothing
              of its ancestors, so it can't regress the same way. */}
          {/* Keyed on the panel: this is the part that actually differs
              between siblings, so it is the part that remounts and animates. */}
          <div
            key={view.panel}
            className={cn(
              'flex min-h-0 flex-1 flex-col overflow-y-auto p-3.5',
              view.bodyAnimation,
            )}
          >
            <DockPanelBody
              panel={view.panel}
              subspaceId={subspaceId}
              base={base}
              onRunAgent={onRunAgent}
              docs={docList}
              docsLoading={docs.loading}
              docsError={docs.error}
              onDocsChanged={refreshDocs}
            />
          </div>
        </div>
      )}

      {/* Recedes while a panel covers it. Nobody sees this directly — the
          panel is opaque — but they see the half-second of it during the exit,
          and a background that settles back into place is what makes closing
          read as returning rather than as a new screen appearing. */}
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col',
          'motion-safe:transition-transform motion-safe:duration-300 motion-safe:[transition-timing-function:var(--ease-sl)]',
          view.panel && 'motion-safe:scale-[0.98]',
        )}
      >
        <DockOverview
          subspaceId={subspaceId}
          docs={docList}
          docsLoading={docs.loading}
          docsError={docs.error}
          onDocsChanged={refreshDocs}
          counts={counts}
          loaded={loaded}
          busy={busy}
          onRunAgent={onRunAgent}
          onOpenPanel={onOpenPanel}
        />
      </div>
    </aside>
  )
}
