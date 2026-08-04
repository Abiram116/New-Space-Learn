import { apiFetch } from './client'
import type { Me, Settings, Stats } from './types'

export const getMe = () => apiFetch<Me>('/me')
export const getStats = () => apiFetch<Stats>('/me/stats')
export const getSettings = () => apiFetch<Settings>('/me/settings')
export const updateSettings = (patch: Partial<Settings>) =>
  apiFetch<Settings>('/me/settings', { method: 'PATCH', body: patch })
