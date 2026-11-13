/**
 * Telling an open note that its content changed somewhere else.
 *
 * "Add to note" saves straight to the server, but the note may already be
 * open — in the chat dock beside the answer, on the Notes page in another
 * tab. That editor holds its own copy and autosaves it, so the very next
 * keystroke there wrote the old body back and the added answer silently
 * vanished. Now the change is announced, and an open editor either reloads
 * the new body (nothing unsaved in it) or adds the same content to its own
 * copy (something unsaved, which a reload would throw away) — see
 * `NoteEditor`.
 *
 * `BroadcastChannel` reaches every tab of the app, including other listeners
 * in this one; a plain window event stands in where it doesn't exist. Each
 * message carries an id so no listener acts on the same change twice.
 */

import type { Note } from '../../api/types'

export type NoteSyncMessage = {
  id: string
  noteId: string
  /** The body as now saved on the server. */
  body_md: string
  updated_at: string
  touched_by_user: boolean
  touched_by_agent: boolean
  /** What was added, as editor-ready markdown — for an editor with unsaved work. */
  addition: string
}

const CHANNEL = 'spacelearn:notes'
const EVENT = 'spacelearn:note-sync'

function channel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL)
  } catch {
    return null
  }
}

export function announceNoteChange(note: Note, addition: string): void {
  const msg: NoteSyncMessage = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    noteId: note.id,
    body_md: note.body_md,
    updated_at: note.updated_at,
    touched_by_user: note.touched_by_user,
    touched_by_agent: note.touched_by_agent,
    addition,
  }
  const ch = channel()
  if (ch) {
    ch.postMessage(msg)
    ch.close()
  } else if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<NoteSyncMessage>(EVENT, { detail: msg }))
  }
}

const seen = new Set<string>()

/** Calls `onChange` for every announced change; returns the unsubscribe. */
export function onNoteChange(onChange: (msg: NoteSyncMessage) => void): () => void {
  const handle = (msg: NoteSyncMessage | undefined) => {
    if (!msg?.id || !msg.noteId) return
    const key = `${msg.id}:${listenerId}`
    if (seen.has(key)) return
    seen.add(key)
    onChange(msg)
  }
  const listenerId = Math.random().toString(36).slice(2)
  const ch = channel()
  const onMessage = (e: MessageEvent<NoteSyncMessage>) => handle(e.data)
  const onEvent = (e: Event) => handle((e as CustomEvent<NoteSyncMessage>).detail)
  ch?.addEventListener('message', onMessage)
  if (typeof window !== 'undefined') window.addEventListener(EVENT, onEvent)
  return () => {
    ch?.removeEventListener('message', onMessage)
    ch?.close()
    if (typeof window !== 'undefined') window.removeEventListener(EVENT, onEvent)
  }
}
