/**
 * Taking the "Thinking…" placeholder back out, and only the placeholder.
 *
 * Split out of `NoteEditor.tsx`'s `runInlineAi` closure for the same reason
 * `format.ts` / `toolbar.ts` were split out of `NotesView.tsx`: it is pure
 * ProseMirror logic with no React in it, and pulling it out is what makes it
 * directly testable with a real `Editor` instance rather than only reachable
 * by mounting the whole component and driving a contentEditable node.
 *
 * Two things this has to survive, both real shipped bugs:
 *
 * **A failed request.** The original version removed the placeholder on the
 * success path only, so any error — a dropped connection, a rate limit —
 * left the literal text "Thinking…" sitting in the student's note forever,
 * saved to the database with everything else. The caller must call this in
 * its `catch` too, not only on success.
 *
 * **A student who keeps typing.** The request is async, so by the time it
 * returns, the text at `from` may no longer be the placeholder at all —
 * deleting blindly would eat words the student just wrote. So the range is
 * verified before anything is removed; if it doesn't match, the document is
 * left alone and this returns `false` so the caller knows to fall back to
 * appending at the current caret instead of assuming the removal happened.
 */

import type { Editor } from '@tiptap/core'

export const AI_PLACEHOLDER = 'Thinking…'

/**
 * @returns `true` if the placeholder was found at `[from, from+placeholder)`
 *   and removed; `false` if the document had already changed underneath it,
 *   in which case nothing was touched.
 */
export function clearAiPlaceholder(
  editor: Editor,
  from: number,
  placeholder: string = AI_PLACEHOLDER,
): boolean {
  const end = from + placeholder.length
  if (end > editor.state.doc.content.size) return false
  if (editor.state.doc.textBetween(from, end) !== placeholder) return false
  editor.chain().deleteRange({ from, to: end }).run()
  return true
}
