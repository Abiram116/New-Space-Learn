/**
 * What the selection toolbar offers.
 *
 * Data, not markup — the bubble menu renders whatever is in these tables, so
 * adding a control is one entry rather than another block of JSX inside an
 * already-long component. Split out of `NotesView.tsx` when it crossed 1,100
 * lines, ahead of the notes work still queued in `docs/plan.md`.
 */

import type { Editor } from '@tiptap/react'
import type { IconName } from '../../components/ui/Icon'

/**
 * Formatting, shown only while text is selected.
 *
 * This replaced a permanent strip of twelve buttons labelled `H1 B I U S </>
 * •— 1. ☑ ❝`. Two things were wrong with it. It was always on screen, so every
 * note paid for chrome it wasn't using — and the glyphs were guesses: `•—` and
 * `❝` are not words, and `☑` renders differently on every platform.
 *
 * Marks belong on a selection because that is the only time they apply. Block
 * structure (headings, quote, code, table, to-do, image, divider) stays in the
 * `/` menu, because you only ever want those at the START of a block, which is
 * exactly when your hands are free to type `/`.
 */
export const MARKS: {
  key: string
  label: string
  icon?: IconName
  title: string
  run: (e: Editor) => void
  active: (e: Editor) => boolean
}[] = [
  { key: 'bold', label: 'B', title: 'Bold', run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive('bold') },
  { key: 'italic', label: 'I', title: 'Italic', run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive('italic') },
  { key: 'underline', label: 'U', title: 'Underline', run: (e) => e.chain().focus().toggleUnderline().run(), active: (e) => e.isActive('underline') },
  { key: 'strike', label: 'S', title: 'Strikethrough', run: (e) => e.chain().focus().toggleStrike().run(), active: (e) => e.isActive('strike') },
  { key: 'code', label: '', icon: 'code', title: 'Inline code', run: (e) => e.chain().focus().toggleCode().run(), active: (e) => e.isActive('code') },
]

/** Heading level, as a real choice rather than three separate toggles. */
export const HEADINGS = [1, 2, 3] as const

/**
 * Block shapes that are worth reaching for with text already selected.
 *
 * These were dropped when the permanent toolbar went, which was wrong: turning
 * a paragraph you just wrote into a quote or a list is a thing you do *to
 * existing text*, so a selection is exactly the right moment for it. `/` only
 * helps at the start of an empty block, which is the other half of the job.
 */
export const BLOCKS: {
  key: string
  label: string
  title: string
  run: (e: Editor) => void
  active: (e: Editor) => boolean
}[] = [
  { key: 'bulletList', label: '', title: 'Bulleted list', run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive('bulletList') },
  { key: 'orderedList', label: '', title: 'Numbered list', run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive('orderedList') },
  { key: 'taskList', label: '', title: 'To-do list', run: (e) => e.chain().focus().toggleTaskList().run(), active: (e) => e.isActive('taskList') },
  { key: 'blockquote', label: '', title: 'Quote', run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive('blockquote') },
]

/** Every block button draws the thing it makes. The row used to mix real
    icons with typed stand-ins — `••`, `1.`, a tick borrowed from the
    checkmark icon and a page glyph standing in for a quote — so half the
    buttons were pictures and half were guesses. */
export const BLOCK_ICON: Record<string, IconName> = {
  bulletList: 'listBullet',
  orderedList: 'listOrdered',
  taskList: 'listTodo',
  blockquote: 'quote',
}
