import { apiFetch } from './client'
import type { Note } from './types'

export const listNotes = (subspaceId: string) =>
  apiFetch<Note[]>(`/subspaces/${subspaceId}/notes`)

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
 *  to insert at the cursor, not a new note. */
/** What an inline AI request was actually built from. */
export type NoteCitation = {
  marker: number
  document_id: string
  document_name: string
  locator: string
  snippet: string
}

export const noteAiInline = (subspaceId: string, prompt: string) =>
  apiFetch<{ content_md: string; citations: NoteCitation[] }>(
    `/subspaces/${subspaceId}/notes/ai-inline`,
    { method: 'POST', body: { prompt } },
  )
