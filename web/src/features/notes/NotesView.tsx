/**
 * Notes: list of notes on the left, editor on the right.
 *
 * Editing debounces to a PATCH after 800ms of idle typing. The last-known
 * server state is what the sidebar reflects; the editor edits its own local
 * copy to keep typing snappy.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Editor, EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { Markdown } from 'tiptap-markdown'
import {
  createNote,
  deleteNote,
  listNotes,
  noteAiInline,
  updateNote,
} from '../../api/notes'
import type { Note } from '../../api/types'
import { friendlyMessage } from '../../api/errors'
import { Button } from '../../components/ui/Button'
import { Chip } from '../../components/ui/Bits'
import { Icon } from '../../components/ui/Icon'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Input } from '../../components/ui/Input'
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
              className="grid h-7 w-7 place-items-center rounded-full bg-brand-soft text-brand-deep transition-colors hover:bg-brand-200/60 cursor-pointer"
              aria-label="New note"
            >
              <Icon name="plus" size={14} />
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
                icon="note"
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
                    'block w-full border-b border-line-soft px-4 py-3 text-left transition-all duration-150 cursor-pointer',
                    active
                      ? 'border-l-[3px] border-l-brand bg-brand-tint'
                      : 'border-l-[3px] border-l-transparent hover:bg-line-soft',
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
            icon="note"
            title="Pick a note to read"
            description="Or create one — the editor autosaves as you type."
            action={<Button onClick={newBlank}>New note</Button>}
          />
        </div>
      ) : (
        <NoteEditor
          key={current.id}
          note={current}
          subspaceId={subspaceId}
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

const TOOLBAR: { key: string; label: string; run: (e: Editor) => void; active: (e: Editor) => boolean }[] = [
  { key: 'bold', label: 'B', run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive('bold') },
  { key: 'italic', label: 'I', run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive('italic') },
  { key: 'underline', label: 'U', run: (e) => e.chain().focus().toggleUnderline().run(), active: (e) => e.isActive('underline') },
  { key: 'strike', label: 'S', run: (e) => e.chain().focus().toggleStrike().run(), active: (e) => e.isActive('strike') },
  { key: 'bulletList', label: '•—', run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive('bulletList') },
  { key: 'orderedList', label: '1.', run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive('orderedList') },
]

function NoteEditor({
  note,
  subspaceId,
  onPatch,
  onDelete,
  onBack,
}: {
  note: Note
  subspaceId: string
  onPatch: (patch: Partial<Note>) => void
  onDelete: () => void
  onBack: () => void
}) {
  const [title, setTitle] = useState(note.title)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [aiBusy, setAiBusy] = useState(false)
  const timerRef = useRef<number | null>(null)
  const { showError } = useToast()
  const editorRef = useRef<Editor | null>(null)
  const savedBodyRef = useRef(note.body_md)

  const saveBody = useCallback(
    (markdown: string) => {
      if (markdown === savedBodyRef.current) return
      setStatus('saving')
      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(async () => {
        try {
          const updated = await updateNote(note.id, { body_md: markdown })
          savedBodyRef.current = markdown
          onPatch({ body_md: updated.body_md, updated_at: updated.updated_at })
          setStatus('saved')
          window.setTimeout(() => setStatus('idle'), 1500)
        } catch (err) {
          setStatus('error')
          showError(err)
        }
      }, 800)
    },
    [note.id, onPatch, showError],
  )

  const runInlineAi = useCallback(
    async (prompt: string, from: number, to: number) => {
      const editor = editorRef.current
      if (!editor) return
      setAiBusy(true)
      editor.chain().deleteRange({ from, to }).insertContentAt(from, 'Thinking…').run()
      try {
        const { content_md } = await noteAiInline(subspaceId, prompt)
        const placeholderLen = 'Thinking…'.length
        // @ts-expect-error — the Markdown extension's storage isn't in @tiptap/core's base Storage type
        const parsed = editor.storage.markdown.parser.parse(content_md)
        editor
          .chain()
          .deleteRange({ from, to: from + placeholderLen })
          .insertContentAt(from, parsed)
          .run()
      } catch (err) {
        showError(err)
      } finally {
        setAiBusy(false)
      }
    },
    [subspaceId, showError],
  )

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Markdown.configure({ html: false, transformPastedText: true }),
    ],
    content: note.body_md,
    editorProps: {
      attributes: {
        class: 'chat-md min-h-full text-[15px] leading-[1.75] outline-none',
      },
      handleKeyDown(view, event) {
        if (event.key !== 'Enter' || aiBusy) return false
        const { $from } = view.state.selection
        const text = $from.parent.textContent
        if (!text.startsWith('/ai ')) return false
        const prompt = text.slice(4).trim()
        if (!prompt) return false
        event.preventDefault()
        void runInlineAi(prompt, $from.before(), $from.after())
        return true
      },
    },
    onUpdate: ({ editor }) => {
      // @ts-expect-error — added by the Markdown extension's storage
      saveBody(editor.storage.markdown.getMarkdown())
    },
  })

  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  useEffect(() => {
    if (title === note.title) return
    setStatus('saving')
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(async () => {
      try {
        const updated = await updateNote(note.id, { title })
        onPatch({ title: updated.title, updated_at: updated.updated_at })
        setStatus('saved')
        window.setTimeout(() => setStatus('idle'), 1500)
      } catch (err) {
        setStatus('error')
        showError(err)
      }
    }, 800)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title])

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b-[1.5px] border-line bg-surface px-4 py-3 text-[12.5px] text-muted sm:px-6">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 flex items-center gap-1 rounded-[9px] px-1.5 py-1 text-ink-3 transition-colors hover:bg-line-soft md:hidden"
        >
          <Icon name="arrowLeft" size={13} /> All notes
        </button>
        <Chip active={note.origin !== 'user'} className={note.origin === 'user' ? 'bg-line-soft' : ''}>
          {originLabel(note.origin)}
        </Chip>
        <span className="flex items-center gap-1.5 text-xs text-faint">
          {aiBusy && (
            <>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
              Writing…
            </>
          )}
          {!aiBusy && status === 'saving' && (
            <>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sun" />
              Saving…
            </>
          )}
          {!aiBusy && status === 'saved' && (
            <span className="flex items-center gap-1 text-mint-deep">
              <Icon name="check" size={12} /> Saved
            </span>
          )}
          {!aiBusy && status === 'error' && (
            <span className="flex items-center gap-1 text-coral-deep">
              <Icon name="alert" size={12} /> Save failed
            </span>
          )}
          {!aiBusy && status === 'idle' && `Edited ${relativeTime(note.updated_at)}`}
        </span>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" size="sm" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>

      {/* Toolbar — always visible, applies to a user-typed note exactly the
          same as an AI-written one. Type /ai <prompt> anywhere and press
          Enter for inline generation grounded in this topic's material. */}
      {editor && (
        <div className="flex shrink-0 items-center gap-1 border-b border-line-soft bg-surface px-4 py-1.5 sm:px-6">
          {TOOLBAR.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => t.run(editor)}
              className={cn(
                'flex h-7 w-8 items-center justify-center rounded-md font-mono text-[12px] font-bold transition-colors cursor-pointer',
                t.active(editor) ? 'bg-brand-soft text-brand-deep' : 'text-ink-3 hover:bg-line-soft',
              )}
            >
              {t.label}
            </button>
          ))}
          <span className="ml-3 text-[11px] text-faint">
            Type <code className="rounded bg-well px-1 py-0.5">/ai your request</code> and press Enter
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-8">
        <div className="mx-auto flex h-full max-w-3xl flex-col gap-4">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="border-transparent bg-transparent px-0 text-2xl font-display font-semibold focus:border-transparent focus:ring-0"
            placeholder="Untitled note"
          />
          <EditorContent editor={editor} className="min-h-0 flex-1" />
        </div>
      </div>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────

function labelFor(f: Filter, notes: Note[] | null): string {
  if (!notes) return f === 'all' ? 'All' : f === 'ai' ? 'AI' : 'Mine'
  const all = notes.length
  const mine = notes.filter((n) => n.origin === 'user').length
  const ai = all - mine
  if (f === 'all') return `All ${all}`
  if (f === 'ai') return `AI ${ai}`
  return `Mine ${mine}`
}

function originLabel(origin: Note['origin']): string {
  if (origin === 'user') return 'Written by me'
  if (origin === 'doc') return 'From a document'
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
