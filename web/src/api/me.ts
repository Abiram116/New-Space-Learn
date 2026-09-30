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
export const deleteAccount = () => apiFetch<{ ok: true }>('/me', { method: 'DELETE' })
