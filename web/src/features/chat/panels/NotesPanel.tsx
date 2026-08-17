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

import { lazy, Suspense, useCallback, useState } from 'react'
import { LIMITS } from '../../../lib/limits'
import { deleteNote, generateNote, listAllNotes, listNotes } from '../../../api/notes'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { Icon } from '../../../components/ui/Icon'
import { Skeleton } from '../../../components/ui/Skeleton'
import { useToast } from '../../../components/ui/Toast'
import { Stagger } from '../../../components/ui/motion'
import { cn } from '../../../lib/cn'
import { useAsync } from '../../../lib/useAsync'

/* Lazy, deliberately.
   The editor is the largest chunk in the app (~270KB gzipped — Tiptap,
   lowlight's grammars, the markdown bridge). Importing it statically made
   *opening chat* download all of it, for a panel most sessions never open.
   Split here it costs nothing until a note is actually clicked, and the
   Suspense fallback is a skeleton rather than a spinner because the panel
   already has a shape. */
const NoteEditor = lazy(() =>
  import('../../notes/NoteEditor').then((m) => ({ default: m.NoteEditor })),
)

type Scope = 'topic' | 'all'

export function NotesPanel({ subspaceId, base }: { subspaceId: string; base: string }) {
  const [scope, setScope] = useState<Scope>('topic')
  const [openId, setOpenId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { show, showError } = useToast()
  const notes = useAsync(
    () => (scope === 'all' ? listAllNotes() : listNotes(subspaceId)),
    [scope, subspaceId],
    scope === 'all' ? 'notes:all' : `notes:${subspaceId}`,
  )
  const list = notes.data ?? []
  const open = list.find((n) => n.id === openId) ?? null

  // Regression: `onDelete` used to just close the panel back to the list
  // (`setOpenId(null)`) without calling the API at all — the note read as
  // deleted for exactly as long as you didn't reopen the panel.
  const del = useCallback(async () => {
    if (!open) return
    setDeleting(true)
    try {
      await deleteNote(open.id)
      notes.setData((prev) => (prev ?? []).filter((n) => n.id !== open.id))
      setConfirmDelete(false)
      setOpenId(null)
      show('Note deleted.', 'success')
    } catch (err) {
      showError(err)
    } finally {
      setDeleting(false)
    }
  }, [open, notes, show, showError])

  if (open) {
    return (
      /* The real canvas, not a copy of it.
         This was a plain textarea, with a comment arguing markdown-as-text
         was the honest fit for a narrow column. The dock is resizable now,
         and the argument was really about avoiding the work of sharing the
         component — so slash commands, the selection menu, image wrapping
         and escaped-HTML healing were all silently missing in here.
         `compact` trims gutters and the title size; every behaviour is
         identical, because it is the same code. */
      <>
      <Suspense
        fallback={
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
            <Skeleton className="h-6 w-2/3 rounded" />
            <Skeleton className="h-3 w-full rounded" />
            <Skeleton className="h-3 w-5/6 rounded" />
          </div>
        }
      >
      <NoteEditor
        key={open.id}
        note={open}
        subspaceId={subspaceId}
        base={base}
        compact
        onBack={() => setOpenId(null)}
        onDelete={() => setConfirmDelete(true)}
        onPatch={(patch) =>
          notes.setData((prev) =>
            (prev ?? []).map((n) => (n.id === open.id ? { ...n, ...patch } : n)),
          )
        }
      />
      </Suspense>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this note?"
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={del}
        destructive
        loading={deleting}
      />
      </>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
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
                <div className="leading-snug text-[12.5px] font-semibold text-ink">
                  {n.title || 'Untitled note'}
                </div>
                <div className="setcode mt-0.5 flex items-center gap-1.5">
                  {n.origin !== 'user' && (
                    <span className="relative inline-flex shrink-0">
                      <Icon name="note" size={9} className="text-sky-deep" />
                      <Icon
                        name="sparkle"
                        size={5}
                        filled
                        className="absolute -right-0.5 -top-0.5 text-sky-deep"
                      />
                    </span>
                  )}
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
    </div>
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
        maxLength={LIMITS.noteInstructions}
        placeholder="How should it be written? e.g. just a checklist, or go deep — I have an exam"
        className="w-full resize-none rounded-[10px] border border-line bg-canvas px-2.5 py-2 text-[12.5px] text-ink outline-none transition-colors placeholder:text-faint focus:border-brand/50"
      />
      <button
        type="button"
        onClick={write}
        disabled={writing}
        className={cn(
          'flex items-center justify-center gap-1.5 rounded-[10px] px-3 py-2',
          'text-[12.5px] font-semibold t-control duration-200 cursor-pointer',
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
