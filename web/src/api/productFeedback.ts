import { apiFetch } from './client'

/**
 * The feedback form (Settings › Feedback, and the landing page's Feedback
 * card) — not `api/feedback.ts`, which is the thumbs on individual AI answers.
 *
 * The questions come from the server so the two admins can change them without
 * a deploy; the form renders whatever it is given, by `kind`.
 */

export type QuestionKind = 'rating' | 'scale' | 'choice' | 'multi' | 'short' | 'long'

export type FeedbackQuestion = {
  id: string
  position: number
  prompt: string
  kind: QuestionKind
  options: string[]
  required: boolean
  active: boolean
}

export type AnswerValue = number | string | string[]
export type FeedbackAnswer = { question_id: string; value: AnswerValue }

/** Public: a signed-out visitor on the landing page reads this too. */
export const getFeedbackForm = () => apiFetch<FeedbackQuestion[]>('/feedback-form')

export const sendProductFeedback = (input: {
  source: 'landing' | 'settings'
  answers: FeedbackAnswer[]
  contact_email?: string
  page?: string
  /** The bot trap: a field no person sees. Always sent as typed (empty). */
  website?: string
}) => apiFetch<{ ok: true }>('/product-feedback', { method: 'POST', body: input })

// ── Admin ──────────────────────────────────────────────────────────────

export const amIAdmin = () => apiFetch<{ admin: boolean }>('/me/admin')

export const listQuestions = () => apiFetch<FeedbackQuestion[]>('/admin/feedback/questions')

export const createQuestion = (input: {
  prompt: string
  kind: QuestionKind
  options?: string[]
  required?: boolean
}) => apiFetch<FeedbackQuestion>('/admin/feedback/questions', { method: 'POST', body: input })

export const updateQuestion = (
  id: string,
  patch: Partial<Pick<FeedbackQuestion, 'prompt' | 'options' | 'required' | 'active'>>,
) => apiFetch<FeedbackQuestion>(`/admin/feedback/questions/${id}`, { method: 'PATCH', body: patch })

export const deleteQuestion = (id: string) =>
  apiFetch<{ ok: true }>(`/admin/feedback/questions/${id}`, { method: 'DELETE' })

export const reorderQuestions = (ids: string[]) =>
  apiFetch<{ ok: true }>('/admin/feedback/questions/reorder', { method: 'POST', body: { ids } })

export type StoredAnswer = { question_id: string; prompt: string; kind: QuestionKind; value: AnswerValue }
export type FeedbackResponse = {
  id: string
  created_at: string
  source: 'landing' | 'settings'
  signed_in: boolean
  contact_email: string | null
  page: string | null
  answers: StoredAnswer[]
}

export const listResponses = (before?: string) =>
  apiFetch<FeedbackResponse[]>(
    `/admin/feedback/responses?limit=30${before ? `&before=${encodeURIComponent(before)}` : ''}`,
  )

export type FeedbackSummary = {
  total: number
  items: {
    question_id: string
    prompt: string
    kind: QuestionKind
    responses: number
    average: number | null
    counts: Record<string, number>
  }[]
}

export const getFeedbackSummary = () => apiFetch<FeedbackSummary>('/admin/feedback/summary')
