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
 *
 * "Needs no format conversion" turned out not to be quite true — citations,
 * math and appending to a saved note each needed work. That lives in
 * `notes/chatToNote.ts`, which this calls; see its header for the detail.
 * And when the target note is open somewhere (the dock, another tab), the
 * change is announced so that editor doesn't save its older copy over it —
 * see `notes/noteSync.ts`.
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createNote, listNotes, updateNote } from '../../api/notes'
import type { Citation, Note } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { writeCache } from '../../lib/asyncCache'
import { LIMITS } from '../../lib/limits'
import { appendReply, chatReplyToMarkdown, titleFromReply } from '../notes/chatToNote'
import { announceNoteChange } from '../notes/noteSync'

/** The note last added to, per topic — so adding a run of answers to one note is one tap each. */
const lastTargetKey = (subspaceId: string) => `addToNote:last:${subspaceId}`

function readLastTarget(subspaceId: string): string | null {
  try {
    return window.localStorage.getItem(lastTargetKey(subspaceId))
  } catch {
    return null
  }
}

function rememberTarget(subspaceId: string, noteId: string) {
  try {
    window.localStorage.setItem(lastTargetKey(subspaceId), noteId)
  } catch {
    // Private mode or blocked storage: the default is just "New note" again.
  }
}

export function AddToNoteButton({
  subspaceId,
  content,
  citations,
}: {
  subspaceId: string
  content: string
  /** The answer's sources. With them, `[[n]]` markers become "(p. 4)"
   *  references and a Sources line; without, the markers are dropped. */
  citations?: Citation[] | null
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Add to note"
        aria-label="Add to note"
        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[12.5px] text-brand transition-colors cursor-pointer hover:text-brand-deep"
      >
        <Icon name="note" size={12} /> Add to note
      </button>
      {open && (
        <AddToNoteModal
          subspaceId={subspaceId}
          content={content}
          citations={citations ?? []}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function AddToNoteModal({
  subspaceId,
  content,
  citations,
  onClose,
}: {
  subspaceId: string
  content: string
  citations: Citation[]
  onClose: () => void
}) {
  const { show, showError } = useToast()
  const navigate = useNavigate()
  const [target, setTarget] = useState<'new' | string>('new')
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [insertAfter, setInsertAfter] = useState('')
  const [title, setTitle] = useState(() => titleFromReply(content))
  /** Set once the content is saved: the dialog becomes "Added — open it?". */
  const [done, setDone] = useState<{ id: string; title: string } | null>(null)
  // A second click while the first request is still out — or a fast double
  // click, which can land before `busy` disables the button — used to add the
  // answer twice. The ref is checked synchronously, so it can't.
  const inFlight = useRef(false)

  useEffect(() => {
    let cancelled = false
    listNotes(subspaceId)
      .then((rows) => {
        if (cancelled) return
        setNotes(rows)
        const last = readLastTarget(subspaceId)
        if (last && rows.some((n) => n.id === last)) setTarget(last)
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
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      const markdown = chatReplyToMarkdown(content, citations)
      let saved: { id: string; title: string }
      if (target === 'new') {
        // The title is the reply's own heading when it opens with one,
        // editable here; never a sentence cut off mid-way (the ellipsis
        // fragment problem an earlier fix removed from flashcard deck
        // naming). Blank falls back to "Untitled note", the same starting
        // point NotesView's own blank-note button uses.
        // `content` is a verbatim assistant message (this button only
        // renders on those, never on the student's own turns) — the note's
        // entire body is AI-authored, so it's `origin: 'agent'`, same as
        // "Write with AI", not the default 'user'. Stored raw, like a
        // generated note: the editor protects its math on first open.
        const created = await createNote(subspaceId, {
          title: title.trim() || 'Untitled note',
          body_md: markdown,
          origin: 'agent',
        })
        saved = { id: created.id, title: created.title }
        show('Added as a new note.', 'success')
      } else {
        // Read the note again right before writing: the copy listed when
        // this dialog opened may be minutes old, and anything saved since
        // (typing in another tab) would be overwritten by it.
        const fresh = await listNotes(subspaceId).catch(() => notes ?? [])
        const existing = fresh.find((n) => n.id === target) ?? notes?.find((n) => n.id === target)
        if (!existing) {
          showError(new Error('That note no longer exists — pick another, or add a new one.'))
          return
        }
        const { body, found, block } = appendReply(existing, markdown, insertAfter)
        // `ai_touched`: the appended text is a verbatim AI answer, not
        // something typed — without this the save only marks
        // `touched_by_user` (it's the same generic PATCH typing goes
        // through), crediting an AI-written paragraph entirely to the
        // student who merely clicked "Add to note".
        const updated = await updateNote(existing.id, { body_md: body, ai_touched: true })
        // An open copy of this note (dock, other tab) would otherwise save
        // its older body over this one.
        announceNoteChange({ ...existing, ...updated, body_md: updated?.body_md ?? body }, block)
        const name = existing.title || 'Untitled note'
        saved = { id: existing.id, title: name }
        show(
          insertAfter.trim() && !found
            ? `Couldn't find "${insertAfter.trim()}" — added to the end of "${name}" instead.`
            : `Added to "${name}".`,
          'success',
        )
      }
      rememberTarget(subspaceId, saved.id)
      /* The sidebar counts notes from the shared `notes:` list, and saving
         only marks that list out of date — nothing on screen reads it again,
         so "Notes 0" stayed 0 and the Practice step stayed undone until a
         panel was opened. Read it once here and hand it to everyone showing it. */
      void listNotes(subspaceId)
        .then((rows) => writeCache(`notes:${subspaceId}`, rows))
        .catch(() => undefined)
      setDone(saved)
    } catch (err) {
      showError(err)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Modal open onClose={onClose} title="Added to your note" width="sm">
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-[13px] text-ink-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-mint-soft text-mint-deep">
              <Icon name="check" size={13} />
            </span>
            <span className="min-w-0">
              Saved in <span className="font-semibold text-ink">“{done.title}”</span>, with its
              formatting, formulas and sources.
            </span>
          </p>
          <div className="mt-1 flex gap-2">
            <Button
              className="flex-1"
              onClick={() => {
                onClose()
                navigate(`/notes?n=${done.id}`)
              }}
            >
              Open note
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </Modal>
    )
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

        {target === 'new' && (
          <Input
            id="add-to-note-title"
            label="Title"
            value={title}
            maxLength={LIMITS.noteTitle}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled note"
          />
        )}

        <label
          className="flex items-center gap-2 rounded-[10px] border border-line px-3 py-2.5 text-[13px] cursor-pointer"
        >
          <input
            type="radio"
            name="add-to-note-target"
            checked={target !== 'new'}
            disabled={!notes || notes.length === 0}
            onChange={() => setTarget(readLastTargetIn(subspaceId, notes) ?? notes?.[0]?.id ?? 'new')}
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
            hint="Lands under the first matching heading, or after the paragraph, list or code block it's in. Leave blank to add at the end."
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

/** The remembered note, if it is still in this list. */
function readLastTargetIn(subspaceId: string, notes: Note[] | null): string | null {
  const last = readLastTarget(subspaceId)
  return last && notes?.some((n) => n.id === last) ? last : null
}
