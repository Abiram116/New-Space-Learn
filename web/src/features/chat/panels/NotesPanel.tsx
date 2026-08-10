/**
 * Notes, in the dock — all of them, and editable here.
 *
 * Two things were wrong with the version this replaces.
 *
 * **It only showed the current topic's notes.** That is a restriction the data
 * never justified: reading your Deadlock note while chatting about Virtual
 * Memory is a completely ordinary thing to want, and scoping the list to
 * wherever you happen to be standing made it a three-click round trip through
 * another page. The scope toggle defaults to this topic — that is the common
 * case — but "Everything" is one tap away and carries the subject name on each
 * row so you can tell two similarly-titled notes apart.
 *
 * **Opening a note left the conversation.** Every row was a link to `/notes`,
 * which is exactly the cost the dock exists to remove. A note now opens *here*,
 * readable and editable, with the same 800ms debounced autosave the full editor
 * uses. What the panel deliberately does not have is the rich-text editor — the
 * whole Tiptap stack is a 650KB lazy chunk and the second-largest dependency in
 * the app. Editing markdown as text in a 320px column is the honest fit; the
 * full editor is one click away when the note needs tables and images.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { generateNote, listAllNotes, listNotes, updateNote } from '../../../api/notes'
import type { Note } from '../../../api/types'
import { Icon } from '../../../components/ui/Icon'
import { Skeleton } from '../../../components/ui/Skeleton'
import { useToast } from '../../../components/ui/Toast'
import { Rise, Stagger } from '../../../components/ui/motion'
import { cn } from '../../../lib/cn'
import { useAsync } from '../../../lib/useAsync'

type Scope = 'topic' | 'all'

export function NotesPanel({ subspaceId, base }: { subspaceId: string; base: string }) {
  const [scope, setScope] = useState<Scope>('topic')
  const [openId, setOpenId] = useState<string | null>(null)
  const notes = useAsync(
    () => (scope === 'all' ? listAllNotes() : listNotes(subspaceId)),
    [scope, subspaceId],
  )
  const list = notes.data ?? []
  const open = list.find((n) => n.id === openId) ?? null

  if (open) {
    return (
      <NoteReader
        note={open}
        base={base}
        onBack={() => setOpenId(null)}
        onSaved={(patch) => notes.setData((prev) =>
          (prev ?? []).map((n) => (n.id === open.id ? { ...n, ...patch } : n)),
        )}
      />
    )
  }

  return (
    <Rise distance={6} className="flex min-h-0 flex-col gap-3">
      <WriteFromChat subspaceId={subspaceId} onWritten={notes.refresh} />

      <div className="flex items-center gap-1">
        {(['topic', 'all'] as Scope[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            className={cn(
              'rounded-full px-2.5 py-1 text-[11.5px] transition-colors cursor-pointer',
              scope === s
                ? 'bg-brand-soft font-bold text-brand-deep'
                : 'text-muted hover:bg-line-soft hover:text-ink-3',
            )}
          >
            {s === 'topic' ? 'This topic' : 'Everything'}
          </button>
        ))}
        <span className="setcode ml-auto">{list.length}</span>
      </div>

      <div className="-mr-1 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
        {notes.loading ? (
          <>
            <Skeleton className="h-12 rounded-[10px]" />
            <Skeleton className="h-12 rounded-[10px]" />
          </>
        ) : list.length === 0 ? (
          <p className="text-[12px] text-muted">
            {scope === 'all' ? 'No notes anywhere yet.' : 'No notes in this topic yet.'}
          </p>
        ) : (
          <Stagger step={18} max={140}>
            {list.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setOpenId(n.id)}
                className="block w-full rounded-[10px] border border-line bg-raised px-2.5 py-2 text-left transition-colors cursor-pointer hover:border-brand/40"
              >
                <div className="truncate text-[12.5px] font-semibold text-ink">
                  {n.title || 'Untitled note'}
                </div>
                <div className="setcode mt-0.5 flex items-center gap-1.5">
                  {n.origin !== 'user' && <Icon name="sparkle" size={9} className="text-sky-deep" />}
                  {/* Where it lives, but only when that isn't obvious — in
                      topic scope every row is from here, and repeating it on
                      every line is noise. */}
                  {scope === 'all' && n.subspace_name
                    ? `${n.subject_name ? `${n.subject_name} · ` : ''}${n.subspace_name}`
                    : n.origin === 'user'
                      ? 'Written by me'
                      : 'Written by AI'}
                </div>
              </button>
            ))}
          </Stagger>
        )}
      </div>
    </Rise>
  )
}

