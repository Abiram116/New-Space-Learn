/**
 * The right dock: what this topic knows, and what you can do with it.
 *
 * The two AI concepts are deliberately given different shapes, because naming
 * them differently was not enough:
 *
 *   Skills — cards. A stack you equip; each is a personality that stays on and
 *            changes how every answer is written. Card-shaped, like the
 *            character cards they are.
 *   Agents — buttons with a bolt. One-shot actions that hand you an artifact
 *            and finish. Deliberately not card-shaped.
 */

import { useCallback, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { listDocuments, uploadDocument } from '../../api/documents'
import { listActiveSkills } from '../../api/skills'
import { useAsync } from '../../lib/useAsync'
import { RelatedTopics } from '../spaces/RelatedTopics'
import { DockPanelBody, type DockPanel } from './DockPanels'
import { useDockPanelMotion } from './useDockPanelMotion'
import { useDockWidth } from './useDockWidth'
import { cn } from '../../lib/cn'
import { toneSoft, toneText } from '../../lib/tone'
import { SectionLabel } from '../../components/ui/Bits'
import { DashedCard } from '../../components/ui/Card'
import { Icon3D } from '../../components/ui/Icon3D'
import { Icon } from '../../components/ui/Icon'
import { Skeleton } from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/Toast'
import { SourceItem } from '../docs/SourceItem'
import { AGENT_ICON, AGENT_LABELS, AGENT_RESULT, AGENT_TONE, type AgentKey } from './agents'

const AGENTS: AgentKey[] = ['notes', 'flashcards', 'quiz']

/**
 * The dock is `lg:`-only, and below that breakpoint nothing said which Skill
 * was rewriting every answer — the tutor's voice changed with no visible
 * cause. This strip is that one missing fact, sat directly above the composer.
 *
 * Deliberately skills only: agents are already one tap away on the composer's
 * slash pills at every width, and duplicating them here would just be the dock
 * again in a worse shape.
 */
export function ActiveSkillStrip({ subspaceId, base }: { subspaceId: string; base: string }) {
  const skills = useAsync(() => listActiveSkills(subspaceId), [subspaceId], `skills:${subspaceId}`)

  if (skills.loading || skills.error) return null
  const list = skills.data ?? []

  return (
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-t border-line bg-surface px-5 py-2 lg:hidden">
      {list.length === 0 ? (
        <>
          <span className="setcode shrink-0">No skill on</span>
          <Link
            to={`${base}/skills`}
            className="setcode ml-auto shrink-0 font-bold text-brand-deep"
          >
            Pick one
          </Link>
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
          <Link to={`${base}/skills`} className="setcode ml-auto shrink-0">
            Manage
          </Link>
        </>
      )}
    </div>
  )
}

export function ContextDock({
  subspaceId,
  base,
  onRunAgent,
  panel,
  onClosePanel,
}: {
  subspaceId: string
  base: string
  onRunAgent: (agent: AgentKey) => void
  /** Which workspace panel is open, or null for the overview. */
  panel: DockPanel
  onClosePanel: () => void
}) {
  const docs = useAsync(() => listDocuments(subspaceId), [subspaceId], `docs:${subspaceId}`)
  const skills = useAsync(() => listActiveSkills(subspaceId), [subspaceId], `skills:${subspaceId}`)
  const { showError } = useToast()
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const {
    width,
    ref: dockRef,
    dragging: resizing,
    onPointerDown,
    onKeyDown,
  } = useDockWidth()

  const view = useDockPanelMotion(panel)

  const docList = docs.data ?? []
  const skillList = skills.data ?? []

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const file = Array.from(files)[0]
      if (!file) return
      setUploading(true)
      try {
        await uploadDocument(subspaceId, file, () => {})
        docs.refresh()
      } catch (err) {
        showError(err)
      } finally {
        setUploading(false)
      }
    },
    [subspaceId, docs, showError],
  )

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
              className="flex items-center gap-1 rounded-[8px] px-1.5 py-1 text-[12.5px] text-ink-3 transition-colors cursor-pointer hover:bg-line-soft hover:text-ink"
            >
              <Icon name="arrowLeft" size={13} /> Overview
            </button>
            <span className="setcode ml-auto">{PANEL_TITLE[view.panel]}</span>
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
            <DockPanelBody panel={view.panel} subspaceId={subspaceId} base={base} />
          </div>
        </div>
      )}

      {/* Recedes while a panel covers it. Nobody sees this directly — the
          panel is opaque — but they see the half-second of it during the exit,
          and a background that settles back into place is what makes closing
          read as returning rather than as a new screen appearing. */}
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden p-3.5',
          'motion-safe:transition-transform motion-safe:duration-300 motion-safe:[transition-timing-function:var(--ease-sl)]',
          view.panel && 'motion-safe:scale-[0.98]',
        )}
      >
      {/* ── Actions ── */}
      <section className="flex flex-col gap-2">
        <SectionLabel>Do something with this</SectionLabel>
        <div className="flex flex-col gap-1.5">
          {AGENTS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onRunAgent(key)}
              className="group flex items-start gap-2.5 rounded-[10px] border border-line bg-raised px-2.5 py-2 text-left transition-colors hover:border-brand/40 cursor-pointer"
            >
              <span
                className={cn(
                  'mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md',
                  toneSoft[AGENT_TONE[key]],
                  toneText[AGENT_TONE[key]],
                )}
              >
                <Icon3D name={AGENT_ICON[key]} size={15} />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-[12.5px] font-bold text-ink">
                  {AGENT_LABELS[key]}
                  <Icon
                    name="agent"
                    size={11}
                    filled
                    className="text-faint transition-colors group-hover:text-brand"
                  />
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted">
                  {AGENT_RESULT[key]}
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* ── Skills ── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <SectionLabel>Skills on</SectionLabel>
          <Link
            to={`${base}/skills`}
            className="setcode ml-auto transition-colors hover:text-brand-deep"
          >
            Manage
          </Link>
        </div>

        {skills.loading ? (
          <Skeleton className="h-14 rounded-[10px]" />
        ) : skillList.length === 0 ? (
          <DashedCard className="px-2.5 py-3.5 text-center">
            <p className="text-[11.5px] leading-snug text-muted">
              No skill on. Answers come back in the default voice.
            </p>
            <Link
              to={`${base}/skills`}
              className="mt-1.5 inline-block text-[11.5px] font-bold text-brand-deep"
            >
              Pick one
            </Link>
          </DashedCard>
        ) : (
          <div className="flex flex-col gap-1.5">
            {skillList.map((skill) => (
              <div
                key={skill.id}
                className={cn(
                  'cardstock flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 ring-1',
                  `ring-${skill.tone}/25`,
                )}
              >
                <span
                  className={cn(
                    'grid h-7 w-7 shrink-0 place-items-center rounded-md',
                    toneSoft[skill.tone],
                    toneText[skill.tone],
                  )}
                >
                  <Icon name="skill" size={14} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-bold text-ink">
                    {skill.name}
                  </span>
                  <span className="setcode">Shaping every answer</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Related topics ──
          Here rather than only on the Docs page, because deciding that this
          question also needs your linear-algebra notes happens *while* you
          are asking it. Behind a page navigation, it was a setup-time
          decision that in practice nobody revisited. */}
      <section className="flex flex-col gap-2">
        <SectionLabel>Related topics</SectionLabel>
        <RelatedTopics subspaceId={subspaceId} layout="stack" />
      </section>

      {/* ── Sources ── */}
      <section className="flex min-h-0 flex-col gap-2">
        {/* One input for the whole section. It used to live inside the empty
            state, which is why "+ Add" could not reach it the moment a first
            document existed. */}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.md,.txt,.csv,.png,.jpg,.jpeg,.webp"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files)
            // Reset, or choosing the same file twice in a row fires nothing.
            e.target.value = ''
          }}
        />
        <div className="flex items-center gap-2">
          <SectionLabel>Sources</SectionLabel>
          {/* Adding a source is the point of this panel, so it is a button
              here rather than a trip to another page. Uploading already
              worked in the dock — but only from the empty state, so the
              moment you had one document the only way to add a second was to
              leave chat entirely. */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="setcode ml-auto transition-colors cursor-pointer hover:text-brand-deep disabled:cursor-default disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : '+ Add'}
          </button>
        </div>

        {docs.loading ? (
          <div className="flex flex-col gap-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-12 rounded-[10px]" />
            ))}
          </div>
        ) : docs.error ? (
          <p className="text-[11.5px] text-muted">{docs.error}</p>
        ) : docList.length === 0 ? (
          <DashedCard
            className={cn(
              'cursor-pointer px-2.5 py-3.5 text-center transition-colors',
              dragging && 'border-brand/60 bg-brand-soft',
            )}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              if (e.dataTransfer.files.length > 0) void upload(e.dataTransfer.files)
            }}
          >
            <p className="text-[11.5px] leading-snug text-muted">
              {uploading ? 'Uploading…' : 'Drop a PDF here, or click to choose one.'}
            </p>
          </DashedCard>
        ) : (
          <div className="flex flex-col gap-2">
            {docList.map((doc) => (
              <SourceItem key={doc.id} doc={doc} />
            ))}
          </div>
        )}
      </section>
      </div>
    </aside>
  )
}

/** Titles for the panel header — one place, so they cannot drift from tabs. */
const PANEL_TITLE: Record<NonNullable<DockPanel>, string> = {
  docs: 'Sources',
  notes: 'Notes',
  quizzes: 'Quizzes',
  flashcards: 'Cards',
}
