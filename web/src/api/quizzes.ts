import { apiFetch } from './client'
import type { Quiz, QuizResult } from './types'

export const listQuizzes = (subspaceId: string) =>
  apiFetch<Quiz[]>(`/subspaces/${subspaceId}/quizzes`)

/** Every quiz the user has, wherever it lives — same reasoning as
 *  `listAllNotes`. Each row carries its subspace/subject name so the list
 *  can say where a quiz came from. */
export const listAllQuizzes = () => apiFetch<Quiz[]>('/quizzes')

export const getQuiz = (id: string) => apiFetch<Quiz>(`/quizzes/${id}`)

export const generateQuiz = (
  subspaceId: string,
  input: { topic?: string; count?: number },
) =>
  apiFetch<Quiz>(`/subspaces/${subspaceId}/quiz/generate`, {
    method: 'POST',
    body: { topic: input.topic, count: input.count ?? 5 },
  })

/** `durationSeconds` is wall-clock time on the quiz — a study signal, never a
 *  grade input, and advisory since the client reports it. */
export const submitQuiz = (id: string, answers: number[], durationSeconds?: number) =>
  apiFetch<QuizResult>(`/quizzes/${id}/submit`, {
    method: 'POST',
    body: { answers, duration_seconds: durationSeconds },
  })
