import { apiFetch } from './client'
import type { Brief, Me, Settings, Stats, StudentModel, StudentModelPatch } from './types'

export const getMe = () => apiFetch<Me>('/me')
export const getStats = () => apiFetch<Stats>('/me/stats')
export const getSettings = () => apiFetch<Settings>('/me/settings')
export const updateSettings = (patch: Partial<Settings>) =>
  apiFetch<Settings>('/me/settings', { method: 'PATCH', body: patch })

/** The personal re-entry line on Home. Never throws the page — the backend
 *  falls back to deterministic copy and flags it with `generated: false`. */
export const getBrief = () => apiFetch<Brief>('/me/brief')

/** weak_areas/strong_areas/streak_days are computed server-side from real
 *  quiz/activity data — never editable, never sent back on PATCH. */
export const getStudentModel = () => apiFetch<StudentModel>('/me/student-model')
export const updateStudentModel = (patch: StudentModelPatch) =>
  apiFetch<StudentModel>('/me/student-model', { method: 'PATCH', body: patch })
