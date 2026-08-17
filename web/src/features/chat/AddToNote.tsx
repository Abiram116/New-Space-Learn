/**
 * "Add to note" — the missing bridge between chat and Notes.
 *
 * Everything a chat answer can hold (prose, a worked example, the ASCII
 * diagram `guardrails.DIAGRAM_RULE` asks the model to draw for non-linear
 * structure, a code block) is already valid note markdown — `MarkdownMessage`
 * and the note editor render the same syntax. So this needs no format
 * conversion and no separate "diagram in notes" feature: whatever rendered
 * in the chat bubble renders identically once it's pasted into a note body.
 *
 * No live in-note cursor picker — that would require the target note to
 * already be open with a live cursor, which it usually isn't — you're
 * adding to a note from chat precisely because you're not in it. Instead,
 * an optional "insert after" marker: type a few words from the note and the
 * content lands right after the first line that matches (see
 * `insertAfterMarker.ts`). Left blank, or no match, it appends to the end —
 * the one placement that needs no such context and is never surprising.
 */

import { useEffect, useState } from 'react'
import { createNote, listNotes, updateNote } from '../../api/notes'
import type { Note } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { insertAfterMarker } from './insertAfterMarker'

export function AddToNoteButton({
  subspaceId,
  content,
}: {
  subspaceId: string
  content: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Add to note"
        aria-label="Add to note"
        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] text-brand transition-colors cursor-pointer hover:text-brand-deep"
      >
        <Icon name="note" size={12} /> Add to note
      </button>
      {open && (
        <AddToNoteModal subspaceId={subspaceId} content={content} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

function AddToNoteModal({
  subspaceId,
  content,
  onClose,
}: {
  subspaceId: string
  content: string
  onClose: () => void
}) {
  const { show, showError } = useToast()
  const [target, setTarget] = useState<'new' | string>('new')
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [insertAfter, setInsertAfter] = useState('')

  useEffect(() => {
    let cancelled = false
    listNotes(subspaceId)
      .then((rows) => {
        if (!cancelled) setNotes(rows)
      })
      .catch((err) => {
        if (!cancelled) showError(err)
      })
    return () => {
      cancelled = true
    }
    // showError is stable from useToast; including it would re-fetch on
    // every render for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subspaceId])

  const confirm = async () => {
    setBusy(true)
    try {
      if (target === 'new') {
        // No auto-derived title: a title guessed from a chat answer's first
        // line is exactly the ellipsis-terminated fragment problem an
        // earlier fix removed from flashcard deck naming. "Untitled note"
        // is the same starting point NotesView's own blank-note button
        // uses — renaming is one click away.
        // `content` is a verbatim assistant message (this button only
        // renders on those, never on the student's own turns) — the note's
        // entire body is AI-authored, so it's `origin: 'agent'`, same as
        // "Write with AI", not the default 'user'.
        await createNote(subspaceId, { title: 'Untitled note', body_md: content, origin: 'agent' })
        show('Added as a new note.', 'success')
      } else {
        const existing = notes?.find((n) => n.id === target)
        if (!existing) return
        const { body, found } = insertAfterMarker(existing.body_md, insertAfter, content)
        // `ai_touched`: the appended text is a verbatim AI answer, not
        // something typed — without this the save only marks
        // `touched_by_user` (it's the same generic PATCH typing goes
        // through), crediting an AI-written paragraph entirely to the
        // student who merely clicked "Add to note".
        await updateNote(existing.id, { body_md: body, ai_touched: true })
        show(
          insertAfter.trim() && !found
            ? `Couldn't find "${insertAfter.trim()}" — added to the end of "${existing.title || 'Untitled note'}" instead.`
            : `Added to "${existing.title || 'Untitled note'}".`,
          'success',
        )
      }
      onClose()
    } catch (err) {
      showError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Add to note" width="sm">
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-muted">
          Added as new content — nothing already in the note changes.
        </p>

        <label className="flex items-center gap-2 rounded-[10px] border border-line px-3 py-2.5 text-[13px] cursor-pointer">
          <input
            type="radio"
            name="add-to-note-target"
            checked={target === 'new'}
            onChange={() => setTarget('new')}
          />
          New note
        </label>

        <label
          className="flex items-center gap-2 rounded-[10px] border border-line px-3 py-2.5 text-[13px] cursor-pointer"
        >
          <input
            type="radio"
            name="add-to-note-target"
            checked={target !== 'new'}
            disabled={!notes || notes.length === 0}
            onChange={() => setTarget(notes?.[0]?.id ?? 'new')}
          />
          <span className="flex-1">Existing note</span>
        </label>

        {target !== 'new' && (
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            aria-label="Choose a note"
            className="w-full rounded-[9px] border border-line bg-canvas px-2.5 py-2 text-[13px] text-ink outline-none focus:border-brand"
          >
            {notes?.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title || 'Untitled note'}
              </option>
            ))}
          </select>
        )}

        {notes?.length === 0 && (
          <p className="text-[12px] text-faint">No notes in this topic yet — this'll start one.</p>
        )}

        {target !== 'new' && notes && notes.length > 0 && (
          <Input
            id="add-to-note-insert-after"
            label="Insert after (optional)"
            value={insertAfter}
            onChange={(e) => setInsertAfter(e.target.value)}
            placeholder="e.g. a heading or a few words from the note"
            hint="Lands right after the first matching line. Leave blank to add at the end."
          />
        )}

        <div className="mt-1 flex gap-2">
          <Button onClick={confirm} disabled={busy} className="flex-1">
            {busy ? 'Adding…' : 'Add'}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
