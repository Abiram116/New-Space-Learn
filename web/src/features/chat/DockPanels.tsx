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
import { Icon } from '../../components/ui/Icon'
import { Rise } from '../../components/ui/motion'
import { RelatedTopics } from '../spaces/RelatedTopics'
import { CardsPanel } from './panels/CardsPanel'
import { NotesPanel } from './panels/NotesPanel'
import { QuizzesPanel } from './panels/QuizzesPanel'

export type DockPanel = 'docs' | 'notes' | 'quizzes' | 'flashcards' | null

export function DockPanelBody({
  panel,
  subspaceId,
  base,
}: {
  panel: NonNullable<DockPanel>
  subspaceId: string
  base: string
}) {
  if (panel === 'docs') return <DocsPanel subspaceId={subspaceId} base={base} />
  if (panel === 'notes') return <NotesPanel subspaceId={subspaceId} base={base} />
  if (panel === 'quizzes') return <QuizzesPanel subspaceId={subspaceId} base={base} />
  return <CardsPanel subspaceId={subspaceId} base={base} />
}

/* ── Docs ────────────────────────────────────────────────────────────── */

function DocsPanel({ subspaceId, base }: { subspaceId: string; base: string }) {
  return (
    <Rise distance={6} className="flex flex-col gap-5">
      <p className="text-[12px] leading-relaxed text-muted">
        Anything here is searched when you ask a question, and answers cite the
        page they came from.
      </p>
      <section className="flex flex-col gap-2">
        <span className="setcode">Related topics</span>
        <RelatedTopics subspaceId={subspaceId} layout="stack" />
        <p className="text-[11.5px] leading-snug text-faint">
          A linked topic’s sources are searched too. Links only ever add
          material — they never replace this topic’s own.
        </p>
      </section>
      <FullPageLink to={`${base}/docs`}>Manage all sources</FullPageLink>
    </Rise>
  )
}

/* ── Shared ──────────────────────────────────────────────────────────── */

/** The deliberate exit: some work genuinely needs the whole screen. */
function FullPageLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="mt-auto flex items-center justify-center gap-1.5 rounded-[10px] border border-line px-3 py-2 text-[12px] text-muted transition-colors hover:border-brand/40 hover:text-brand-deep"
    >
      {children} <Icon name="arrowRight" size={12} />
    </Link>
  )
}
