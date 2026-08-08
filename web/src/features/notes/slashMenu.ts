import type { Editor } from '@tiptap/react'
import type { IconName } from '../../components/ui/Icon'

/**
 * The `/` command set.
 *
 * Two kinds of command live here and the difference matters:
 *
 *   - **Structure** (`heading`, `quote`, `code`, `table`, …) runs instantly
 *     against the editor. No network, no waiting.
 *   - **AI** (`ai`, `summarise`, `toc`, `explain`, `expand`) sends a prompt to
 *     the backend and inserts what comes back.
 *
 * They are one menu because a student typing `/` is asking the same question
 * either way — "what can go here?" — but AI items are marked so nobody is
 * surprised by a spinner after picking what looked like a formatting option.
 *
 * `keywords` exist because people search for the thing, not its name: someone
 * wanting a checklist types "todo", not "task list".
 */

export type SlashCommand = {
  id: string
  label: string
  hint: string
  icon: IconName
  keywords: string[]
  /** AI commands take a prompt to the server; structure commands run locally. */
  ai?: (selectionText: string) => string
  run?: (editor: Editor) => void
}

export const SLASH_COMMANDS: SlashCommand[] = [
  // ── Structure ────────────────────────────────────────────────────────
  {
    id: 'h1',
    label: 'Heading 1',
    hint: 'Big section title',
    icon: 'note',
    keywords: ['h1', 'title', 'heading', 'big'],
    run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    label: 'Heading 2',
    hint: 'Section title',
    icon: 'note',
    keywords: ['h2', 'heading', 'subtitle'],
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    label: 'Heading 3',
    hint: 'Sub-section',
    icon: 'note',
    keywords: ['h3', 'heading', 'small'],
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'bullet',
    label: 'Bulleted list',
    hint: 'Unordered points',
    icon: 'note',
    keywords: ['bullet', 'list', 'ul', 'points'],
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'ordered',
    label: 'Numbered list',
    hint: 'Ordered steps',
    icon: 'note',
    keywords: ['number', 'ordered', 'ol', 'steps'],
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'todo',
    label: 'To-do list',
    hint: 'Checkboxes you can tick',
    icon: 'check',
    keywords: ['todo', 'task', 'check', 'checkbox', 'tick'],
    run: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'quote',
    label: 'Quote',
    hint: 'Set a passage apart',
    icon: 'note',
    keywords: ['quote', 'blockquote', 'citation'],
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'code',
    label: 'Code block',
    hint: 'Monospaced block',
    icon: 'agent',
    keywords: ['code', 'snippet', 'pre', 'monospace'],
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'table',
    label: 'Table',
    hint: '3×3 with a header row',
    icon: 'deck',
    keywords: ['table', 'grid', 'rows', 'columns'],
    run: (e) =>
      e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'toggle',
    label: 'Toggle section',
    hint: 'Collapsible — fold away what you know',
    icon: 'chevronRight',
    keywords: ['toggle', 'collapse', 'fold', 'accordion', 'details', 'expand'],
    run: (e) => e.chain().focus().setDetails().run(),
  },
  ...([1, 2, 3] as const).map((level) => ({
    id: `toggle-h${level}`,
    label: `Toggle heading ${level}`,
    hint: 'Collapsible section with a heading',
    icon: 'chevronRight' as IconName,
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
    keywords: ['divider', 'hr', 'rule', 'separator', 'line'],
    run: (e) => e.chain().focus().setHorizontalRule().run(),
  },
  {
    id: 'image',
    label: 'Image',
    hint: 'Upload from your device',
    icon: 'upload',
    keywords: ['image', 'picture', 'photo', 'upload', 'img'],
    // Handled by the editor component, which owns the file input.
  },

  // ── AI ───────────────────────────────────────────────────────────────
  {
    id: 'ai',
    label: 'Ask AI',
    hint: 'Write anything from your material',
    icon: 'sparkle',
    keywords: ['ai', 'ask', 'write', 'generate'],
    ai: (sel) => sel || 'Continue this note from where it leaves off.',
  },
  {
    id: 'summarise',
    label: 'Summarise',
    hint: 'Condense this note',
    icon: 'sparkle',
    keywords: ['summarise', 'summarize', 'tldr', 'condense', 'short'],
    ai: (sel) =>
      sel
        ? `Summarise this in three bullets, keeping only what would be tested:\n\n${sel}`
        : 'Summarise the note so far in three bullets, keeping only what would be tested.',
  },
  {
    id: 'toc',
    label: 'Table of contents',
    hint: 'Outline of this note',
    icon: 'doc',
    keywords: ['toc', 'contents', 'outline', 'index', 'structure'],
    ai: () =>
      'Write a table of contents for this note as a nested markdown bullet ' +
      'list of its headings. Headings only — no body text, no commentary.',
  },
  {
    id: 'explain',
    label: 'Explain simply',
    hint: 'Plain-language version',
    icon: 'skill',
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
    keywords: ['questions', 'practice', 'test', 'quiz', 'self'],
    ai: (sel) =>
      sel
        ? `Write three practice questions on this, with answers underneath each:\n\n${sel}`
        : 'Write three practice questions on this note, with answers underneath each.',
  },
]

/** Filters the set against what the user has typed after the slash. */
export function filterCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase()
  if (!q) return SLASH_COMMANDS
  return SLASH_COMMANDS.filter(
    (c) =>
      c.label.toLowerCase().includes(q) ||
      c.id.includes(q) ||
      c.keywords.some((k) => k.includes(q)),
  )
}