/* ── Reading and editing, without leaving chat ────────────────────────── */

function NoteReader({
  note,
  base,
  onBack,
  onSaved,
}: {
  note: Note
  base: string
  onBack: () => void
  onSaved: (patch: Partial<Note>) => void
}) {
  const [body, setBody] = useState(note.body_md)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const timer = useRef<number | null>(null)
  const { showError } = useToast()

  // Same 800ms debounce as the full editor, for the same reason: a PATCH per
  // keystroke is both a wasted request and a way to lose the last one to a
  // race. Cleared on unmount so closing the panel mid-type doesn't fire a
  // save into a component that no longer exists.
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current)
  }, [])

  const edit = useCallback(
    (next: string) => {
      setBody(next)
      setStatus('saving')
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(async () => {
        try {
          const updated = await updateNote(note.id, { body_md: next })
          onSaved({ body_md: updated.body_md, updated_at: updated.updated_at })
          setStatus('saved')
          window.setTimeout(() => setStatus('idle'), 1500)
        } catch (err) {
          setStatus('error')
          showError(err)
        }
      }, 800)
    },
    [note.id, onSaved, showError],
  )

  return (
    <Rise distance={5} className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded-md px-1 py-0.5 text-[11.5px] text-muted transition-colors cursor-pointer hover:text-ink"
        >
          <Icon name="arrowLeft" size={12} /> Notes
        </button>
        <span className="setcode ml-auto flex items-center gap-1">
          {status === 'saving' && (
            <>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sun" />
              Saving
            </>
          )}
          {status === 'saved' && (
            <span className="flex items-center gap-1 text-mint-deep">
              <Icon name="check" size={10} /> Saved
            </span>
          )}
          {status === 'error' && <span className="text-coral-deep">Couldn’t save</span>}
        </span>
      </div>

      <div className="truncate text-[13.5px] font-bold text-ink">
        {note.title || 'Untitled note'}
      </div>
      {note.subspace_name && (
        <span className="setcode -mt-1">
          {note.subject_name ? `${note.subject_name} · ` : ''}
          {note.subspace_name}
        </span>
      )}

      {/* Markdown as text, deliberately. The rich editor is a 650KB lazy chunk
          and the app's second-largest dependency; pulling it into the dock to
          edit in a 320px column would cost every chat session that weight for
          a surface too narrow to use it well. */}
      <textarea
        value={body}
        onChange={(e) => edit(e.target.value)}
        spellCheck
        placeholder="Empty note — start typing."
        className="min-h-0 w-full flex-1 resize-none rounded-[10px] border border-line bg-canvas px-2.5 py-2 font-mono text-[12px] leading-relaxed text-ink outline-none transition-colors placeholder:text-faint focus:border-brand/50"
      />

      <Link
        to={`${base}/notes?n=${note.id}`}
        className="flex items-center justify-center gap-1.5 rounded-[10px] border border-line px-3 py-2 text-[12px] text-muted transition-colors hover:border-brand/40 hover:text-brand-deep"
      >
        Open the full editor <Icon name="arrowRight" size={12} />
      </Link>
    </Rise>
  )
}

/* ── Write one from the conversation ──────────────────────────────────── */

function WriteFromChat({
  subspaceId,
  onWritten,
}: {
  subspaceId: string
  onWritten: () => void
}) {
  const [instructions, setInstructions] = useState('')
  const [writing, setWriting] = useState(false)
  const { show, showError } = useToast()

  const write = useCallback(async () => {
    setWriting(true)
    try {
      await generateNote(subspaceId, { instructions: instructions.trim() || undefined })
      setInstructions('')
      onWritten()
      show('Note written.', 'success')
    } catch (err) {
      showError(err)
    } finally {
      setWriting(false)
    }
  }, [subspaceId, instructions, onWritten, show, showError])

  return (
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
  )
}
