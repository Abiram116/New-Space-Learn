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
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
// Tiptap v3 ships the four table nodes as named exports of one package, with
// `TableKit` registering all of them together.
import { TableKit } from '@tiptap/extension-table'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { createLowlight, common } from 'lowlight'
import { Markdown } from 'tiptap-markdown'
import { ImageBlock } from './ImageBlock'
import {
  availableCommands,
  readContext,
  type SlashCommand,
  type SlashContext,
} from './slashMenu'
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
import { Leaf } from '../../components/ui/Surface'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'
import { useActiveSubspace } from '../../lib/nav'
import { SubspaceMissing } from '../spaces/SubspaceMissing'

type Filter = 'all' | 'ai' | 'mine'

/**
 * Syntax highlighting for code blocks.
 *
 * `common` is lowlight's curated ~35-language set rather than `all` (~190):
 * the full grammar bundle is well over a megabyte, and a study-notes editor
 * needs Python, JS/TS, SQL, Java, C++ and friends — not Erlang and PostScript.
 * Created once at module scope; building it per editor mount would re-parse
 * every grammar each time a note is opened.
 */
const lowlight = createLowlight(common)

/** Shown at the cursor while an AI command is in flight, then taken back out.
    A constant because two separate places have to agree on it exactly — the
    insert and the removal — and they drifted apart once already. */
const AI_PLACEHOLDER = 'Thinking…'

/** Offered in the code block's language picker, in the order students reach for them. */
const CODE_LANGUAGES = [
  'plaintext', 'python', 'javascript', 'typescript', 'java', 'cpp', 'c',
  'csharp', 'sql', 'bash', 'json', 'html', 'css', 'go', 'rust', 'r',
]

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
                  onClick={() => select(item.id)}
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

/**
 * The always-visible toolbar. Deliberately short: it holds the marks you reach
 * for mid-sentence, where stopping to type `/` would break the sentence.
 * Everything structural (headings, quote, code, table, to-do, image, divider)
 * lives in the slash menu, because you only ever want those at the START of a
 * block — which is exactly when your hands are already free to type `/`.
 *
 * H1–H3 are the exception: `docs/backlog.md` asked for them explicitly and
 * they are the most-used structure in a study note, so they earn the space.
 */
