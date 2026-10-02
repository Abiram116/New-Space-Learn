import { apiFetch } from './client'
import { classifyError } from './errors'
import type { Deck, Flashcard, Grade } from './types'

export const listDecks = (subspaceId: string) =>
  apiFetch<Deck[]>(`/subspaces/${subspaceId}/decks`)

/** Every deck the user has, wherever it lives — same reasoning as
 *  `listAllNotes`: a deck belongs to the student, not to whichever topic
 *  they happened to create it in. Each row carries its subspace/subject
 *  name so the list can say where a deck came from. */
export const listAllDecks = () => apiFetch<Deck[]>('/decks')

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

/** Waits before the 2nd, 3rd and 4th attempt at a grade. */
const GRADE_RETRY_MS = [600, 1800, 4000]
/** The grade in flight for each card, so a card's grades are sent in order. */
const gradeChain = new Map<string, Promise<unknown>>()

/**
 * Record a grade — and don't lose it to a blip.
 *
 * Review moves on the moment you grade, so a failed request used to mean the
 * card silently stayed due. Each grade now carries a one-time `review_id`: the
 * server applies an id once and answers a repeat with the same result, which
 * makes it safe to re-send when the connection dropped, the request timed out
 * or the server was briefly unavailable. Anything the server actually refused
 * (a 4xx) is not retried.
 *
 * Grades for the same card go out one after another: an "Again" re-queues the
 * card in the same session, and its second grade must not overtake the first.
 */
export function gradeCard(id: string, grade: Grade): Promise<Flashcard> {
  const reviewId = newReviewId()
  const send = async (): Promise<Flashcard> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await apiFetch<Flashcard>(`/cards/${id}/grade`, {
          method: 'POST',
          body: { grade, review_id: reviewId },
        })
      } catch (err) {
        const kind = classifyError(err)
        const worthRetrying = kind === 'offline' || kind === 'timeout' || kind === 'server'
        if (!worthRetrying || attempt >= GRADE_RETRY_MS.length) throw err
        await new Promise((resolve) => setTimeout(resolve, GRADE_RETRY_MS[attempt]))
      }
    }
  }
  const previous = gradeChain.get(id) ?? Promise.resolve()
  const mine = previous.catch(() => undefined).then(send)
  gradeChain.set(id, mine)
  const forget = () => {
    if (gradeChain.get(id) === mine) gradeChain.delete(id)
  }
  mine.then(forget, forget)
  return mine
}

function newReviewId(): string {
  // randomUUID needs a secure context; the fallback is for plain-http dev hosts.
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

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
