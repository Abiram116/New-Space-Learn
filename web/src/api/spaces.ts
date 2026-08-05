import { apiFetch } from './client'
import type { Space, Subspace, Tone } from './types'

export const listSpaces = () => apiFetch<Space[]>('/spaces', { method: 'GET' })

export const createSpace = (input: { name: string; tone?: Tone }) =>
  apiFetch<Space>('/spaces', { method: 'POST', body: input })

export const updateSpace = (id: string, input: { name?: string; tone?: Tone }) =>
  apiFetch<Space>(`/spaces/${id}`, { method: 'PATCH', body: input })

export const deleteSpace = (id: string) =>
  apiFetch<{ ok: true }>(`/spaces/${id}`, { method: 'DELETE' })

export const createSubspace = (spaceId: string, input: { name: string }) =>
  apiFetch<Subspace>(`/spaces/${spaceId}/subspaces`, { method: 'POST', body: input })

export const renameSubspace = (id: string, input: { name: string }) =>
  apiFetch<Subspace>(`/subspaces/${id}`, { method: 'PATCH', body: input })

export const deleteSubspace = (id: string) =>
  apiFetch<{ ok: true }>(`/subspaces/${id}`, { method: 'DELETE' })

/** Explicit, opt-in "related to" edges — never auto-inferred. */
export const listSubspaceLinks = (subspaceId: string) =>
  apiFetch<Subspace[]>(`/subspaces/${subspaceId}/links`)

export const createSubspaceLink = (subspaceId: string, linkedSubspaceId: string) =>
  apiFetch<{ ok: true }>(`/subspaces/${subspaceId}/links`, {
    method: 'POST',
    body: { linked_subspace_id: linkedSubspaceId },
  })

export const deleteSubspaceLink = (subspaceId: string, linkedSubspaceId: string) =>
  apiFetch<{ ok: true }>(`/subspaces/${subspaceId}/links/${linkedSubspaceId}`, {
    method: 'DELETE',
  })
