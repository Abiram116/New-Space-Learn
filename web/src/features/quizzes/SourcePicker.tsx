/**
 * "Make it from…" — the topic's files, one note, every note, the recent chat,
 * or the model's own knowledge. Shared by every place a quiz or deck is
 * generated or added to, so they all offer the same choices in the same words.
 *
 * General knowledge is never a quiet fallback: it is only used when picked
 * here, it says what it means right under the picker, and it is never
 * remembered as the default — the next quiz starts from material again.
 */

import { useEffect, useState } from 'react'
import { listNotes } from '../../api/notes'
import type { MaterialSource, Note } from '../../api/types'
import { Select } from '../../components/ui/Select'

export type SourceKind = 'files' | 'note' | 'notes' | 'chat' | 'general'
export type PickedSource = { kind: SourceKind; noteId?: string }

const REMEMBER_KEY = 'sl:gen-source:v1'
/** Only these are remembered: a note is specific to one, and general
 *  knowledge must be chosen on purpose each time. */
const REMEMBERED: SourceKind[] = ['files', 'notes', 'chat']

export function rememberedSource(): PickedSource {
  try {
    const v = window.localStorage.getItem(REMEMBER_KEY) as SourceKind | null
    if (v && REMEMBERED.includes(v)) return { kind: v }
  } catch {
    /* blocked storage: the default */
  }
  return { kind: 'files' }
}

export function rememberSource(p: PickedSource): void {
  try {
    if (REMEMBERED.includes(p.kind)) window.localStorage.setItem(REMEMBER_KEY, p.kind)
  } catch {
    /* doesn't persist; nothing else changes */
  }
}

/** The request fields for a pick. */
export function sourceBody(p: PickedSource): { source: MaterialSource; note_id?: string } {
  if (p.kind === 'note') return { source: 'notes', note_id: p.noteId }
  return { source: p.kind }
}

/** A note has to be picked before "one note" can be sent. */
export const sourceReady = (p: PickedSource) => p.kind !== 'note' || Boolean(p.noteId)

const OPTIONS: { value: SourceKind; label: string }[] = [
  { value: 'files', label: 'Your files in this topic' },
  { value: 'note', label: 'One of your notes' },
  { value: 'notes', label: 'All your notes in this topic' },
  { value: 'chat', label: "This topic's recent chat" },
  { value: 'general', label: "The AI's general knowledge" },
]

const HINT: Record<SourceKind, string> = {
  files: 'Drawn from the documents you added.',
  note: 'Only what that note says (its last saved version).',
  notes: 'Spread across every note in this topic.',
  chat: 'From what you and the AI said in this topic lately.',
  general: 'Not from your material — answers are checked by the AI, not against your files.',
}

export function SourcePicker({
  topicId,
  value,
  onChange,
}: {
  /** The topic whose notes are offered. */
  topicId: string
  value: PickedSource
  onChange: (next: PickedSource) => void
}) {
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [notesError, setNotesError] = useState(false)
  const wantsNotes = value.kind === 'note'

  useEffect(() => {
    if (!wantsNotes) return
    let live = true
    setNotes(null)
    setNotesError(false)
    listNotes(topicId)
      .then((n) => live && setNotes(n))
      .catch(() => live && setNotesError(true))
    return () => {
      live = false
    }
  }, [wantsNotes, topicId])

  // The picked note was deleted (or belongs to another topic): pick again.
  useEffect(() => {
    if (wantsNotes && notes && value.noteId && !notes.some((n) => n.id === value.noteId)) {
      onChange({ kind: 'note' })
    }
  }, [wantsNotes, notes, value.noteId, onChange])

  return (
    <div className="flex flex-col gap-1.5">
      <span className="setcode">Make it from</span>
      <Select
        value={value.kind}
        onChange={(k) => onChange({ kind: k as SourceKind })}
        ariaLabel="Make it from"
        options={OPTIONS}
      />
      {wantsNotes &&
        (notesError ? (
          <p className="text-[12px] text-coral-deep">Couldn't load your notes. Close this and try again.</p>
        ) : notes === null ? (
          <p className="text-[12px] text-faint">Loading your notes…</p>
        ) : notes.length === 0 ? (
          <p className="text-[12px] text-coral-deep">This topic has no notes yet. Write one first, or pick another source.</p>
        ) : (
          <Select
            value={value.noteId ?? ''}
            onChange={(id) => onChange({ kind: 'note', noteId: id })}
            ariaLabel="Which note"
            options={[
              ...(value.noteId ? [] : [{ value: '', label: 'Pick a note…' }]),
              ...notes.map((n) => ({ value: n.id, label: n.title || 'Untitled note' })),
            ]}
          />
        ))}
      <p className={value.kind === 'general' ? 'text-[12px] text-coral-deep' : 'text-[12px] text-faint'}>
        {HINT[value.kind]}
      </p>
    </div>
  )
}
