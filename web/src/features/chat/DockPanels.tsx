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

import { useRef } from 'react'
import type { Document } from '../../api/types'
import { RelatedTopics } from '../spaces/RelatedTopics'
import type { AgentKey } from './agents'
import { DockAction, DockLink, DockSectionHead } from './dockParts'
import { DockHelp } from './DockHelp'
import { DockSources, type SourcesHandle } from './DockSources'
import { CardsPanel } from './panels/CardsPanel'
import { NotesPanel } from './panels/NotesPanel'
import { QuizzesPanel } from './panels/QuizzesPanel'

export type DockPanel = 'docs' | 'notes' | 'quizzes' | 'flashcards' | 'help' | null

export function DockPanelBody({
  panel,
  subspaceId,
  base,
  onRunAgent,
  docs,
  docsLoading = false,
  docsError = null,
  onDocsChanged = () => {},
}: {
  panel: NonNullable<DockPanel>
  subspaceId: string
  base: string
  onRunAgent: (agent: AgentKey, argument?: string) => void
  /** The topic's sources, already loaded by the dock's overview — passed down
   *  rather than fetched again, so opening this panel costs no request. */
  docs?: Document[]
  docsLoading?: boolean
  docsError?: string | null
  /** Asks the dock to read the sources again (after an upload or a retry). */
  onDocsChanged?: () => void
}) {
  if (panel === 'docs')
    return (
      <DocsPanel
        subspaceId={subspaceId}
        base={base}
        docs={docs ?? []}
        loading={docsLoading}
        error={docsError}
        onChanged={onDocsChanged}
      />
    )
  if (panel === 'help') return <DockHelp />
  if (panel === 'notes')
    return <NotesPanel subspaceId={subspaceId} base={base} onRunAgent={onRunAgent} />
  if (panel === 'quizzes') return <QuizzesPanel subspaceId={subspaceId} base={base} />
  return <CardsPanel subspaceId={subspaceId} base={base} />
}

/* ── Sources ─────────────────────────────────────────────────────────── */

function DocsPanel({
  subspaceId,
  base,
  docs,
  loading,
  error,
  onChanged,
}: {
  subspaceId: string
  base: string
  docs: Document[]
  loading: boolean
  error: string | null
  onChanged: () => void
}) {
  const sources = useRef<SourcesHandle>(null)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pr-1">
        <div className="flex flex-col gap-2">
          <DockSources
            ref={sources}
            subspaceId={subspaceId}
            docs={docs}
            loading={loading}
            error={error}
            onChanged={onChanged}
            addButton="none"
          />
          {docs.length > 0 && (
            <p className="text-[11.5px] leading-snug text-faint">I read all of these when you ask a question.</p>
          )}
        </div>

        <section aria-labelledby="dock-related-label" className="flex flex-col gap-2">
          <DockSectionHead id="dock-related-label">Linked topics</DockSectionHead>
          <p className="text-[11.5px] leading-snug text-faint">Link another topic and I’ll answer from its files too.</p>
          <RelatedTopics subspaceId={subspaceId} layout="stack" />
        </section>
      </div>

      <DockLink to={`${base}/docs`}>Open all files</DockLink>
      <DockAction icon="plus" onClick={() => sources.current?.choose()}>
        Add files
      </DockAction>
    </div>
  )
}
