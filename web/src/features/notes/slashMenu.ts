import type { Editor } from '@tiptap/react'
import type { IconName } from '../../components/ui/Icon'
import { BLOCK_ICON } from './toolbar'

/**
 * The `/` command set.
 *
 * Two kinds of command live here and the difference matters:
 *
 *   - **AI** (`ai`, `summarise`, `toc`, `explain`, `expand`, …) sends a prompt
 *     to the backend and inserts what comes back.
 *   - **Insert** (`heading`, `quote`, `code`, `table`, …) runs instantly
 *     against the editor. No network, no waiting.
 *
 * AI comes first in the menu because it is the reason this editor exists — the
 * structure commands are table stakes that every editor has.
 *
 * **Nothing here duplicates a gesture that already works.** There is no
 * "Insert image" command, because pasting a screenshot and dragging a file in
 * both already drop an image where you put it — a menu entry for that is a
 * longer way to do a thing you can already do in one motion.
 *
 * **Availability is contextual.** Half these commands are meaningless on a
 * blank note: "Summarise" with nothing to summarise used to sit there, fully
 * enabled, and produce an apology from the model. `needs` declares what a
 * command actually requires, and `availableCommands` filters on it — so an
 * empty note offers writing commands, and the rest appear as you write.
 *
 * `keywords` exist because people search for the thing, not its name: someone
 * wanting a checklist types "todo", not "task list".
 */

export type SlashGroup = 'ai' | 'insert'

/**
 * Sub-grouping inside `insert`, so a light section label appears when the
 * menu is scrolled through top to bottom rather than one flat 11-item list.
 * `ai` commands don't get one — 7 items reads fine as a single list, and the
 * "Ask the tutor" header already tells you what kind of thing you're
 * looking at, which is the actual job a section label does here.
 */
export type SlashSection = 'text' | 'lists' | 'structure' | 'code'

/**
 * What a command needs before it can do anything useful.
 *
 * - `nothing`  — always available (write from scratch, insert a block).
 * - `text`     — needs words in the note, or a selection, to act on.
 * - `headings` — needs actual headings; a table of contents of nothing is
 *                an empty list, which reads as a broken feature.
 */
export type SlashNeeds = 'nothing' | 'text' | 'headings'

export type SlashCommand = {
  id: string
  label: string
  hint: string
  /** Most commands draw an icon; H1/H2/H3 draw their own glyph instead (see
   *  `glyph`) — there is no icon for an arbitrary letter, the same reason
   *  the selection bar's bold/italic buttons are drawn as literal "B"/"I"
   *  rather than icons. Exactly one of `icon`/`glyph` is set. */
  icon?: IconName
  glyph?: string
  group: SlashGroup
  /** Only meaningful within `insert` — see `SlashSection`. */
  section?: SlashSection
  needs: SlashNeeds
  keywords: string[]
  /** AI commands take a prompt to the server; insert commands run locally. */
  ai?: (selectionText: string) => string
  run?: (editor: Editor) => void
}

/** What the document currently offers a command to work with. */
export type SlashContext = {
  /** Any non-whitespace text in the note at all. */
  hasText: boolean
  /** Text is currently selected — the command should act on *that*. */
  hasSelection: boolean
  /** The note contains at least two headings. */
  hasHeadings: boolean
}

