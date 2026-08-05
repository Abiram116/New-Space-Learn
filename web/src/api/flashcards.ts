import { apiFetch } from './client'
import type { Deck, Flashcard, Grade } from './types'

export const listDecks = (subspaceId: string) =>
  apiFetch<Deck[]>(`/subspaces/${subspaceId}/decks`)

export const createDeck = (subspaceId: string, input: { name: string }) =>
  apiFetch<Deck>(`/subspaces/${subspaceId}/decks`, { method: 'POST', body: input })

export const deleteDeck = (id: string) =>
  apiFetch<{ ok: true }>(`/decks/${id}`, { method: 'DELETE' })

export const listCards = (deckId: string, opts?: { dueOnly?: boolean }) => {
  const qs = opts?.dueOnly ? '?due_only=true' : ''
  return apiFetch<Flashcard[]>(`/decks/${deckId}/cards${qs}`)
}

export const createCard = (
  deckId: string,
  input: { front: string; back: string; source?: string },
) => apiFetch<Flashcard>(`/decks/${deckId}/cards`, { method: 'POST', body: input })

export const gradeCard = (id: string, grade: Grade) =>
  apiFetch<Flashcard>(`/cards/${id}/grade`, { method: 'POST', body: { grade } })

export const updateCard = (
  id: string,
  input: { front?: string; back?: string; source?: string | null },
) => apiFetch<Flashcard>(`/cards/${id}`, { method: 'PATCH', body: input })

export const deleteCard = (id: string) =>
  apiFetch<{ ok: true }>(`/cards/${id}`, { method: 'DELETE' })

/** Ask the model for a whole deck at once. Returns the created cards. */
export const generateCards = (
  subspaceId: string,
  input: { topic?: string; count?: number; deck_name?: string; source_text?: string },
) =>
  apiFetch<Flashcard[]>(`/subspaces/${subspaceId}/cards/generate`, {
    method: 'POST',
    body: input,
  })
