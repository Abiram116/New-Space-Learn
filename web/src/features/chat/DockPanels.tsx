/**
 * The workspace panels that open inside the chat dock.
 *
 * The point: adding a source, reading a note or generating cards should not
 * cost you the conversation. Each of these used to be a full-page route, so
 * "let me add this PDF" meant leaving the question you were halfway through
 * asking and finding your way back. The panel slides over the dock instead —
 * the chat stays mounted, the scroll position survives, and Back is one click
 * rather than a browser gesture.
 *
 * This file used to say a 320px column could not host the review loop or a
 * quiz run, and linked out for both. That was wrong about what those need: a
 * card is one question and four grades, a quiz question is a stem and four
 * choices — they are the NARROWEST things in the app, not the widest. Both run
 * here now, using the same components as the full pages rather than reduced
 * copies of them, because two implementations drift and the dock's would be
 * the neglected one.
 *
 * What still hands off: authoring cards, managing decks and sources, and the
 * rich-text note editor. Those genuinely want room.
 */

import { Link } from 'react-router-dom'
import type { Document } from '../../api/types'
import { Icon } from '../../components/ui/Icon'
import { Skeleton } from '../../components/ui/Skeleton'
import { SourceItem } from '../docs/SourceItem'
import { RelatedTopics } from '../spaces/RelatedTopics'
import type { AgentKey } from './agents'
import { CardsPanel } from './panels/CardsPanel'
import { NotesPanel } from './panels/NotesPanel'
import { QuizzesPanel } from './panels/QuizzesPanel'

export type DockPanel = 'docs' | 'notes' | 'quizzes' | 'flashcards' | null

export function DockPanelBody({
  panel,
  subspaceId,
  base,
  onRunAgent,
  docs,
  docsLoading = false,
}: {
  panel: NonNullable<DockPanel>
  subspaceId: string
  base: string
  onRunAgent: (agent: AgentKey, argument?: string) => void
  /** The topic's sources, already loaded by the dock's overview — passed down
   *  rather than fetched again, so opening this panel costs no request. */
  docs?: Document[]
  docsLoading?: boolean
}) {
  if (panel === 'docs')
    return <DocsPanel subspaceId={subspaceId} base={base} docs={docs ?? []} loading={docsLoading} />
  if (panel === 'notes')
    return <NotesPanel subspaceId={subspaceId} base={base} onRunAgent={onRunAgent} />
  if (panel === 'quizzes') return <QuizzesPanel subspaceId={subspaceId} base={base} />
  return <CardsPanel subspaceId={subspaceId} base={base} />
}

/* ── Docs ────────────────────────────────────────────────────────────── */

/** How many sources the panel shows before pointing at the full page. */
const SOURCES_SHOWN = 3

function DocsPanel({
  subspaceId,
  base,
  docs,
  loading,
}: {
  subspaceId: string
  base: string
  docs: Document[]
  loading: boolean
}) {
  const shown = docs.slice(0, SOURCES_SHOWN)
  const hidden = docs.length - shown.length

  return (
    <div className="flex flex-1 flex-col gap-5">
      <section className="flex flex-col gap-2">
        {/* The way to the full page sits with the heading it belongs to — same
            spot as "+ Add" on the overview — not at the foot of the panel,
            where it was the last thing you found. */}
        <div className="flex items-center justify-between gap-2">
          <span className="setcode">{docs.length > 0 ? `Sources · ${docs.length}` : 'Sources'}</span>
          <Link
            to={`${base}/docs`}
            className="setcode inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-brand-deep transition-colors hover:text-brand"
          >
            {hidden > 0 ? `See all ${docs.length} sources` : 'Manage sources'}
            <Icon name="arrowRight" size={11} />
          </Link>
        </div>
        {loading && docs.length === 0 ? (
          <div className="flex flex-col gap-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-12 rounded-[10px]" />
            ))}
          </div>
        ) : docs.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-line px-2.5 py-3.5 text-center text-[11.5px] leading-snug text-muted">
            Nothing here yet. Add a PDF or some notes on the full page.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {shown.map((doc) => (
              <SourceItem key={doc.id} doc={doc} />
            ))}
            {hidden > 0 && (
              <p className="px-1 text-[11.5px] text-faint">
                and {hidden} more. They&rsquo;re searched too.
              </p>
            )}
          </div>
        )}
        <p className="text-[11.5px] leading-snug text-faint">
          Anything here is searched when you ask a question, and answers cite the
          page they came from.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <span className="setcode">Related topics</span>
        <RelatedTopics subspaceId={subspaceId} layout="stack" />
        <p className="text-[11.5px] leading-snug text-faint">
          A linked topic’s sources are searched too. Links only ever add
          material — they never replace this topic’s own.
        </p>
      </section>
    </div>
  )
}
