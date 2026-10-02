import { adminFetch } from './admin'
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
// Behind the admin page's password, not an account — see `api/admin.ts`.

export const listQuestions = () => adminFetch<FeedbackQuestion[]>('/admin/feedback/questions')

export const createQuestion = (input: {
  prompt: string
  kind: QuestionKind
  options?: string[]
  required?: boolean
}) => adminFetch<FeedbackQuestion>('/admin/feedback/questions', { method: 'POST', body: input })

export const updateQuestion = (
  id: string,
  patch: Partial<Pick<FeedbackQuestion, 'prompt' | 'options' | 'required' | 'active'>>,
) => adminFetch<FeedbackQuestion>(`/admin/feedback/questions/${id}`, { method: 'PATCH', body: patch })

export const deleteQuestion = (id: string) =>
  adminFetch<{ ok: true }>(`/admin/feedback/questions/${id}`, { method: 'DELETE' })

export const reorderQuestions = (ids: string[]) =>
  adminFetch<{ ok: true }>('/admin/feedback/questions/reorder', { method: 'POST', body: { ids } })

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

export const RESPONSES_PAGE = 30

export const listResponses = (before?: string) =>
  adminFetch<FeedbackResponse[]>(
    `/admin/feedback/responses?limit=${RESPONSES_PAGE}${before ? `&before=${encodeURIComponent(before)}` : ''}`,
  )

export const deleteResponse = (id: string) =>
  adminFetch<{ ok: true }>(`/admin/feedback/responses/${id}`, { method: 'DELETE' })

export type SummaryText = { text: string; created_at: string | null; score: number | null }
export type SummaryItem = {
  question_id: string
  prompt: string
  kind: QuestionKind
  responses: number
  average: number | null
  median: number | null
  previous_average: number | null
  distribution: Record<string, number>
  positive_share: number | null
  nps: number | null
  promoters: number
  passives: number
  detractors: number
  counts: Record<string, number>
  keywords: { word: string; count: number }[]
  texts: SummaryText[]
}
export type FeedbackSummary = {
  days: number
  total: number
  previous_total: number | null
  by_day: { date: string; count: number }[]
  sources: Record<string, number>
  signed_in: number
  visitors: number
  want_reply: number
  takeaways: string[]
  items: SummaryItem[]
}

/** The periods the server answers for; 0 is everything. */
export const SUMMARY_PERIODS = [7, 30, 90, 0] as const
export type SummaryPeriod = (typeof SUMMARY_PERIODS)[number]

export const getFeedbackSummary = (days: SummaryPeriod) =>
  adminFetch<FeedbackSummary>(`/admin/feedback/summary?days=${days}`)
