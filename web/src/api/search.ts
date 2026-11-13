import { apiFetch } from './client'

/** One kind of thing the search box can find. `passage` is a stretch of a
 *  file's text, as opposed to `file`, which matched by its name. */
export type SearchKind = 'subject' | 'topic' | 'note' | 'card' | 'quiz' | 'file' | 'passage'

export type SearchHit = {
  kind: SearchKind
  id: string
  title: string
  /** Plain text around the match (markup already stripped server-side). */
  snippet: string | null
  subject_id: string | null
  subject_name: string | null
  /** The topic. Null only for a subject hit. */
  subspace_id: string | null
  subspace_name: string | null
  deck_id: string | null
  deck_name: string | null
  document_id: string | null
  locator: string | null
  status: string | null
}

export type SearchGroup = { kind: SearchKind; label: string; hits: SearchHit[] }

export type SearchResult = {
  query: string
  groups: SearchGroup[]
  /** Some kinds couldn't be searched this time; the rest are here. */
  partial: boolean
}

/** Shorter than this the server answers with nothing, so don't ask. */
export const MIN_SEARCH_LENGTH = 2

/** Notes, cards, quizzes, files, topics and subjects matching `q`, grouped by
 *  kind. Plain database reads — no model call, safe to run as the student types.
 *  Pass `signal` so a newer keystroke can cancel this one. */
export const searchEverything = (q: string, opts: { limit?: number; signal?: AbortSignal } = {}) =>
  apiFetch<SearchResult>(
    `/search?q=${encodeURIComponent(q)}${opts.limit ? `&limit=${opts.limit}` : ''}`,
    // Short timeout: a search that takes 15s is no longer the one being typed.
    { signal: opts.signal, timeoutMs: 15_000 },
  )
