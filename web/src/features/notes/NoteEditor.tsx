/**
 * The note canvas.
 *
 * Extracted from `NotesView` so the chat dock renders *this*, not a reduced
 * copy. The dock previously showed a plain textarea with a comment arguing
 * that markdown-as-text was the honest fit for a narrow column — but the dock
 * is resizable now, and the argument was really about avoiding the work of
 * sharing this component. Two editors would drift, and the dock's would be
 * the neglected one.
 *
 * `compact` trims the chrome for the dock: no breadcrumb row, tighter
 * gutters. Everything else — slash commands, the selection menu, image
 * wrapping, autosave, escaped-HTML healing — is identical, because it is
 * literally the same code.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Editor, EditorContent, useEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { TableKit } from '@tiptap/extension-table'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { createLowlight, common } from 'lowlight'
import { Markdown } from 'tiptap-markdown'
import { healEscapedHtml } from './healHtml'
import { ImageBlock } from './ImageBlock'
import { BLOCK_ICON, BLOCKS, HEADINGS, MARKS, SELECTION_ACTIONS } from './toolbar'
import { originLabel, relativeTime, sourceLine } from './format'
import { availableCommands, readContext, type SlashCommand, type SlashContext } from './slashMenu'
import { noteAiInline, updateNote } from '../../api/notes'
import type { Note } from '../../api/types'
import { Chip } from '../../components/ui/Bits'
import { Icon } from '../../components/ui/Icon'
import { Rise } from '../../components/ui/motion'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'

const lowlight = createLowlight(common)

/** Shown at the cursor while an AI command is in flight, then taken back out. */
const AI_PLACEHOLDER = 'Thinking\u2026'

/** Offered in the code block's language picker. */
const CODE_LANGUAGES = [
  'plaintext', 'python', 'javascript', 'typescript', 'java', 'cpp', 'c',
  'csharp', 'sql', 'bash', 'json', 'html', 'css', 'go', 'rust', 'r',
]

