import { apiFetch } from './client'
import type { Brief, Settings, Stats, StudentModel, StudentModelPatch } from './types'

export const getStats = () => apiFetch<Stats>('/me/stats')
export const getSettings = () => apiFetch<Settings>('/me/settings')
export const updateSettings = (patch: Partial<Settings>) =>
  apiFetch<Settings>('/me/settings', { method: 'PATCH', body: patch })

/** The personal re-entry line on Home. Never throws the page — the backend
 *  falls back to deterministic copy and flags it with `generated: false`. */
export const getBrief = () => apiFetch<Brief>(`/me/brief${zoneQuery()}`)

/** The browser's IANA zone, so the backend can say "this evening" and know what
 *  "later today" means. Omitted when unknown — the copy then just skips it. */
function zoneQuery(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return zone ? `?tz=${encodeURIComponent(zone)}` : ''
  } catch {
    return ''
  }
}

/** weak_areas/strong_areas/streak_days are computed server-side from real
 *  quiz/activity data — never editable, never sent back on PATCH. */
export const getStudentModel = () => apiFetch<StudentModel>('/me/student-model')
export const updateStudentModel = (patch: StudentModelPatch) =>
  apiFetch<StudentModel>('/me/student-model', { method: 'PATCH', body: patch })

/** Irreversible. The caller must have its own confirmation step — this
 *  function does not ask twice. */
export type Limits = {
  answers: { per_day: number; left_today: number; burst: number; per_minute: number; quiz_costs: number }
  files: { max_mb: number; max_passages: number; passage_chars: number; scan_pages: number }
  messages: { max_chars: number; images_per_message: number }
  models: { chat: string; fast: string }
}
export const getLimits = () => apiFetch<Limits>('/me/limits')
export const exportMyData = () => apiFetch<Record<string, unknown>>('/me/export')
export const deleteAccount = () => apiFetch<{ ok: true }>('/me', { method: 'DELETE' })
