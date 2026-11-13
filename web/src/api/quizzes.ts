import { apiFetch } from './client'
import type { MaterialSource, Quiz, QuizResult, QuizReword } from './types'

export const listQuizzes = (subspaceId: string) =>
  apiFetch<Quiz[]>(`/subspaces/${subspaceId}/quizzes`)

/** Every quiz the user has, wherever it lives — same reasoning as
 *  `listAllNotes`. Each row carries its subspace/subject name so the list
 *  can say where a quiz came from. */
export const listAllQuizzes = () => apiFetch<Quiz[]>('/quizzes')

export const getQuiz = (id: string) => apiFetch<Quiz>(`/quizzes/${id}`)

/** Rename a quiz. `topic` is the line the lists show as its name. */
export const renameQuiz = (id: string, topic: string) =>
  apiFetch<Quiz>(`/quizzes/${id}`, { method: 'PATCH', body: { topic } })

/** Delete a quiz and every attempt at it. */
export const deleteQuiz = (id: string) =>
  apiFetch<{ ok: true }>(`/quizzes/${id}`, { method: 'DELETE' })

/** Where to write from. Left out, the server uses the topic's files with the
 *  recent chat (what every quiz did before there was a choice). */
export type SourceChoice = { source?: MaterialSource; note_id?: string }

export const generateQuiz = (
  subspaceId: string,
  input: { topic?: string; count?: number } & SourceChoice,
) =>
  apiFetch<Quiz>(`/subspaces/${subspaceId}/quiz/generate`, {
    method: 'POST',
    body: { topic: input.topic, count: input.count ?? 5, source: input.source, note_id: input.note_id },
  })

/** `count` more questions appended to the end of an existing quiz, from its
 *  topic and focus, skipping what it already asks. Returns the whole quiz. */
export const extendQuiz = (id: string, input: { count: number } & SourceChoice) =>
  apiFetch<Quiz>(`/quizzes/${id}/extend`, { method: 'POST', body: input })

/** The quiz reworded and reshuffled for a retake. Nothing is stored; submit
 *  the answers mapped back with `toStoredAnswers` (features/quizzes/variant). */
export const rewordQuiz = (id: string) =>
  apiFetch<QuizReword>(`/quizzes/${id}/reword`, { method: 'POST' })

/** `durationSeconds` is wall-clock time on the quiz — a study signal, never a
 *  grade input, and advisory since the client reports it. */
export const submitQuiz = (id: string, answers: number[], durationSeconds?: number) =>
  apiFetch<QuizResult>(`/quizzes/${id}/submit`, {
    method: 'POST',
    body: { answers, duration_seconds: durationSeconds },
  })