export function NoteEditor({
  note,
  subspaceId,
  base,
  onPatch,
  onDelete,
  onBack,
  compact = false,
}: {
  note: Note
  subspaceId: string
  base: string
  onPatch: (patch: Partial<Note>) => void
  onDelete: () => void
  onBack: () => void
  /**
   * Dock mode: tighter gutters and a smaller title, because the same canvas
   * has to work at 320px as well as at 1600px. Nothing is removed — every
   * command, the selection menu and image wrapping all behave identically.
   * A narrow column is a reason to spend less on margins, not a reason to
   * ship a lesser editor.
   */
  compact?: boolean
}) {
  const [title, setTitle] = useState(note.title)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [aiBusy, setAiBusy] = useState(false)
  /** Set when "Ask AI" fires with nothing to work from — holds the range the
      answer should replace while the student types what they actually want. */
  /** `sel` is the highlighted text, carried so the instruction has a subject. */
  const [askAi, setAskAi] = useState<{ from: number; to: number; sel: string } | null>(null)
  const [askText, setAskText] = useState('')
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
    // The range is passed to `readContext` so the `/query` itself is not
    // counted as note content — see the note on its `typing` parameter.
    const range = { from: $from.start(), to: $from.pos }
    setSlash({ query, ...range, ctx: readContext(ed, range) })
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
        const { content_md, citations } = await noteAiInline(subspaceId, prompt)

        /**
         * Hand over the **raw markdown**, not a pre-parsed document.
         *
         * This line is why AI answers kept landing in the note as literal
         * `&lt;p&gt;consider a matrix…&lt;/p&gt;`, through three rounds of
         * "fixes" aimed at the backend that could never have worked — the
         * server's markdown was clean every time.
         *
         * `tiptap-markdown` OVERRIDES `insertContentAt` (and, via Tiptap
         * core's delegation, `insertContent`) so that it runs
         * `markdown.parser.parse()` on whatever it is given. Calling the
         * parser ourselves first meant parsing twice: pass one turned the
         * markdown into the HTML string `<p>…</p>`, and pass two fed that
         * HTML back through markdown-it — which is configured `html: false`,
         * so it dutifully escaped the tags into visible text.
         *
         * The escaping was never a sanitisation bug. It was the correct
         * output of a parser being run one time too many. Do not "helpfully"
         * pre-parse this again; the commands are already markdown-aware.
         */
        const markdown = content_md + sourceLine(citations, base)
        if (clearPlaceholder()) {
          editor.chain().insertContentAt(from, markdown).focus().run()
        } else {
          // The anchor moved under us, so append at the caret instead of
          // guessing — losing the position is not a reason to lose the answer.
          editor.chain().focus().insertContent(markdown).run()
        }
      } catch (err) {
        clearPlaceholder()
        showError(err)
      } finally {
        setAiBusy(false)
      }
    },
    // `base` builds the citation links. Leaving it out of the deps meant the
    // callback captured whichever topic was open when the editor first
    // mounted, so a citation added after navigating pointed into the previous
    // topic — a wrong link that still resolves, which is the kind that goes
    // unnoticed.
    [subspaceId, base, showError],
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
        // The one piece of discovery this editor needs. There is no permanent
        // toolbar any more, so this line is where `/` is learned.
        placeholder: 'Write, or press / to ask the tutor and add blocks…',
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
    // Healed on the way in. Notes written before the backend stopped
    // emitting escaped HTML have `&amp;lt;p&amp;gt;` saved in them, and every
    // save added another layer — see healHtml.ts. Repairing here means
    // opening the note fixes it, and the effect below writes the clean
    // version back so it stays fixed.
    content: healEscapedHtml(note.body_md),
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
        // The browser's own spell checker — red underline, right-click for
        // suggestions, the same behaviour as every other text field on the
        // machine. ProseMirror leaves this off by default.
        spellcheck: 'true',
        autocorrect: 'on',
        autocapitalize: 'sentences',
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

  /* Make the repair stick.
     `healEscapedHtml` fixes what's on screen the moment the note opens, but
     the database still holds the broken text until something writes. Saving
     it here means opening an affected note once is enough — without this, a
     note you read but don't edit would look fine and then come back broken. */
  useEffect(() => {
    if (!editor) return
    const healed = healEscapedHtml(note.body_md)
    if (healed !== note.body_md) saveBody(healed)
    // Runs once per opened note; saveBody is stable per note id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, note.id])

  /** Runs a chosen slash command and clears the `/query` that triggered it. */
  const applyCommand = useCallback(
    (cmd: SlashCommand) => {
      const ed = editorRef.current
      if (!ed || !slash) return
      const { from, to } = slash
      setSlash(null)

      if (cmd.ai) {
        // Whatever is selected becomes the subject of the command, so
        // "summarise" means "summarise THIS" when something is highlighted.
        const sel = ed.state.doc.textBetween(
          ed.state.selection.from,
          ed.state.selection.to,
          '\n',
        )
        /**
         * "Ask AI" ALWAYS asks. It is the one command with no verb of its
         * own — `summarise` and `expand` say what they will do, `ai` doesn't,
         * so firing it without instructions makes the model guess what the
         * student wanted and write something they never asked for.
         *
         * This used to be gated on the note being empty, which meant the
         * moment there was a single line on the page `/ai` silently fell back
         * to "continue this note from where it leaves off" — a prompt nobody
         * typed. Selected text becomes the subject of the instruction rather
         * than a replacement for it.
         */
        if (cmd.id === 'ai') {
          setAskAi({ from, to, sel: sel.trim() })
          return
        }
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
      {/* One quiet bar. Everything that used to compete for attention here —
          twelve format buttons and a bright Delete — has moved to where it is
          actually needed: marks onto the selection, Delete into a menu. */}
      <div
        className={cn(
          'flex shrink-0 items-center gap-2.5 border-b border-line py-2.5',
          compact ? 'px-3' : 'px-4 sm:px-8',
        )}
      >
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 flex items-center gap-1 rounded-[9px] px-1.5 py-1 text-[12.5px] text-ink-3 transition-colors hover:bg-line-soft md:hidden"
        >
          <Icon name="arrowLeft" size={13} /> Notes
        </button>

        {note.origin !== 'user' && (
          <Chip active>
            <Icon name="sparkle" size={10} /> {originLabel(note.origin)}
          </Chip>
        )}

        {/* Save state is a fact about the document, so it reads as one line of
            plain text rather than a badge — a green "Saved" pill on every
            keystroke is a reward for typing, which is not what this is. */}
        <span className="setcode flex items-center gap-1.5">
          {aiBusy ? (
            <>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
              Writing…
            </>
          ) : status === 'saving' ? (
            <>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sun" />
              Saving…
            </>
          ) : status === 'saved' ? (
            <span className="flex items-center gap-1 text-mint-deep">
              <Icon name="check" size={11} /> Saved
            </span>
          ) : status === 'error' ? (
            <span className="flex items-center gap-1 text-coral-deep">
              <Icon name="alert" size={11} /> Couldn’t save
            </span>
          ) : (
            `Edited ${relativeTime(note.updated_at)}`
          )}
        </span>

        {/* One click, labelled, and it says what it deletes.
            Burying this behind a gear was the wrong correction: it turned a
            one-click action into three (gear, menu item, confirm). The
            original problem was only that it was styled as loudly as a
            primary action — so it stays visible and stays one click, just
            quiet until you reach for it. The confirm dialog is the actual
            safety net. */}
        <button
          type="button"
          onClick={onDelete}
          className="ml-auto flex items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-[12.5px] text-muted transition-colors cursor-pointer hover:bg-coral-soft hover:text-coral-deep"
        >
          <Icon name="trash" size={13} /> Delete
        </button>
      </div>

      {/* Formatting follows the selection. Nothing on screen until there is
          something to format.

          **Four controls and a spill.** This used to render every heading,
          every mark, every block type and every AI action in one row — about
          seventeen buttons. On the full page it was merely long; in the chat
          dock it was wider than the column, so the last items were simply
          cut off by the panel edge and unreachable.

          Cutting features was not the answer: they are all worth having. What
          was wrong is that a selection toolbar had become a menu bar. The four
          things people reach for *while a selection is live* stay out; the rest
          moves one click away, where being a longer list costs nothing. */}
      {editor && (
        <BubbleMenu
          editor={editor}
          options={{ placement: 'top', offset: 8 }}
          className="max-w-[min(92vw,22rem)] rounded-[10px] border border-line bg-raised p-1 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.9)]"
        >
          <SelectionBar editor={editor} onAi={runInlineAi} />
        </BubbleMenu>
      )}

      {/* The page IS the leaf. It used to be a `bg-leaf` block sitting inside a
          `bg-canvas` scroller, and the one-step colour difference read as a
          narrow card floating in a void — the writing surface looked like a
          widget on the page rather than being the page. Same colour on both,
          so all that remains of the leaf is its margin rule. */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-leaf">
        {/* LEAF — the canonical case. A note is the one thing in this app you
            are *inside* rather than holding, so it gets the margin rule and a
            measure instead of a card's border and lift. `measure` caps the
            line at 66ch, which replaces the arbitrary `max-w-3xl`: 3xl is a
            width, 66ch is a reading length, and only one of those is about
            the text. */}
        {/* The note gets the whole surface — properly, this time.
            `.leaf`'s `border-left` drew a rule that had nothing to divide,
            because on a full-page editor the page already IS the leaf, and
            `leaf-measure`'s 66ch cap is right for a chat answer sitting among
            other content and wrong for a canvas you work inside. Both gone.

            What was still wrong after that: the padding escalated to `px-24`
            (96px) and the column capped at 68rem, so on a wide screen the
            writing started ~100px in from a pane that had ALREADY been
            narrowed twice — once by the rail, once by the note list. Three
            left edges in a row, and the third one arbitrary. It read as a
            document floating in a margin rather than a canvas.

            Now the gutter is small and stops growing: enough that glyphs
            aren't jammed against the divider, not so much that it becomes a
            design element. The cap only exists to stop a line running the full
            width of an ultrawide monitor, which no cap at all would allow —
            it is a last resort, not the layout. */}
        <div
          className={cn(
            'w-full',
            compact ? 'px-3 pb-16 pt-4' : 'px-5 pb-24 pt-10 sm:px-8 lg:px-10',
          )}
        >
          {/* The note arrives rather than snapping.
              `NoteEditor` is keyed on the note id, so switching notes remounts
              this and the rise plays per note — which is the moment worth
              marking, since it is the only point where the entire surface
              changes underneath you. Deliberately the app's `Rise` and not a
              bespoke tween: the editor was the last screen still cutting
              straight to its final state while every other one eased in.
              `distance` is smaller than the default because this is a
              full-height column, and 8px of travel on something this tall
              reads as the page settling rather than as content sliding. */}
          <Rise
            distance={5}
            className={cn(
              'flex min-h-full w-full flex-col gap-3',
              !compact && 'max-w-[110rem]',
            )}
          >
          {/* A title, not a form field. The bordered input made the first line
              of a note look like something to fill in rather than something to
              write. */}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled note"
            aria-label="Note title"
            className={cn(
              'nameplate w-full border-0 bg-transparent p-0 leading-tight text-ink outline-none placeholder:text-faint',
              compact ? 'text-[20px]' : 'text-[clamp(26px,3.2vw,36px)]',
            )}
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
            {/* Asking, not guessing. Appears in the same place the command
                list was, so the interaction reads as one continuous step:
                press /, pick Ask AI, say what you want. */}
            {askAi && (
              <div className="absolute left-0 right-0 top-0 z-30 rounded-xl border border-line bg-raised p-3 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)]">
                <div className="mb-2 flex items-center gap-1.5">
                  <Icon name="sparkle" size={12} className="text-sky-deep" />
                  <span className="setcode">
                    {askAi.sel ? 'What should I do with this?' : 'What should I write?'}
                  </span>
                </div>
                {/* Quoting the selection back proves what the instruction will
                    act on. Without it "explain this" is a promise the student
                    has to take on trust, and a stale selection looks identical
                    to the right one. */}
                {askAi.sel && (
                  <p className="mb-2 line-clamp-2 border-l-2 border-line pl-2 text-[12px] leading-snug text-muted">
                    {askAi.sel}
                  </p>
                )}
                <input
                  autoFocus
                  value={askText}
                  onChange={(e) => setAskText(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Escape') {
                      setAskAi(null)
                      setAskText('')
                      editorRef.current?.commands.focus()
                    }
                    if (e.key === 'Enter' && askText.trim()) {
                      e.preventDefault()
                      const { from, to, sel } = askAi
                      const instruction = askText.trim()
                      // The instruction leads and the selection follows as its
                      // subject, so the model is never left inferring which of
                      // the two is the actual request.
                      const prompt = sel
                        ? `${instruction}\n\nThe passage this refers to:\n"""\n${sel}\n"""`
                        : instruction
                      setAskAi(null)
                      setAskText('')
                      void runInlineAi(prompt, from, to)
                    }
                  }}
                  placeholder={
                    askAi.sel
                      ? 'e.g. explain this with a worked example'
                      : 'e.g. an overview of value iteration, with the update rule'
                  }
                  className="w-full rounded-[9px] border border-line bg-canvas px-2.5 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-faint focus:border-brand"
                />
                <p className="mt-2 text-[11.5px] text-muted">
                  Answers come from this topic’s material.{' '}
                  <span className="text-faint">Enter to write · Esc to cancel</span>
                </p>
              </div>
            )}

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

          </Rise>
        </div>
      </div>
    </div>
  )
}

/* ── Selection toolbar ────────────────────────────────────────────────── */

/**
 * What you reach for with a selection live, and everything else one click away.
 *
 * The old bar laid out every heading, mark, block type and AI action in a
 * single row — roughly seventeen controls. On the full page that was merely
 * long; in the 320px dock it was wider than the panel, so the right-hand end
 * was clipped by the column edge and the AI actions were unreachable there.
 *
 * The fix is not fewer features, it is a shorter *default*. Bold, italic and
 * one AI action cover the overwhelming majority of what a live selection wants;
 * headings and block conversions are structural edits you make deliberately,
 * and they read fine as a list. So the bar is four controls wide at any width,
 * and the list behind `⋯` can grow without ever threatening the layout again.
 */
function SelectionBar({
  editor,
  onAi,
}: {
  editor: Editor
  onAi: (prompt: string, from: number, to: number) => void
}) {
  const [open, setOpen] = useState(false)

  /** Runs an AI action against the current selection. */
  const runAction = useCallback(
    (action: (typeof SELECTION_ACTIONS)[number]) => {
      const { from, to } = editor.state.selection
      const sel = editor.state.doc.textBetween(from, to, '\n')
      if (!sel.trim()) return
      setOpen(false)
      // Non-replacing actions insert *after* the selection, so the range handed
      // over is the empty point at its end — consuming the passage you asked a
      // question *about* is never the intent.
      onAi(action.prompt(sel), action.replaces ? from : to, to)
    },
    [editor, onAi],
  )

  const primaryAi = SELECTION_ACTIONS[0]

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-0.5">
        {MARKS.filter((m) => m.key === 'bold' || m.key === 'italic').map((m) => (
          <button
            key={m.key}
            type="button"
            title={m.title}
            aria-label={m.title}
            onClick={() => m.run(editor)}
            className={cn(
              'grid h-7 w-7 place-items-center rounded-md text-[12.5px] transition-colors cursor-pointer',
              m.key === 'italic' && 'italic font-serif',
              m.key === 'bold' && 'font-bold',
              m.active(editor)
                ? 'bg-brand-soft text-brand-deep'
                : 'text-ink-3 hover:bg-line-soft hover:text-ink',
            )}
          >
            {m.icon ? <Icon name={m.icon} size={12} /> : m.label}
          </button>
        ))}

        <span className="mx-0.5 h-4 w-px bg-line" />

        {primaryAi && (
          <button
            type="button"
            title={`${primaryAi.label} — with AI, in place`}
            onClick={() => runAction(primaryAi)}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-semibold text-sky-deep transition-colors cursor-pointer hover:bg-sky-soft"
          >
            <Icon name="sparkle" size={12} />
            {primaryAi.label}
          </button>
        )}

        <span className="mx-0.5 h-4 w-px bg-line" />

        <button
          type="button"
          aria-label="More formatting"
          aria-expanded={open}
          title="More"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'grid h-7 w-7 place-items-center rounded-md transition-colors cursor-pointer',
            open ? 'bg-line-soft text-ink' : 'text-ink-3 hover:bg-line-soft hover:text-ink',
          )}
        >
          <Icon name="more" size={13} />
        </button>
      </div>

      {open && (
        <div className="mt-1 flex max-h-[46vh] flex-col gap-2 overflow-y-auto border-t border-line pt-2">
          <Group label="Heading">
            {HEADINGS.map((level) => (
              <Cell
                key={level}
                active={editor.isActive('heading', { level })}
                onClick={() => {
                  editor.chain().focus().toggleHeading({ level }).run()
                  setOpen(false)
                }}
              >
                H{level}
              </Cell>
            ))}
          </Group>

          <Group label="Style">
            {MARKS.filter((m) => m.key !== 'bold' && m.key !== 'italic').map((m) => (
              <Cell
                key={m.key}
                active={m.active(editor)}
                onClick={() => {
                  m.run(editor)
                  setOpen(false)
                }}
              >
                {m.icon ? <Icon name={m.icon} size={12} /> : m.label}
              </Cell>
            ))}
          </Group>

          <Group label="Block">
            {BLOCKS.map((b) => (
              <Cell
                key={b.key}
                active={b.active(editor)}
                title={b.title}
                onClick={() => {
                  b.run(editor)
                  setOpen(false)
                }}
              >
                {BLOCK_ICON[b.key] ? <Icon name={BLOCK_ICON[b.key]} size={12} /> : b.label}
              </Cell>
            ))}
          </Group>

          {SELECTION_ACTIONS.length > 1 && (
            <div className="flex flex-col gap-0.5">
              <span className="setcode px-1">With AI</span>
              {SELECTION_ACTIONS.slice(1).map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => runAction(action)}
                  className="flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-[12.5px] font-semibold text-sky-deep transition-colors cursor-pointer hover:bg-sky-soft"
                >
                  <Icon name="sparkle" size={11} />
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="setcode px-1">{label}</span>
      <div className="flex flex-wrap gap-0.5">{children}</div>
    </div>
  )
}

function Cell({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'grid h-7 w-7 place-items-center rounded-md text-[11.5px] font-bold transition-colors cursor-pointer',
        active ? 'bg-brand-soft text-brand-deep' : 'text-ink-3 hover:bg-line-soft hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}
