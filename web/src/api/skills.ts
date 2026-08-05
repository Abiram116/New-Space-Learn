import { apiFetch } from './client'
import type { MemoryScope, Skill, Tone } from './types'

export type SkillInput = {
  name: string
  icon?: string
  tone?: Tone
  description?: string | null
  instructions: string
  capabilities?: string[]
  memory_scope?: MemoryScope
  output_format?: string | null
}

export const listSkills = () => apiFetch<Skill[]>('/skills')
export const listLibrarySkills = () => apiFetch<Skill[]>('/skills/library')

export const createSkill = (input: SkillInput) =>
  apiFetch<Skill>('/skills', { method: 'POST', body: input })

export const updateSkill = (id: string, input: Partial<SkillInput>) =>
  apiFetch<Skill>(`/skills/${id}`, { method: 'PATCH', body: input })

export const deleteSkill = (id: string) =>
  apiFetch<{ ok: true }>(`/skills/${id}`, { method: 'DELETE' })

export const listActiveSkills = (subspaceId: string) =>
  apiFetch<Skill[]>(`/subspaces/${subspaceId}/skills`)

export const activateSkill = (subspaceId: string, skillId: string) =>
  apiFetch<{ ok: true }>(`/subspaces/${subspaceId}/skills/${skillId}`, { method: 'POST' })

export const deactivateSkill = (subspaceId: string, skillId: string) =>
  apiFetch<{ ok: true }>(`/subspaces/${subspaceId}/skills/${skillId}`, { method: 'DELETE' })
