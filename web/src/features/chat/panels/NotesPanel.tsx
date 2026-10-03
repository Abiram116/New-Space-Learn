/**
 * Notes, in the dock — all of them, and editable here.
 *
 * Things that were wrong with the version this replaces.
 *
 * **The list is this topic's notes only.** Notes from every subject live on the
 * account-wide Notes page, so a scope toggle here only duplicated it.
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
import { deleteNote, listNotes } from '../../../api/notes'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { Icon } from '../../../components/ui/Icon'
import { Skeleton } from '../../../components/ui/Skeleton'
import { useToast } from '../../../components/ui/Toast'
import { Stagger } from '../../../components/ui/motion'
import { useAsync } from '../../../lib/useAsync'
import type { AgentKey } from '../agents'

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

export function NotesPanel({
  subspaceId,
  base,
  onRunAgent,
}: {
  subspaceId: string
  base: string
  /** Same notes-agent flow as the dock's "Do something with this" Notes
   *  button and the composer's `/notes` — see the note on `WriteFromChat`
   *  below for why this panel no longer runs its own. */
  onRunAgent: (agent: AgentKey, argument?: string) => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { show, showError } = useToast()
  // This topic's notes only. Every topic's notes live on the Notes page.
  const notes = useAsync(() => listNotes(subspaceId), [subspaceId], `notes:${subspaceId}`)
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
      <button
        type="button"
        onClick={() => onRunAgent('notes')}
        className="flex items-center justify-center gap-1.5 rounded-[10px] border border-line bg-raised px-3 py-2 text-[12.5px] font-semibold text-ink-2 transition-colors cursor-pointer hover:border-brand/40"
      >
        <Icon name="sparkle" size={12} className="text-brand-deep" />
        Write one from this chat
      </button>

      <div className="-mr-1 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
        {notes.loading ? (
          <>
            <Skeleton className="h-12 rounded-[10px]" />
            <Skeleton className="h-12 rounded-[10px]" />
          </>
        ) : list.length === 0 ? (
          <p className="text-[12px] text-muted">
            No notes in this topic yet.
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
                  {n.origin === 'user' ? 'Written by me' : 'Written by AI'}
                </div>
              </button>
            ))}
          </Stagger>
        )}
      </div>
    </div>
  )
}
