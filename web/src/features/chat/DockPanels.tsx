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
 * Deliberately **not** a copy of each full page. A 320px column cannot host
 * the flashcard review loop or a quiz run, and pretending otherwise would
 * produce four cramped, worse versions of screens that already work. Each
 * panel does the things you would want *without leaving chat* — see, create,
 * open — and hands off to the full page for anything that needs room.
 */

import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { listNotes, generateNote } from '../../api/notes'
import { listDecks } from '../../api/flashcards'
import { listQuizzes } from '../../api/quizzes'
import { Icon } from '../../components/ui/Icon'
import { Skeleton } from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/Toast'
import { Rise, Stagger } from '../../components/ui/motion'
import { cn } from '../../lib/cn'
import { useAsync } from '../../lib/useAsync'
import { RelatedTopics } from '../spaces/RelatedTopics'

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

/* ── Notes ───────────────────────────────────────────────────────────── */

function NotesPanel({ subspaceId, base }: { subspaceId: string; base: string }) {
  const notes = useAsync(() => listNotes(subspaceId), [subspaceId])
  const { showError, show } = useToast()
  const [instructions, setInstructions] = useState('')
  const [writing, setWriting] = useState(false)

  const write = useCallback(async () => {
    setWriting(true)
    try {
      // The conversation is the material — this is the same generator the
      // "Save a note" action uses, with the student's own shaping passed
      // through. An empty box is fine: it just means "no preference".
      await generateNote(subspaceId, { instructions: instructions.trim() || undefined })
      setInstructions('')
      notes.refresh()
      show('Note written.', 'success')
    } catch (err) {
      showError(err)
    } finally {
      setWriting(false)
    }
  }, [subspaceId, instructions, notes, show, showError])

  const list = notes.data ?? []

  return (
    <Rise distance={6} className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <span className="setcode">Write one from this chat</span>
        <textarea
          rows={2}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="How should it be written? e.g. just a checklist, or go deep — I have an exam"
          className="w-full resize-none rounded-[10px] border border-line bg-canvas px-2.5 py-2 text-[12.5px] text-ink outline-none transition-colors placeholder:text-faint focus:border-brand/50"
        />
        <button
          type="button"
          onClick={write}
          disabled={writing}
          className={cn(
            'flex items-center justify-center gap-1.5 rounded-[10px] px-3 py-2',
            'text-[12.5px] font-semibold transition-all duration-200 cursor-pointer',
            writing
              ? 'cursor-default bg-line-soft text-muted'
              : 'bg-brand text-[#1a120f] hover:brightness-110 active:scale-[0.98]',
          )}
        >
          <Icon name="sparkle" size={12} />
          {writing ? 'Writing…' : 'Write a note'}
        </button>
      </section>

      <section className="flex min-h-0 flex-col gap-2">
        <span className="setcode">In this topic</span>
        {notes.loading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12 rounded-[10px]" />
            <Skeleton className="h-12 rounded-[10px]" />
          </div>
        ) : list.length === 0 ? (
          <p className="text-[12px] text-muted">No notes yet.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Stagger>
              {list.slice(0, 8).map((n) => (
                <Link
                  key={n.id}
                  to={`${base}/notes?n=${n.id}`}
                  className="block rounded-[10px] border border-line bg-raised px-2.5 py-2 transition-colors hover:border-brand/40"
                >
                  <div className="truncate text-[12.5px] font-semibold text-ink">
                    {n.title || 'Untitled note'}
                  </div>
                  <div className="setcode mt-0.5">
                    {n.origin === 'user' ? 'Written by me' : 'Written by AI'}
                  </div>
                </Link>
              ))}
            </Stagger>
          </div>
        )}
      </section>

      <FullPageLink to={`${base}/notes`}>Open the editor</FullPageLink>
    </Rise>
  )
}

/* ── Quizzes ─────────────────────────────────────────────────────────── */

function QuizzesPanel({ subspaceId, base }: { subspaceId: string; base: string }) {
  const quizzes = useAsync(() => listQuizzes(subspaceId), [subspaceId])
  const list = quizzes.data ?? []

  return (
    <Rise distance={6} className="flex flex-col gap-4">
      <p className="text-[12px] leading-relaxed text-muted">
        Taking a quiz needs the full width — this is what exists so far.
      </p>
      {quizzes.loading ? (
        <Skeleton className="h-12 rounded-[10px]" />
      ) : list.length === 0 ? (
        <p className="text-[12px] text-muted">None yet.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Stagger>
            {list.slice(0, 8).map((q) => (
              <Link
                key={q.id}
                to={`${base}/quizzes?q=${q.id}`}
                className="block truncate rounded-[10px] border border-line bg-raised px-2.5 py-2 text-[12.5px] text-ink-3 transition-colors hover:border-brand/40 hover:text-ink"
              >
                {q.topic || 'Quiz'}
              </Link>
            ))}
          </Stagger>
        </div>
      )}
      <FullPageLink to={`${base}/quizzes`}>Open quizzes</FullPageLink>
    </Rise>
  )
}

/* ── Cards ───────────────────────────────────────────────────────────── */

function CardsPanel({ subspaceId, base }: { subspaceId: string; base: string }) {
  const decks = useAsync(() => listDecks(subspaceId), [subspaceId])
  const list = decks.data ?? []
  const due = list.reduce((n, d) => n + d.due, 0)

  return (
    <Rise distance={6} className="flex flex-col gap-4">
      {due > 0 && (
        <div className="flex items-baseline gap-2 rounded-[10px] border border-brand/25 bg-brand-tint px-2.5 py-2">
          <span className="nameplate text-[20px] tabular-nums text-brand">{due}</span>
          <span className="text-[12px] text-ink-2">due now</span>
        </div>
      )}
      {decks.loading ? (
        <Skeleton className="h-12 rounded-[10px]" />
      ) : list.length === 0 ? (
        <p className="text-[12px] text-muted">No decks yet.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Stagger>
            {list.slice(0, 8).map((d) => (
              <Link
                key={d.id}
                to={`${base}/flashcards`}
                className="flex items-center gap-2 rounded-[10px] border border-line bg-raised px-2.5 py-2 transition-colors hover:border-brand/40"
              >
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-3">{d.name}</span>
                {d.due > 0 && <span className="setcode text-brand-deep">{d.due}</span>}
              </Link>
            ))}
          </Stagger>
        </div>
      )}
      {/* Review is a full-screen loop — a 320px column would make grading a
          card worse, not more convenient. */}
      <FullPageLink to={`${base}/flashcards`}>Review cards</FullPageLink>
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
