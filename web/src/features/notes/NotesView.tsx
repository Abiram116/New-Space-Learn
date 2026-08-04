/**
 * Notes: list of notes on the left, editor on the right.
 *
 * Editing debounces to a PATCH after 800ms of idle typing. The last-known
 * server state is what the sidebar reflects; the editor edits its own local
 * copy to keep typing snappy.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  createNote,
  deleteNote,
  listNotes,
  updateNote,
} from '../../api/notes'
import type { Note } from '../../api/types'
import { friendlyMessage } from '../../api/errors'
import { Button } from '../../components/ui/Button'
import { Chip } from '../../components/ui/Bits'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Input, Textarea } from '../../components/ui/Input'
import { PageSpinner } from '../../components/ui/PageSpinner'
import { Skeleton } from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'
import { useActiveSubspace } from '../../lib/nav'
import { SubspaceMissing } from '../spaces/SubspaceMissing'

type Filter = 'all' | 'ai' | 'mine'

export function NotesView() {
  const { space, subspace } = useActiveSubspace()
  if (!space || !subspace) return <SubspaceMissing />
  return <Inner subspaceId={subspace.id} subspaceName={subspace.name} />
}

function Inner({ subspaceId, subspaceName }: { subspaceId: string; subspaceName: string }) {
  const [params, setParams] = useSearchParams()
  const { show, showError } = useToast()
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(params.get('n'))
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const data = await listNotes(subspaceId)
      setNotes(data)
      setError(null)
      if (!selectedId && data.length > 0) setSelectedId(data[0].id)
    } catch (err) {
      setError(friendlyMessage(err))
    }
  }, [subspaceId, selectedId])

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

  const newBlank = async () => {
    try {
      const note = await createNote(subspaceId, {
        title: 'Untitled note',
        body_md: '',
        origin: 'user',
      })
      setNotes((prev) => (prev ? [note, ...prev] : [note]))
      setSelectedId(note.id)
      setParams({ n: note.id }, { replace: true })
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
        setSelectedId(rest[0]?.id ?? null)
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
          'w-full shrink-0 flex-col border-r-[1.5px] border-line bg-surface md:flex md:w-[260px]',
          current ? 'hidden' : 'flex',
        )}
      >
        <div className="flex flex-col gap-2.5 border-b-[1.5px] border-line p-4">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-base font-semibold flex-1">
              Notes · {subspaceName}
            </h1>
            <button
              onClick={newBlank}
              className="rounded-full bg-brand-soft px-2 text-brand text-sm font-semibold cursor-pointer"
              aria-label="New note"
            >
              +
            </button>
          </div>
          <input
            placeholder="Search notes"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-[10px] border-[1.5px] border-line px-2.5 py-1.5 text-[12.5px] outline-none placeholder:text-faint focus:border-brand"
          />
          <div className="flex gap-1.5">
            {(['all', 'ai', 'mine'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11.5px] font-medium cursor-pointer',
                  filter === f
                    ? 'bg-brand-soft font-semibold text-brand'
                    : 'border-[1.5px] border-line text-muted',
                )}
              >
                {labelFor(f, notes)}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto text-[13px]">
          {loading && (
            <div className="flex flex-col gap-2 p-4">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          )}
          {error && (
            <p className="p-4 text-xs text-coral-deep">{error}</p>
          )}
          {!loading && !error && totalNotes === 0 && (
            <div className="p-4">
              <EmptyState
                icon="📝"
                title="No notes yet"
                description="Save a note from chat, or start a blank one."
                action={<Button onClick={newBlank}>New note</Button>}
              />
            </div>
          )}
          {!loading &&
            visible.map((item) => {
              const active = item.id === current?.id
              return (
                <button
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className={cn(
                    'block w-full border-b border-line-soft px-4 py-3 text-left transition-colors cursor-pointer',
                    active ? 'border-l-[3px] border-l-brand bg-brand-tint' : 'hover:bg-line-soft',
                  )}
                >
                  <div className={cn('truncate', active ? 'font-bold' : 'font-semibold')}>
                    {item.title || 'Untitled note'}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {originLabel(item.origin)} · {relativeTime(item.updated_at)}
                  </div>
                </button>
              )
            })}
        </div>
      </aside>

      {loading ? (
        <div className="flex min-w-0 flex-1 items-center justify-center">
          <PageSpinner label="Loading notes…" />
        </div>
      ) : !current ? (
        <div className="hidden min-w-0 flex-1 items-center justify-center p-6 md:flex">
          <EmptyState
            icon="✍️"
            title="Pick a note to read"
            description="Or create one — the editor autosaves as you type."
            action={<Button onClick={newBlank}>New note</Button>}
          />
        </div>
      ) : (
        <NoteEditor
          key={current.id}
          note={current}
          onPatch={(patch) => applyPatch(current.id, patch)}
          onDelete={() => setConfirmDelete(current.id)}
          onBack={() => setSelectedId(null)}
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

function NoteEditor({
  note,
  onPatch,
  onDelete,
  onBack,
}: {
  note: Note
  onPatch: (patch: Partial<Note>) => void
  onDelete: () => void
  onBack: () => void
}) {
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body_md)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const timerRef = useRef<number | null>(null)
  const { showError } = useToast()

  // Debounce saves.
  useEffect(() => {
    if (title === note.title && body === note.body_md) return
    setStatus('saving')
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(async () => {
      try {
        const updated = await updateNote(note.id, { title, body_md: body })
        onPatch({ title: updated.title, body_md: updated.body_md, updated_at: updated.updated_at })
        setStatus('saved')
        window.setTimeout(() => setStatus('idle'), 1500)
      } catch (err) {
        setStatus('error')
        showError(err)
      }
    }, 800)
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body])

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b-[1.5px] border-line bg-surface px-4 py-3 text-[12.5px] text-muted sm:px-6">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 rounded-[9px] px-1.5 py-1 text-ink-3 transition-colors hover:bg-line-soft md:hidden"
        >
          ← All notes
        </button>
        <Chip active={note.origin !== 'user'} className={note.origin === 'user' ? 'bg-line-soft' : ''}>
          {originLabel(note.origin)}
        </Chip>
        <span className="text-xs text-faint">
          {status === 'saving' && 'Saving…'}
          {status === 'saved' && 'Saved'}
          {status === 'error' && 'Save failed'}
          {status === 'idle' && `Edited ${relativeTime(note.updated_at)}`}
        </span>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" size="sm" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-8">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="border-transparent bg-transparent px-0 text-2xl font-display font-semibold focus:border-transparent focus:ring-0"
            placeholder="Untitled note"
          />
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="min-h-96 border-transparent bg-transparent px-0 text-[15px] leading-[1.7] focus:border-transparent focus:ring-0"
            placeholder="Write anything. Markdown is welcome."
          />
        </div>
      </div>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────

function labelFor(f: Filter, notes: Note[] | null): string {
  if (!notes) return f === 'all' ? 'All' : f === 'ai' ? '✦ AI' : 'Mine'
  const all = notes.length
  const mine = notes.filter((n) => n.origin === 'user').length
  const ai = all - mine
  if (f === 'all') return `All ${all}`
  if (f === 'ai') return `✦ AI ${ai}`
  return `Mine ${mine}`
}

function originLabel(origin: Note['origin']): string {
  if (origin === 'user') return '✍️ Me'
  if (origin === 'doc') return '✦ from doc'
  return '✦ Notes agent'
}

function relativeTime(iso: string): string {
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return d.toLocaleDateString()
}
