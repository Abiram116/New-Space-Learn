import type { Editor } from '@tiptap/react'
import type { IconName } from '../../components/ui/Icon'

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
  icon: IconName
  group: SlashGroup
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
    hint: 'Plain-language version',
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
        ? `Write three practice questions on this, with answers underneath each:\n\n${sel}`
        : 'Write three practice questions on this note, with answers underneath each.',
  },
  {
    id: 'toc',
    label: 'Table of contents',
    hint: 'Outline of this note',
    icon: 'doc',
    group: 'ai',
    needs: 'headings',
    keywords: ['toc', 'contents', 'outline', 'index', 'structure'],
    ai: () =>
      'Write a table of contents for this note as a nested markdown bullet ' +
      'list of its headings. Headings only — no body text, no commentary.',
  },

  // ── Insert ───────────────────────────────────────────────────────────
  {
    id: 'h1',
    label: 'Heading 1',
    hint: 'Big section title',
    icon: 'note',
    group: 'insert',
    needs: 'nothing',
    keywords: ['h1', 'title', 'heading', 'big'],
    run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    label: 'Heading 2',
    hint: 'Section title',
    icon: 'note',
    group: 'insert',
    needs: 'nothing',
    keywords: ['h2', 'heading', 'subtitle'],
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    label: 'Heading 3',
    hint: 'Sub-section',
    icon: 'note',
    group: 'insert',
    needs: 'nothing',
    keywords: ['h3', 'heading', 'small'],
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'bullet',
    label: 'Bulleted list',
    hint: 'Unordered points',
    icon: 'note',
    group: 'insert',
    needs: 'nothing',
    keywords: ['bullet', 'list', 'ul', 'points'],
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'ordered',
    label: 'Numbered list',
    hint: 'Ordered steps',
    icon: 'note',
    group: 'insert',
    needs: 'nothing',
    keywords: ['number', 'ordered', 'ol', 'steps'],
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'todo',
    label: 'To-do list',
    hint: 'Checkboxes you can tick',
    icon: 'check',
    group: 'insert',
    needs: 'nothing',
    keywords: ['todo', 'task', 'check', 'checkbox', 'tick'],
    run: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'quote',
    label: 'Quote',
    hint: 'Set a passage apart',
    icon: 'note',
    group: 'insert',
    needs: 'nothing',
    keywords: ['quote', 'blockquote', 'citation'],
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'code',
    label: 'Code block',
    hint: 'Monospaced block',
    icon: 'agent',
    group: 'insert',
    needs: 'nothing',
    keywords: ['code', 'snippet', 'pre', 'monospace'],
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'table',
    label: 'Table',
    hint: '3×3 with a header row',
    icon: 'deck',
    group: 'insert',
    needs: 'nothing',
    keywords: ['table', 'grid', 'rows', 'columns'],
    run: (e) =>
      e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'toggle',
    label: 'Toggle section',
    hint: 'Collapsible — fold away what you know',
    icon: 'chevronRight',
    group: 'insert',
    needs: 'nothing',
    keywords: ['toggle', 'collapse', 'fold', 'accordion', 'details', 'expand'],
    run: (e) => e.chain().focus().setDetails().run(),
  },
  ...([1, 2, 3] as const).map((level) => ({
    id: `toggle-h${level}`,
    label: `Toggle heading ${level}`,
    hint: 'Collapsible section with a heading',
    icon: 'chevronRight' as IconName,
    group: 'insert' as SlashGroup,
    needs: 'nothing' as SlashNeeds,
    keywords: [`toggle${level}`, `toggleh${level}`, 'collapse', 'fold', 'heading', 'section'],
    /**
     * A toggle whose summary IS a heading, so a folded section still reads as
     * structure in the document outline rather than as an anonymous row.
     *
     * Two steps, not one: `setDetails` wraps the current block and drops the
     * caret into the summary, and only then can the heading be applied — the
     * summary node does not exist until the wrap has happened.
     */
    run: (e: Editor) => {
      e.chain().focus().setDetails().run()
      e.chain().focus().setNode('heading', { level }).run()
    },
  })),
  {
    id: 'divider',
    label: 'Divider',
    hint: 'Horizontal rule',
    icon: 'minus',
    group: 'insert',
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
export function readContext(editor: Editor): SlashContext {
  const { state } = editor
  const { from, to } = state.selection
  let headings = 0
  state.doc.descendants((node) => {
    if (node.type.name === 'heading') headings += 1
    return headings < 2
  })
  return {
    hasText: state.doc.textContent.trim().length > 0,
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
