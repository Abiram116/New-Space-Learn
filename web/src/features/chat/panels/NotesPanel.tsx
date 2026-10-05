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
import { DockAction, DockEmpty, DockFooter, DockLink, DockSectionHead } from '../dockParts'
import { notePreview, relativeTime } from '../../notes/format'

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

  const byAi = list.filter((n) => n.origin !== 'user').length
  return (
    <div className="flex flex-col gap-3">
      <DockSectionHead
        id="notes-panel-label"
        hint={
          list.length > 0
            ? `${list.length === 1 ? '1 note' : `${list.length} notes`} in this topic${byAi > 0 ? ` · ${byAi} made by AI` : ''}`
            : undefined
        }
      >
        {list.length > 0 ? `Notes · ${list.length}` : 'Notes'}
      </DockSectionHead>

      <div className="flex flex-col gap-2">
        {notes.loading ? (
          <>
            <Skeleton className="h-[4.5rem] rounded-[12px]" />
            <Skeleton className="h-[4.5rem] rounded-[12px]" />
          </>
        ) : list.length === 0 ? (
          <DockEmpty icon="note" title="No notes yet">
            Save an answer from the chat to keep it here.
          </DockEmpty>
        ) : (
          <Stagger step={18} max={140}>
            {list.map((n) => {
              const preview = notePreview(n.body_md ?? '', 90)
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setOpenId(n.id)}
                  className="group flex w-full cursor-pointer items-start gap-3 rounded-[12px] border border-line bg-raised px-3 py-3 text-left t-control duration-200 hover:border-brand/40 hover:bg-line-soft"
                >
                  <span className="relative mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-brand-soft text-brand-deep">
                    <Icon name="note" size={17} />
                    {n.origin !== 'user' && (
                      <Icon name="sparkle" size={9} filled className="absolute -right-0.5 -top-0.5 text-sky-deep" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold leading-snug text-ink">
                      {n.title || 'Untitled note'}
                    </span>
                    {preview && (
                      <span className="mt-0.5 block truncate text-[13px] leading-snug text-ink-3">{preview}</span>
                    )}
                    <span className="mt-1 block text-[12.5px] text-muted">
                      {n.origin === 'user' ? 'Written by me' : 'Written by AI'}
                      {n.updated_at && ` · ${relativeTime(n.updated_at)}`}
                    </span>
                  </span>
                  <Icon
                    name="chevronRight"
                    size={15}
                    className="mt-2.5 shrink-0 text-faint transition-transform group-hover:translate-x-0.5"
                  />
                </button>
              )
            })}
          </Stagger>
        )}
      </div>
      <DockFooter>
        <DockLink to={`${base}/notes`}>Open all notes</DockLink>
        <DockAction onClick={() => onRunAgent('notes')}>Save last answer as a note</DockAction>
      </DockFooter>
    </div>
  )
}