const TOOLBAR: { key: string; label: string; run: (e: Editor) => void; active: (e: Editor) => boolean }[] = [
  { key: 'h1', label: 'H1', run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(), active: (e) => e.isActive('heading', { level: 1 }) },
  { key: 'h2', label: 'H2', run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive('heading', { level: 2 }) },
  { key: 'h3', label: 'H3', run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), active: (e) => e.isActive('heading', { level: 3 }) },
  { key: 'bold', label: 'B', run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive('bold') },
  { key: 'italic', label: 'I', run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive('italic') },
  { key: 'underline', label: 'U', run: (e) => e.chain().focus().toggleUnderline().run(), active: (e) => e.isActive('underline') },
  { key: 'strike', label: 'S', run: (e) => e.chain().focus().toggleStrike().run(), active: (e) => e.isActive('strike') },
  { key: 'code', label: '</>', run: (e) => e.chain().focus().toggleCode().run(), active: (e) => e.isActive('code') },
  { key: 'bulletList', label: '•—', run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive('bulletList') },
  { key: 'orderedList', label: '1.', run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive('orderedList') },
  { key: 'taskList', label: '☑', run: (e) => e.chain().focus().toggleTaskList().run(), active: (e) => e.isActive('taskList') },
  { key: 'blockquote', label: '❝', run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive('blockquote') },
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
  // Title and body debounce separately. They used to share one timer, which meant
  // touching the title inside the 800ms window cleared the pending body save — the
  // edit was dropped while the header still reported "saved".
  const bodyTimer = useRef<number | null>(null)
  const titleTimer = useRef<number | null>(null)
  const { showError } = useToast()
  const editorRef = useRef<Editor | null>(null)
  const savedBodyRef = useRef(note.body_md)

  const saveBody = useCallback(
    (markdown: string) => {
      if (markdown === savedBodyRef.current) return
      setStatus('saving')
      if (bodyTimer.current) window.clearTimeout(bodyTimer.current)
      bodyTimer.current = window.setTimeout(async () => {
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

  /* ── Slash menu ───────────────────────────────────────────────────────
     Tracked off the editor's own state rather than by intercepting keys: the
     menu must survive arrow keys, backspace, clicking away and undo, and
     re-deriving "is the cursor sitting in a paragraph that starts with /"
     from the document on every update is the only version that stays correct
     through all of those. */
  const [slash, setSlash] = useState<
    { query: string; from: number; to: number; ctx: SlashContext } | null
  >(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const trackSlash = useCallback((ed: Editor) => {
    const { $from, empty } = ed.state.selection
    if (!empty || $from.parent.type.name === 'codeBlock') {
      setSlash(null)
      return
    }
    const text = $from.parent.textContent
    if (!text.startsWith('/')) {
      setSlash(null)
      return
    }
    // A space ends the menu. `/ai explain attention` is a free-text prompt, not
    // a command search — it is handled by the Enter binding in `handleKeyDown`,
    // which is the one case where typing past the command name is meaningful.
    const query = text.slice(1)
    if (query.includes(' ')) {
      setSlash(null)
      return
    }
    // The TEXT range of the `/query`, not the node range.
    //
    // This used to store `$from.before()`→`$from.after()`, which spans the
    // whole paragraph NODE. Deleting that removed the block itself, so every
    // structure command then ran against whatever the cursor fell into next —
    // `setDetails()` had no block to convert and silently did nothing.
    // `start()`→`pos` is just the typed characters, leaving an empty paragraph
    // for the command to act on.
    // Context is read here, with the editor in hand, so the menu can hide
    // commands the document can't support — "Summarise" on a blank note used
    // to sit there fully enabled and return an apology from the model.
    setSlash({ query, from: $from.start(), to: $from.pos, ctx: readContext(ed) })
    setSlashIndex(0)
  }, [])

  const matches = useMemo(
    () => (slash ? availableCommands(slash.query, slash.ctx) : []),
    [slash],
  )

  /** Reads files as data URLs and drops them in as images. */
  const insertImageFiles = useCallback(
    async (files: File[], at?: number) => {
      const ed = editorRef.current
      if (!ed) return
      for (const file of files) {
        // 4MB ceiling. Images live inside the note's markdown as data URLs, so
        // an unbounded paste would push a single note past what the API will
        // accept and fail the save with no obvious cause.
        if (file.size > 4 * 1024 * 1024) {
          showError(new Error(`${file.name} is over 4MB — resize it first.`))
          continue
        }
        const src = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader()
          fr.onload = () => resolve(String(fr.result))
          fr.onerror = () => reject(new Error('Could not read that file.'))
          fr.readAsDataURL(file)
        }).catch((e) => {
          showError(e)
          return null
        })
        if (!src) continue
        const chain = ed.chain().focus()
        if (typeof at === 'number') chain.insertContentAt(at, { type: 'image', attrs: { src } })
        else chain.setImage({ src })
        chain.run()
      }
    },
    [showError],
  )

  const runInlineAi = useCallback(
    async (prompt: string, from: number, to: number) => {
      const editor = editorRef.current
      if (!editor) return
      setAiBusy(true)
      editor.chain().deleteRange({ from, to }).insertContentAt(from, AI_PLACEHOLDER).run()

      /**
       * Take the placeholder back out, and only the placeholder.
       *
       * Two things this has to survive. **A failed request:** the old version
       * removed the placeholder on the success path only, so any error left a
       * literal "Thinking…" sitting in the student's note forever, saved to
       * the database with everything else. **A student who keeps typing:** the
       * request is async, so by the time it returns the text at `from` may no
       * longer be the placeholder at all — deleting blindly would eat words
       * they just wrote. So the range is verified before anything is removed,
       * and if it doesn't match we leave the document alone.
       */
      const clearPlaceholder = () => {
        const end = from + AI_PLACEHOLDER.length
        if (end > editor.state.doc.content.size) return false
        if (editor.state.doc.textBetween(from, end) !== AI_PLACEHOLDER) return false
        editor.chain().deleteRange({ from, to: end }).run()
        return true
      }

      try {
        const { content_md } = await noteAiInline(subspaceId, prompt)
        // @ts-expect-error — the Markdown extension's storage isn't in @tiptap/core's base Storage type
        const parsed = editor.storage.markdown.parser.parse(content_md)
        if (clearPlaceholder()) {
          editor.chain().insertContentAt(from, parsed).focus().run()
        } else {
          // The anchor moved under us, so append at the caret instead of
          // guessing — losing the position is not a reason to lose the answer.
          editor.chain().focus().insertContent(parsed).run()
        }
      } catch (err) {
        clearPlaceholder()
        showError(err)
      } finally {
        setAiBusy(false)
      }
    },
    [subspaceId, showError],
  )

  const editor = useEditor({
    extensions: [
      // `codeBlock: false` because CodeBlockLowlight REPLACES it. Registering
      // both throws a duplicate-node error and the editor fails to mount.
      StarterKit.configure({ codeBlock: false }),
      CodeBlockLowlight.configure({
        lowlight,
        defaultLanguage: 'plaintext',
      }),
      Underline,
      Placeholder.configure({
        placeholder: "Write, or press '/' for commands…",
      }),
      TaskList,
      // Nested to-dos, because revision checklists are naturally hierarchical.
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false, autolink: true }),
      // Images are stored as data URLs in the note's markdown. That keeps the
      // whole note self-contained with no storage bucket, no upload endpoint
      // and nothing to clean up when a note is deleted — at the cost of note
      // size, which is why the editor caps what it will accept.
      //
      // ImageBlock, not the stock Image: resize handles, alignment and a
      // caption, all encoded back into standard markdown image syntax so the
      // note stays a real markdown document. See ImageBlock.tsx.
      ImageBlock.configure({ inline: false, allowBase64: true }),
      TableKit.configure({ table: { resizable: true } }),
      // Toggle blocks. A long revision note is mostly things you already know
      // — being able to fold a section away is what keeps it usable in week
      // ten rather than something you scroll past.
      Details.configure({ persist: true, HTMLAttributes: { class: 'notes-toggle' } }),
      DetailsSummary,
      DetailsContent,
      Markdown.configure({ html: false, transformPastedText: true }),
    ],
    content: note.body_md,
    editorProps: {
      attributes: {
        // `notes-doc` ONLY — `chat-md` used to be applied alongside it and the
        // two actively fight: chat-md sets `ul { list-style: none }` with a
        // decorative `::before` bullet and `li > p { display: inline }`, which
        // breaks the task-list and toggle markup outright (both need a real
        // flex `li` with a block child). `notes-doc` is self-sufficient —
        // headings, prose, lists, code, tables, images, toggles and the hljs
        // token palette are all defined there.
        class: 'notes-doc min-h-full text-[15px] leading-[1.75] outline-none',
      },
      // Drop an image straight into the note, at the point you dropped it.
      handleDrop(view, event) {
        const files = Array.from(event.dataTransfer?.files ?? []).filter((f) =>
          f.type.startsWith('image/'),
        )
        if (files.length === 0) return false
        event.preventDefault()
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
        void insertImageFiles(files, at?.pos)
        return true
      },
      // …and paste one from the clipboard, which is how most screenshots arrive.
      handlePaste(_view, event) {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
          f.type.startsWith('image/'),
        )
        if (files.length === 0) return false
        event.preventDefault()
        void insertImageFiles(files)
        return true
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
      trackSlash(editor)
    },
    onSelectionUpdate: ({ editor }) => trackSlash(editor),
  })

  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  /** Runs a chosen slash command and clears the `/query` that triggered it. */
  const applyCommand = useCallback(
    (cmd: SlashCommand) => {
      const ed = editorRef.current
      if (!ed || !slash) return
      const { from, to } = slash
      setSlash(null)

      if (cmd.id === 'image') {
        ed.chain().focus().deleteRange({ from, to }).run()
        fileRef.current?.click()
        return
      }

      if (cmd.ai) {
        // Whatever is selected becomes the subject of the command, so
        // "summarise" means "summarise THIS" when something is highlighted.
        const sel = ed.state.doc.textBetween(
          ed.state.selection.from,
          ed.state.selection.to,
          '\n',
        )
        void runInlineAi(cmd.ai(sel), from, to)
        return
      }

      ed.chain().focus().deleteRange({ from, to }).run()
      cmd.run?.(ed)
    },
    [slash, runInlineAi],
  )

  /* Keyboard for the menu, bound at the document while it is open. Attached
     here rather than in `handleKeyDown` because ProseMirror's handler does not
     see arrow keys once a selection plugin claims them. */
  useEffect(() => {
    if (!slash || matches.length === 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashIndex((i) => (i + 1) % matches.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIndex((i) => (i - 1 + matches.length) % matches.length)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        applyCommand(matches[slashIndex] ?? matches[0])
      } else if (e.key === 'Escape') {
        setSlash(null)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [slash, matches, slashIndex, applyCommand])

  useEffect(() => {
    if (title === note.title) return
    setStatus('saving')
    if (titleTimer.current) window.clearTimeout(titleTimer.current)
    titleTimer.current = window.setTimeout(async () => {
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
          <Button variant="danger" size="sm" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>

      {/* Toolbar — always visible, applies to a user-typed note exactly the
          same as an AI-written one. */}
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
          {/* Points at the menu, not at one command. This used to advertise
              `/ai your request` only, which is now one of nineteen and the
              only one you cannot discover by pressing `/`. */}
          <span className="ml-3 text-[11px] text-faint">
            Press <code className="rounded bg-well px-1 py-0.5">/</code> for
            headings, code, tables, images and AI
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-8">
        {/* LEAF — the canonical case. A note is the one thing in this app you
            are *inside* rather than holding, so it gets the margin rule and a
            measure instead of a card's border and lift. `measure` caps the
            line at 66ch, which replaces the arbitrary `max-w-3xl`: 3xl is a
            width, 66ch is a reading length, and only one of those is about
            the text. */}
        <Leaf measure className="mx-auto flex h-full flex-col gap-4">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="border-transparent bg-transparent px-0 text-2xl font-display font-semibold focus:border-transparent focus:ring-0"
            placeholder="Untitled note"
          />
          <div className="relative min-h-0 flex-1">
            {/* Language picker, shown only while the caret is inside a code
                block. A permanent control would be a dead widget on every note
                that has no code in it — which is most of them. */}
            {editor?.isActive('codeBlock') && (
              <div className="sticky top-0 z-20 -mt-1 mb-2 flex items-center gap-2 rounded-[10px] border border-line bg-raised px-2.5 py-1.5">
                <span className="setcode">Language</span>
                <select
                  value={editor.getAttributes('codeBlock').language || 'plaintext'}
                  onChange={(e) =>
                    editor.chain().focus().updateAttributes('codeBlock', {
                      language: e.target.value,
                    }).run()
                  }
                  className="rounded-md border border-line bg-well px-2 py-1 font-mono text-[11.5px] text-ink-2 outline-none focus:border-brand"
                >
                  {CODE_LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <EditorContent editor={editor} className="min-h-0" />

            {/* The slash menu. Anchored to the top of the writing column
                rather than to the caret: a caret-following popover has to be
                re-measured on every keystroke and still ends up off-screen at
                the bottom of the page. A fixed anchor is always readable, and
                the list is short enough that it never obscures the line being
                written. */}
            {slash && (
              <div className="absolute left-0 right-0 top-0 z-30 max-h-[340px] overflow-y-auto rounded-xl border border-line bg-raised p-1.5 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)]">
                <div className="setcode px-2 py-1.5">
                  {slash.query ? `Commands · ${slash.query}` : 'Commands'}
                </div>
                {/* Shown rather than hiding the menu on no match: silently
                    vanishing looks like the feature broke, and leaves you
                    guessing whether `/` did anything at all. */}
                {matches.length === 0 && (
                  <p className="px-2 py-2 text-[12.5px] text-muted">
                    No command matches “{slash.query}”. Press Esc to keep typing.
                  </p>
                )}
                {matches.map((cmd, i) => (
                  <div key={cmd.id}>
                  {/* One section label at each group boundary. `availableCommands`
                      returns AI first, then inserts, so a boundary is simply
                      the first item whose group differs from the one above. */}
                  {(i === 0 || matches[i - 1].group !== cmd.group) && (
                    <div className="setcode px-2 pb-1 pt-2 first:pt-1">
                      {cmd.group === 'ai' ? 'Ask the tutor' : 'Insert'}
                    </div>
                  )}
                  <button
                    type="button"
                    onMouseEnter={() => setSlashIndex(i)}
                    onMouseDown={(e) => {
                      // mousedown, not click — click fires after the editor has
                      // already taken focus back and moved the selection.
                      e.preventDefault()
                      applyCommand(cmd)
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-[9px] px-2 py-1.5 text-left',
                      i === slashIndex ? 'bg-brand-soft' : 'hover:bg-line-soft',
                    )}
                  >
                    <span
                      className={cn(
                        'grid h-6 w-6 shrink-0 place-items-center rounded-md',
                        cmd.ai ? 'bg-sky-soft text-sky-deep' : 'bg-well text-ink-3',
                      )}
                    >
                      <Icon name={cmd.icon} size={12} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-ink">
                        {cmd.label}
                      </span>
                      <span className="block truncate text-[11.5px] text-muted">
                        {cmd.hint}
                      </span>
                    </span>
                    {cmd.ai && <span className="setcode shrink-0 text-sky-deep">AI</span>}
                  </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Owned here rather than inside the slash menu so the input
              survives the menu unmounting the moment a command is chosen. */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = ''
              if (files.length) void insertImageFiles(files)
            }}
          />
        </Leaf>
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
  return 'Notes agent'
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
