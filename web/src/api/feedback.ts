import { apiFetch } from './client'

/**
 * The feedback taxonomy, mirrored from `api/app/services/preferences.py`.
 *
 * Duplicated on purpose and kept small: the backend validates every `kind`
 * against its own copy and rejects anything it doesn't recognise, so this list
 * cannot silently drift into recording something the server won't interpret —
 * it can only fail loudly. The alternative, fetching the taxonomy at runtime,
 * costs a request on every chat mount to render four buttons.
 */
export type FeedbackKind =
  | 'too_long'
  | 'want_detail'
  | 'too_complex'
  | 'too_simple'
  | 'need_example'
  | 'want_theory'
  | 'want_direct'
  | 'useful'
  | 'regenerate'

export type FeedbackSurface = 'chat' | 'note' | 'quiz' | 'cards'

export const sendFeedback = (input: {
  surface: FeedbackSurface
  target_id: string
  subspace_id: string
  kind: FeedbackKind
  concept?: string
}) => apiFetch<{ ok: true }>('/feedback', { method: 'POST', body: input })

export type Preference = {
  key: string
  value: string
  source: 'explicit' | 'observed' | 'feedback' | 'experiment'
  /** 0..1. Below the act threshold it's known but changes nothing. */
  confidence: number
  evidence_count: number
  /** Why we believe it, in one clause — shown so it can be disagreed with. */
  because: string
  actionable: boolean
}

export const listPreferences = () => apiFetch<Preference[]>('/me/preferences')

/** Deletes collected feedback only. Explicit settings and observed behaviour
 *  survive — the first is yours, the second is recomputed from activity. */
export const resetFeedback = () =>
  apiFetch<{ ok: true }>('/me/feedback', { method: 'DELETE' })
