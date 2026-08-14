import { apiFetch } from './client'
import type { Citation, Note } from './types'

export const listNotes = (subspaceId: string) =>
  apiFetch<Note[]>(`/subspaces/${subspaceId}/notes`)

/** Every note the user has, wherever it lives, newest first.
 *
 *  Scoping notes to whichever topic you happen to be sitting in was a
 *  restriction the data never justified — reading your Deadlock note while
 *  chatting about Virtual Memory is an ordinary thing to want. Each row carries
 *  its subspace and subject name so the list can say where a note came from. */
export const listAllNotes = () => apiFetch<Note[]>('/notes')

export const createNote = (
  subspaceId: string,
  input: { title: string; body_md?: string; origin?: 'user' | 'agent' | 'doc' },
) => apiFetch<Note>(`/subspaces/${subspaceId}/notes`, { method: 'POST', body: input })

export const updateNote = (id: string, input: { title?: string; body_md?: string }) =>
  apiFetch<Note>(`/notes/${id}`, { method: 'PATCH', body: input })

export const deleteNote = (id: string) =>
  apiFetch<{ ok: true }>(`/notes/${id}`, { method: 'DELETE' })

/** `instructions` is free text in the student's own words ("just a checklist",
 *  "go deep, I have an exam"). The backend places it last in the prompt and
 *  marks it as overriding the default shape guidance. Collected by
 *  `NoteBriefDialog`; optional, and omitting it reproduces the old behaviour. */
export const generateNote = (
  subspaceId: string,
  input: { topic?: string; instructions?: string },
) => apiFetch<Note>(`/subspaces/${subspaceId}/notes/generate`, { method: 'POST', body: input })

/** Backs the `/ai <prompt>` inline command — returns a markdown fragment
 *  to insert at the cursor, not a new note. `citations` is what the answer
 *  was actually built from — the same shape chat citations use (was a
 *  structurally-identical local duplicate, `NoteCitation`, until the
 *  end-to-end audit found it; deduplicated so a future field added to
 *  `Citation` doesn't silently fail to reach here). */
export const noteAiInline = (subspaceId: string, prompt: string) =>
  apiFetch<{ content_md: string; citations: Citation[] }>(
    `/subspaces/${subspaceId}/notes/ai-inline`,
    { method: 'POST', body: { prompt } },
  )