export const SLASH_COMMANDS: SlashCommand[] = [
  // ── AI ───────────────────────────────────────────────────────────────
  {
    id: 'ai',
    label: 'Ask AI',
    hint: 'Write anything from your material',
    icon: 'sparkle',
    group: 'ai',
    needs: 'nothing',
    keywords: ['ai', 'ask', 'write', 'generate', 'draft'],
    ai: (sel) => sel || 'Continue this note from where it leaves off.',
  },
  {
    id: 'summarise',
    label: 'Summarise',
    hint: 'Condense to what would be tested',
    icon: 'sparkle',
    group: 'ai',
    needs: 'text',
    keywords: ['summarise', 'summarize', 'tldr', 'condense', 'short'],
    ai: (sel) =>
      sel
        ? `Summarise this in three bullets, keeping only what would be tested:\n\n${sel}`
        : 'Summarise the note so far in three bullets, keeping only what would be tested.',
  },
  {
    id: 'explain',
    label: 'Explain simply',
    hint: 'Rewrites it so you could repeat it back from memory',
    icon: 'skill',
    group: 'ai',
    needs: 'text',
    keywords: ['explain', 'simple', 'eli5', 'plain', 'clarify'],
    ai: (sel) =>
      sel
        ? `Explain this in plain language a student could repeat from memory:\n\n${sel}`
        : 'Explain the last thing in this note in plain language a student could repeat from memory.',
  },
  {
    id: 'expand',
    label: 'Expand',
    hint: 'Add depth and detail',
    icon: 'sparkle',
    group: 'ai',
    needs: 'text',
    keywords: ['expand', 'longer', 'detail', 'elaborate', 'more'],
    ai: (sel) =>
      sel
        ? `Expand this with detail grounded in the indexed material:\n\n${sel}`
        : 'Expand the last point in this note with detail grounded in the indexed material.',
  },
  {
    id: 'keypoints',
    label: 'Key points',
    hint: 'What matters for the exam',
    icon: 'target',
    group: 'ai',
    needs: 'text',
    keywords: ['key', 'points', 'important', 'exam', 'revise'],
    ai: (sel) =>
      sel
        ? `Pull out the key points from this as a bullet list:\n\n${sel}`
        : 'List the key points of this note — the things most likely to be examined.',
  },
  {
    id: 'questions',
    label: 'Practice questions',
    hint: 'Test yourself on this',
    icon: 'quiz',
    group: 'ai',
    needs: 'text',
    keywords: ['questions', 'practice', 'test', 'quiz', 'self'],
    ai: (sel) =>
      sel
        ? `Write three practice questions on this, with answers underneath each. ` +
          `Start with a "## Practice Questions" heading, then number the ` +
          `questions and put each answer as an indented line below its ` +
          `question, not as a separate list:\n\n${sel}`
        : 'Write three practice questions on this note, with answers underneath ' +
          'each. Start with a "## Practice Questions" heading, then number the ' +
          'questions and put each answer as an indented line below its question, ' +
          'not as a separate list.',
  },
  {
    id: 'toc',
    label: 'Table of contents',
    hint: 'Builds an outline from this note’s own headings',
    icon: 'doc',
    group: 'ai',
    needs: 'headings',
    keywords: ['toc', 'contents', 'outline', 'index', 'structure'],
    ai: () =>
      'Write a table of contents for this note as a nested markdown bullet ' +
      'list of its headings. Headings only — no body text, no commentary.',
  },

  // ── Insert ───────────────────────────────────────────────────────────
  // TEXT
  {
    id: 'h1',
    label: 'Heading 1',
    hint: 'Starts a new top-level section',
    glyph: 'H1',
    group: 'insert',
    section: 'text',
    needs: 'nothing',
    keywords: ['h1', 'title', 'heading', 'big'],
    run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    label: 'Heading 2',
    hint: 'Starts a sub-section under a Heading 1',
    glyph: 'H2',
    group: 'insert',
    section: 'text',
    needs: 'nothing',
    keywords: ['h2', 'heading', 'subtitle'],
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    label: 'Heading 3',
    hint: 'Starts a smaller sub-section under a Heading 2',
    glyph: 'H3',
    group: 'insert',
    section: 'text',
    needs: 'nothing',
    keywords: ['h3', 'heading', 'small'],
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'quote',
    label: 'Quote',
    hint: 'Sets a passage apart from your own writing',
    icon: BLOCK_ICON.blockquote,
    group: 'insert',
    section: 'text',
    needs: 'nothing',
    keywords: ['quote', 'blockquote', 'citation'],
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  // LISTS
  {
    id: 'bullet',
    label: 'Bulleted list',
    hint: 'For points with no set order',
    icon: BLOCK_ICON.bulletList,
    group: 'insert',
    section: 'lists',
    needs: 'nothing',
    keywords: ['bullet', 'list', 'ul', 'points'],
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'ordered',
    label: 'Numbered list',
    hint: 'For steps that happen in sequence',
    icon: BLOCK_ICON.orderedList,
    group: 'insert',
    section: 'lists',
    needs: 'nothing',
    keywords: ['number', 'ordered', 'ol', 'steps'],
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'todo',
    label: 'To-do list',
    hint: 'Checkboxes you can tick off as you revise',
    icon: BLOCK_ICON.taskList,
    group: 'insert',
    section: 'lists',
    needs: 'nothing',
    keywords: ['todo', 'task', 'check', 'checkbox', 'tick'],
    run: (e) => e.chain().focus().toggleTaskList().run(),
  },
  // CODE
  {
    id: 'code',
    label: 'Code block',
    hint: 'Monospaced, keeps whitespace, never autoformats',
    icon: 'code',
    group: 'insert',
    section: 'code',
    needs: 'nothing',
    keywords: ['code', 'snippet', 'pre', 'monospace'],
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  // STRUCTURE
  {
    id: 'table',
    label: 'Table',
    hint: 'Choose rows and columns, then fill it in',
    icon: 'table',
    group: 'insert',
    section: 'structure',
    needs: 'nothing',
    keywords: ['table', 'grid', 'rows', 'columns'],
    // No `run` — NoteEditor special-cases `cmd.id === 'table'` before this
    // would ever be reached, opening a size picker instead of inserting a
    // fixed grid. Every other `insert` command still runs straight from
    // here; table is the one that needs a size first.
  },
  {
    id: 'toggle',
    label: 'Toggle section',
    hint: 'Click the summary to fold the content away, or back open',
    icon: 'chevronRight',
    group: 'insert',
    section: 'structure',
    needs: 'nothing',
    keywords: ['toggle', 'collapse', 'fold', 'accordion', 'details', 'expand', 'heading'],
    /**
     * The summary is bolded on creation so a folded section still reads as
     * structure, not an anonymous row — this used to be three separate
     * "Toggle heading 1/2/3" commands that tried to `setNode('heading', ...)`
     * inside the summary, which silently did nothing on every level: a
     * `detailsSummary` node's content is declared `text*` by
     * `@tiptap/extension-details` (a real block node like a heading is never
     * a valid child of it), so `setNode` had nowhere valid to apply and
     * ProseMirror rejected the command every time. Bold is the closest a
     * plain-text-only node can get to "reads as a heading", and it actually
     * works.
     */
    run: (e: Editor) => {
      e.chain().focus().setDetails().run()
      e.chain().focus().setMark('bold').run()
    },
  },
  {
    id: 'divider',
    label: 'Divider',
    hint: 'A visual break between unrelated sections',
    icon: 'minus',
    group: 'insert',
    section: 'structure',
    needs: 'nothing',
    keywords: ['divider', 'hr', 'rule', 'separator', 'line'],
    run: (e) => e.chain().focus().setHorizontalRule().run(),
  },
]

/** Whether the document currently gives this command something to act on. */
function isAvailable(cmd: SlashCommand, ctx: SlashContext): boolean {
  switch (cmd.needs) {
    case 'text':
      // A selection is text to act on even in an otherwise-empty note.
      return ctx.hasText || ctx.hasSelection
    case 'headings':
      return ctx.hasHeadings
    default:
      return true
  }
}

/**
 * Reads the live document into a `SlashContext`.
 *
 * Deliberately cheap — this runs on every keystroke that keeps the menu open.
 * `doc.textContent` is a single walk ProseMirror already has to do, and the
 * heading count stops at two because that is all the threshold needs.
 */
export function readContext(
  editor: Editor,
  /**
   * The range holding the `/query` the student is currently typing.
   *
   * **Load-bearing.** Without it, `hasText` is true the instant someone types
   * `/ai` into an empty note — because "/ai" *is* text in the document — so
   * every "is this note blank" check silently answers no, and a blank note is
   * never treated as blank. That is a command being counted as content.
   */
  typing?: { from: number; to: number },
): SlashContext {
  const { state } = editor
  const { from, to } = state.selection
  let headings = 0
  state.doc.descendants((node) => {
    if (node.type.name === 'heading') headings += 1
    return headings < 2
  })
  // Subtract by length rather than by string-replace: the typed query is a
  // subset of the document text, but the same characters may legitimately
  // appear elsewhere in the note, and removing the wrong copy would be worse
  // than not removing one at all.
  const total = state.doc.textContent.trim().length
  const typed = typing
    ? state.doc.textBetween(typing.from, typing.to, '').trim().length
    : 0
  return {
    hasText: total - typed > 0,
    hasSelection: from !== to,
    hasHeadings: headings >= 2,
  }
}

/**
 * The commands worth showing, filtered by what the user typed AND by what the
 * document can actually support.
 *
 * Ordering is AI first, then inserts — the menu leads with the reason this
 * editor is different, not with the heading levels every editor has.
 */
export function availableCommands(
  query: string,
  ctx: SlashContext,
): SlashCommand[] {
  const q = query.trim().toLowerCase()
  const usable = SLASH_COMMANDS.filter((c) => isAvailable(c, ctx))
  const matched = !q
    ? usable
    : usable.filter(
        (c) =>
          c.label.toLowerCase().includes(q) ||
          c.id.includes(q) ||
          c.keywords.some((k) => k.includes(q)),
      )
  return [
    ...matched.filter((c) => c.group === 'ai'),
    ...matched.filter((c) => c.group === 'insert'),
  ]
}
