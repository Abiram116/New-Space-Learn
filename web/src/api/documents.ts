import { API_URL } from '../lib/env'
import { apiFetch } from './client'
import { ApiError } from './errors'
import type { Document } from './types'

let tokenProvider: () => string | null = () => null
export function setUploadTokenProvider(fn: () => string | null): void {
  tokenProvider = fn
}

export const listDocuments = (subspaceId: string) =>
  apiFetch<Document[]>(`/subspaces/${subspaceId}/documents`)

export const deleteDocument = (id: string) =>
  apiFetch<{ ok: true }>(`/documents/${id}`, { method: 'DELETE' })

export const reprocessDocument = (id: string) =>
  apiFetch<Document>(`/documents/${id}/reprocess`, { method: 'POST' })

/**
 * XMLHttpRequest-backed upload so we can surface real progress events —
 * `fetch`'s streaming request bodies aren't universally available yet.
 */
export function uploadDocument(
  subspaceId: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<Document> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', file, file.name)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_URL}/subspaces/${subspaceId}/documents`)
    const token = tokenProvider()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.responseType = 'text'

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }

    xhr.onerror = () => reject(new ApiError('network', "Can't reach the server."))
    xhr.onabort = () => reject(new ApiError('network', 'Upload cancelled.'))

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as Document)
        } catch {
          reject(new ApiError('internal_error', 'Unexpected server response.'))
        }
        return
      }
      let code = 'unknown'
      let message = `Upload failed (${xhr.status}).`
      try {
        const body = JSON.parse(xhr.responseText)
        if (body?.error?.code) code = body.error.code
        if (body?.error?.message) message = body.error.message
      } catch {
        /* swallow */
      }
      reject(new ApiError(code as never, message, xhr.status))
    }

    xhr.send(form)
  })
}
