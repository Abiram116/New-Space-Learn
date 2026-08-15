/**
 * Split out of `NoteEditor.tsx`'s `runInlineAi`, same reason `aiPlaceholder.ts`
 * is its own file: pure ProseMirror logic with no React in it, directly
 * testable against a real `Editor` instance rather than only reachable by
 * mounting the whole component.
 *
 * After inserting AI content, land the cursor in a fresh empty paragraph —
 * never wherever ProseMirror's default post-insertion selection happens to
 * fall, which can be inside whatever mark-laden node the content ended
 * with. This was a real, reported bug: an AI answer with citations ends in
 * `*Source: [name](url)*` — a paragraph carrying `em` and `link` marks — and
 * the cursor landed inside that paragraph's text. Typing `/` right after
 * appended it to the end of "...offset 100" instead of starting a fresh
 * line, so `/` could never be read as a command (a paragraph's text has to
 * START with `/`, not merely contain one) — the slash menu simply couldn't
 * open until the student manually pressed Enter first.
 */

import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

export function landInFreshParagraph(editor: Editor): void {
  const endPos = editor.state.selection.to
  const $end = editor.state.doc.resolve(endPos)
  const atEmptyParagraph = $end.parent.type.name === 'paragraph' && $end.parent.content.size === 0
  if (atEmptyParagraph) {
    editor.chain().focus().setTextSelection(endPos).run()
    return
  }
  // A hand-computed `endPos + 1` is not reliable here — the exact position
  // "inside" a freshly inserted empty node depends on the surrounding
  // schema and isn't always one past where the insert started. ProseMirror
  // already has the correct way to ask this: find the nearest valid text
  // selection to a target position in the document as it stands right now.
  editor
    .chain()
    .insertContentAt(endPos, { type: 'paragraph' })
    .command(({ tr, dispatch }) => {
      if (dispatch) tr.setSelection(TextSelection.near(tr.doc.resolve(endPos + 1)))
      return true
    })
    .focus()
    .run()
}
