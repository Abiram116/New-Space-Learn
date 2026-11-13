/**
 * The note editor's schema and behaviour, as one list.
 *
 * Lifted out of `NoteEditor.tsx` so tests can build an editor with exactly the
 * configuration students get. The round-trip bugs this editor has had — math
 * losing its backslashes, AI answers arriving as escaped HTML — all lived in
 * the seam between these extensions and the markdown parser, and a test with
 * a reduced extension list is precisely what let them through.
 */

import type { Extensions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { TableKit } from '@tiptap/extension-table'
import { DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { createLowlight, common } from 'lowlight'
import { Markdown } from 'tiptap-markdown'
import { AiMarks } from './aiMarks'
import { DetailsWithMarkdown } from './detailsMarkdown'
import { ImageBlock } from './ImageBlock'
import { MathPreview } from './mathPreview'

const lowlight = createLowlight(common)

export function noteExtensions(): Extensions {
  return [
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
    DetailsWithMarkdown.configure({
      persist: true,
      HTMLAttributes: { class: 'notes-toggle' },
      // The extension's default button sets only an aria-label — no
      // visible glyph at all, so the disclosure control renders as an
      // empty, invisible box. Draw the same chevron used elsewhere in the
      // app (see Icon.tsx's 'chevronRight') and rotate it in place.
      renderToggleButton: ({ element, isOpen }) => {
        element.setAttribute('aria-label', isOpen ? 'Collapse section' : 'Expand section')
        if (!element.querySelector('svg')) {
          element.innerHTML =
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9.5 6 6 6-6 6"/></svg>'
        }
        const svg = element.querySelector('svg')
        if (svg) svg.style.transform = isOpen ? 'rotate(90deg)' : 'rotate(0deg)'
      },
    }),
    DetailsSummary,
    DetailsContent,
    Markdown.configure({ html: false, transformPastedText: true }),
    // Renders LaTeX as live KaTeX, and keeps pasted formulas intact — see
    // mathPreview.ts.
    MathPreview,
    // The "AI is writing" placeholder and the source line under AI-written
    // passages — see aiMarks.ts.
    AiMarks,
  ]
}
