import { apiFetch } from './client'
import { onBackendReady } from '../lib/connectivity'
import { classifyError } from './errors'
import type { Deck, Flashcard, Grade, MaterialSource } from './types'

export const listDecks = (subspaceId: string) =>
  apiFetch<Deck[]>(`/subspaces/${subspaceId}/decks`)

/** Every deck the user has, wherever it lives — same reasoning as
 *  `listAllNotes`: a deck belongs to the student, not to whichever topic
 *  they happened to create it in. Each row carries its subspace/subject
 *  name so the list can say where a deck came from. */
export const listAllDecks = () => apiFetch<Deck[]>('/decks')

export const createDeck = (subspaceId: string, input: { name: string }) =>
  apiFetch<Deck>(`/subspaces/${subspaceId}/decks`, { method: 'POST', body: input })

export const renameDeck = (id: string, name: string) =>
  apiFetch<Deck>(`/decks/${id}`, { method: 'PATCH', body: { name } })

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

type PendingGrade = { cardId: string; grade: Grade; reviewId: string }
/** Grades that ran out of attempts, per card, oldest first. Kept (in memory)
 *  and sent again later: see `retryUnsavedGrades`. */
const parked = new Map<string, PendingGrade[]>()
/** Every grade with a failed attempt behind it that is not saved yet: the
 *  parked ones, and the ones still in their first round of retries. */
const unsaved = new Set<PendingGrade>()
const unsavedListeners = new Set<() => void>()

function setUnsaved(entry: PendingGrade, on: boolean): void {
  if (unsaved.has(entry) === on) return
  if (on) unsaved.add(entry)
  else unsaved.delete(entry)
  for (const fn of [...unsavedListeners]) fn()
}

/** True when a failed grade is worth sending again: the connection dropped,
 *  the request timed out, the server was unavailable or asked us to slow down.
 *  Anything the server actually refused (a 4xx) is not. */
export function gradeWillRetry(err: unknown): boolean {
  const kind = classifyError(err)
  return kind === 'offline' || kind === 'timeout' || kind === 'server' || kind === 'rate_limited'
}

/** How many grades have not reached the server yet. */
export const unsavedGradeCount = (): number => unsaved.size

/** Subscribe to `unsavedGradeCount` changing. Returns the unsubscribe function. */
export function onUnsavedGrades(fn: () => void): () => void {
  unsavedListeners.add(fn)
  return () => {
    unsavedListeners.delete(fn)
  }
}

const postGrade = (entry: PendingGrade) =>
  apiFetch<Flashcard>(`/cards/${entry.cardId}/grade`, {
    method: 'POST',
    body: { grade: entry.grade, review_id: entry.reviewId },
  })

/** Send one card's parked grades, oldest first, one attempt each. Throws on
 *  the first that still cannot be sent, leaving it and the rest parked. */
async function flushParked(cardId: string): Promise<void> {
  const list = parked.get(cardId)
  while (list && list.length > 0) {
    const entry = list[0]
    try {
      await postGrade(entry)
    } catch (err) {
      if (gradeWillRetry(err)) throw err
      // Refused (the card was deleted, say): it can never be saved, so let it go.
    }
    list.shift()
    setUnsaved(entry, false)
  }
  if (list && parked.get(cardId) === list) parked.delete(cardId)
}

function park(entry: PendingGrade): void {
  const list = parked.get(entry.cardId)
  if (list) list.push(entry)
  else parked.set(entry.cardId, [entry])
  setUnsaved(entry, true)
}

/** Run `task` after whatever this card is already sending. */
function afterCard<T>(cardId: string, task: () => Promise<T>): Promise<T> {
  const previous = gradeChain.get(cardId) ?? Promise.resolve()
  const mine = previous.catch(() => undefined).then(task)
  gradeChain.set(cardId, mine)
  const forget = () => {
    if (gradeChain.get(cardId) === mine) gradeChain.delete(cardId)
  }
  mine.then(forget, forget)
  return mine
}

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
 *
 * A grade that runs out of attempts still rejects (so the caller knows), but
 * it is kept, with its `review_id`, and sent again when the browser comes back
 * online, when another grade gets through, or on `retryUnsavedGrades()`.
 * Until then it is counted by `unsavedGradeCount()`.
 */
export function gradeCard(id: string, grade: Grade): Promise<Flashcard> {
  const entry: PendingGrade = { cardId: id, grade, reviewId: newReviewId() }
  const send = async (): Promise<Flashcard> => {
    try {
      // An earlier grade for this card that is still waiting goes first.
      await flushParked(id)
    } catch (err) {
      park(entry)
      throw err
    }
    for (let attempt = 0; ; attempt++) {
      try {
        const saved = await postGrade(entry)
        setUnsaved(entry, false)
        // The connection is evidently back: send whatever else is waiting.
        if (parked.size > 0) void retryUnsavedGrades()
        return saved
      } catch (err) {
        if (!gradeWillRetry(err)) {
          setUnsaved(entry, false)
          throw err
        }
        setUnsaved(entry, true)
        if (attempt >= GRADE_RETRY_MS.length) {
          park(entry)
          throw err
        }
        await new Promise((resolve) => setTimeout(resolve, GRADE_RETRY_MS[attempt]))
      }
    }
  }
  return afterCard(id, send)
}

let retrying: Promise<number> | null = null

/**
 * Send every grade that is still waiting, in order per card. Safe to call at
 * any time and as often as you like: each grade keeps its `review_id`, so one
 * the server already has is not applied twice. Resolves to how many are still
 * not saved.
 */
export function retryUnsavedGrades(): Promise<number> {
  if (retrying) return retrying
  const run = Promise.all(
    [...parked.keys()].map((cardId) =>
      afterCard(cardId, () => flushParked(cardId)).catch(() => undefined),
    ),
  ).then(() => unsaved.size)
  retrying = run
  const done = () => {
    if (retrying === run) retrying = null
  }
  run.then(done, done)
  return run
}

// Back online (the browser says so, or the server answered again): try at once.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void retryUnsavedGrades())
}
onBackendReady(() => void retryUnsavedGrades())

/** Test hook: forget every waiting grade. */
export function resetUnsavedGradesForTests(): void {
  parked.clear()
  unsaved.clear()
  gradeChain.clear()
  retrying = null
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
  input: {
    topic?: string
    count?: number
    deck_name?: string
    source_text?: string
    /** Where to write from; see `SourceChoice` in ./quizzes. */
    source?: MaterialSource
    note_id?: string
  },
) =>
  apiFetch<Flashcard[]>(`/subspaces/${subspaceId}/cards/generate`, {
    method: 'POST',
    body: input,
  })

/** `count` more cards written into an existing deck, from its topic's
 *  material and on what the deck is about, skipping fronts it already has.
 *  Returns only the new cards. */
export const extendDeck = (
  deckId: string,
  input: { count: number; source?: MaterialSource; note_id?: string },
) =>
  apiFetch<Flashcard[]>(`/decks/${deckId}/cards/generate`, { method: 'POST', body: input })
