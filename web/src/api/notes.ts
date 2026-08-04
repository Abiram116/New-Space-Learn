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
