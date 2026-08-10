/**
 * Notes: list of notes on the left, editor on the right.
 *
 * Editing debounces to a PATCH after 800ms of idle typing. The last-known
 * server state is what the sidebar reflects; the editor edits its own local
 * copy to keep typing snappy.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { labelFor, notePreview, relativeTime, type Filter } from './format'
import { NoteEditor } from './NoteEditor'
import { createNote, deleteNote, listNotes } from '../../api/notes'
import type { Note } from '../../api/types'
import { friendlyMessage } from '../../api/errors'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageSpinner } from '../../components/ui/PageSpinner'
import { Skeleton } from '../../components/ui/Skeleton'
import { Stagger } from '../../components/ui/motion'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'
import { useActiveSubspace } from '../../lib/nav'
import { SubspaceMissing } from '../spaces/SubspaceMissing'


export function NotesView() {
  const { space, subspace, base } = useActiveSubspace()
  if (!space || !subspace) return <SubspaceMissing />
  return <Inner subspaceId={subspace.id} subspaceName={subspace.name} base={base} />
}

function Inner({
  subspaceId,
  subspaceName,
  base,
}: {
  subspaceId: string
  subspaceName: string
  /** Route prefix for this topic — citation links point inside it. */
  base: string
}) {
  const [params, setParams] = useSearchParams()
  const { show, showError } = useToast()
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(params.get('n'))
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  // Fetches once per subspace. `selectedId` is deliberately NOT a dependency:
  // including it rebuilt this callback on every note you clicked, which
  // re-ran the effect below and refetched the entire note list just to change
  // which one was highlighted. The default-selection is applied inside the
  // setter instead, so it still works without making selection a fetch
  // trigger.
  const refresh = useCallback(async () => {
    try {
      const data = await listNotes(subspaceId)
      setNotes(data)
      setError(null)
      setSelectedId((cur) => cur ?? data[0]?.id ?? null)
    } catch (err) {
      setError(friendlyMessage(err))
    }
  }, [subspaceId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const visible = useMemo(() => {
    if (!notes) return []
    return notes.filter((n) => {
      if (filter === 'ai' && n.origin === 'user') return false
      if (filter === 'mine' && n.origin !== 'user') return false
      if (search && !n.title.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [notes, filter, search])

  const current = notes?.find((n) => n.id === selectedId) ?? null

  /* The origin filter is only meaningful when both kinds exist. */
  const mixedOrigins = useMemo(() => {
    if (!notes || notes.length < 2) return false
    return (
      notes.some((n) => n.origin === 'user') && notes.some((n) => n.origin !== 'user')
    )
  }, [notes])

  /** Selects a note AND writes it to the URL, so the two never disagree.
   *  `?n=` was previously only written on create, so reloading or sharing the
   *  page after clicking around reopened whichever note happened to be first. */
  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id)
      setParams(id ? { n: id } : {}, { replace: true })
    },
    [setParams],
  )

  const newBlank = async () => {
    try {
      const note = await createNote(subspaceId, {
        title: 'Untitled note',
        body_md: '',
        origin: 'user',
      })
      setNotes((prev) => (prev ? [note, ...prev] : [note]))
      select(note.id)
    } catch (err) {
      showError(err)
    }
  }

  const del = async () => {
    if (!confirmDelete) return
    try {
      await deleteNote(confirmDelete)
      setNotes((prev) => (prev ? prev.filter((n) => n.id !== confirmDelete) : prev))
      if (selectedId === confirmDelete) {
        const rest = (notes ?? []).filter((n) => n.id !== confirmDelete)
        select(rest[0]?.id ?? null)
      }
      setConfirmDelete(null)
      show('Note deleted.', 'success')
    } catch (err) {
      showError(err)
    }
  }

  const applyPatch = useCallback((id: string, patch: Partial<Note>) => {
    setNotes((prev) => (prev ? prev.map((n) => (n.id === id ? { ...n, ...patch } : n)) : prev))
  }, [])

  const loading = notes === null && !error
  const totalNotes = notes?.length ?? 0

  return (
    <div className="flex min-h-0 flex-1">
      {/* Master/detail. One pane at a time on phones: the list until you pick a
          note, then the editor (which offers its own way back). */}
      <aside
        className={cn(
          'w-full shrink-0 flex-col border-r border-line bg-well md:flex md:w-[288px]',
          current ? 'hidden' : 'flex',
        )}
      >
        <div className="flex flex-col gap-3 px-4 pb-3 pt-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h1 className="nameplate text-[19px] leading-none text-ink">Notes</h1>
              <span className="setcode mt-1 block truncate">{subspaceName}</span>
            </div>
            <Button size="sm" onClick={newBlank}>
              <Icon name="plus" size={13} /> New
            </Button>
          </div>

          {/* Search and filters only exist once there is something to search or
              filter. On a fresh topic they were two dead controls above an
              empty state, which is three things saying "nothing here". */}
          {totalNotes > 0 && (
            <label className="relative flex items-center">
              <Icon
                name="search"
                size={13}
                className="pointer-events-none absolute left-2.5 text-faint"
              />
              <input
                placeholder="Search notes"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-[10px] border border-line bg-canvas py-1.5 pl-8 pr-2.5 text-[12.5px] text-ink outline-none transition-colors placeholder:text-faint focus:border-brand"
              />
            </label>
          )}

          {/* Only when there is genuinely a mix. A "Mine 1 / AI 0" toggle row
              filters nothing and just adds three numbers to read. */}
          {mixedOrigins && (
            <div className="flex gap-1">
              {(['all', 'ai', 'mine'] as Filter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'flex-1 rounded-[8px] px-2 py-1 text-[11.5px] transition-colors cursor-pointer',
                    filter === f
                      ? 'bg-brand-soft font-bold text-brand-deep'
                      : 'text-muted hover:bg-line-soft hover:text-ink-3',
                  )}
                >
                  {labelFor(f, notes)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && (
            <div className="flex flex-col gap-2 p-4">
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-16 rounded-lg" />
            </div>
          )}
          {error && <p className="p-4 text-xs text-coral-deep">{error}</p>}
          {!loading && !error && totalNotes === 0 && (
            <div className="p-4">
              <EmptyState
                icon="note"
                title="No notes yet"
                description="Start a blank one, or save a note from a chat."
                action={<Button onClick={newBlank}>New note</Button>}
              />
            </div>
          )}
          {!loading && totalNotes > 0 && visible.length === 0 && (
            <p className="px-4 py-6 text-center text-[12.5px] text-muted">
              Nothing matches “{search}”.
            </p>
          )}
          {/* Deals itself in on load. `Stagger` keys on position, so typing in
              the search box refilters without re-animating the rows that
              survive the filter — the list settles once, then behaves like a
              list. */}
          {!loading && (
            <Stagger step={22} max={160}>
            {visible.map((item) => {
              const active = item.id === current?.id
              const preview = notePreview(item.body_md)
              return (
                <button
                  key={item.id}
                  onClick={() => select(item.id)}
                  className={cn(
                    'relative block w-full px-4 py-3 text-left transition-colors cursor-pointer',
                    active ? 'bg-surface' : 'hover:bg-surface/60',
                  )}
                >
                  {/* A rule, not a filled tint block — the selected row is
                      marked in the margin the way a page is, so the list still
                      reads as a list. */}
                  <span
                    aria-hidden
                    className={cn(
                      'absolute inset-y-0 left-0 w-[2px]',
                      active ? 'bg-brand' : 'bg-transparent',
                    )}
                  />
                  <div
                    className={cn(
                      'truncate text-[13px]',
                      active ? 'font-bold text-ink' : 'font-semibold text-ink-2',
                    )}
                  >
                    {item.title || 'Untitled note'}
                  </div>
                  {preview && (
                    <div className="mt-1 line-clamp-2 text-[12px] leading-snug text-muted">
                      {preview}
                    </div>
                  )}
                  <div className="setcode mt-1.5 flex items-center gap-1.5">
                    {item.origin !== 'user' && (
                      <Icon name="sparkle" size={9} className="text-sky-deep" />
                    )}
                    {relativeTime(item.updated_at)}
                  </div>
                </button>
              )
            })}
            </Stagger>
          )}
        </div>
      </aside>

      {loading ? (
        <div className="flex min-w-0 flex-1 items-center justify-center">
          <PageSpinner label="Loading notes…" />
        </div>
      ) : !current ? (
        <div className="hidden min-w-0 flex-1 items-center justify-center p-6 md:flex">
          {/* Only prompts when there is something to pick. With zero notes the
              sidebar already shows "No notes yet" with the same New-note
              button, and rendering both put two competing empty states with
              two different messages on screen at once. */}
          {totalNotes > 0 ? (
            <EmptyState
              icon="note"
              title="Pick a note to read"
              description="Or create one — the editor autosaves as you type."
              action={<Button onClick={newBlank}>New note</Button>}
            />
          ) : null}
        </div>
      ) : (
        <NoteEditor
          key={current.id}
          note={current}
          subspaceId={subspaceId}
          base={base}
          onPatch={(patch) => applyPatch(current.id, patch)}
          onDelete={() => setConfirmDelete(current.id)}
          onBack={() => select(null)}
        />
      )}

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete this note?"
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={del}
        destructive
      />
    </div>
  )
}



// ── Helpers ────────────────────────────────────────────────────────────
