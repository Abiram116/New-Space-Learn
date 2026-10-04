import { API_URL } from '../lib/env'
import { notifyProgress } from '../lib/progressEvents'
import { apiFetch } from './client'
import { ApiError } from './errors'
import type { Document } from './types'

let tokenProvider: () => string | null = () => null
export function setUploadTokenProvider(fn: () => string | null): void {
  tokenProvider = fn
}

/**
 * The last status seen for each document.
 *
 * A document becomes searchable in the background, after the upload has
 * returned, so no write ever reports it: the only sign is a later read showing
 * `ready` where the last one did not. Noticing that here tells Home its
 * "material waiting" message has changed, without any screen wiring it up.
 */
const seenStatus = new Map<string, string>()

function noteStatuses(docs: Document[]): void {
  let becameReady = false
  for (const d of docs) {
    if (d.status === 'ready') {
      const before = seenStatus.get(d.id)
      if (before !== undefined && before !== 'ready') becameReady = true
    }
    seenStatus.set(d.id, d.status)
  }
  if (becameReady) notifyProgress()
}

export const listDocuments = async (subspaceId: string) => {
  const docs = await apiFetch<Document[]>(`/subspaces/${subspaceId}/documents`)
  noteStatuses(docs)
  return docs
}

/** The cited passage and the text around it, for the citation preview. */
export type Passage = {
  document_id: string
  name: string
  chunks: { index: number; locator: string; content: string; cited: boolean }[]
}

export const getPassage = (documentId: string, locator: string, snippet: string) =>
  apiFetch<Passage>(
    `/documents/${documentId}/passage?locator=${encodeURIComponent(locator)}&snippet=${encodeURIComponent(snippet)}`,
  )

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
          const doc = JSON.parse(xhr.responseText) as Document
          seenStatus.set(doc.id, doc.status)
          // This bypasses `apiFetch`, so it has to say so itself.
          notifyProgress()
          resolve(doc)
        } catch {
          reject(new ApiError('internal_error', 'Unexpected server response.'))
        }
        return
      }
      let code = 'unknown'
      // Empty unless the server explained: friendlyMessage then has the status's own
      // sentence, and a 413 from a proxy still says the file was too big.
      let message = xhr.status === 413 ? 'That file is too large to upload (the limit is 20 MB).' : ''
      try {
        const body = JSON.parse(xhr.responseText)
        if (body?.error?.code) code = body.error.code
        if (body?.error?.message) message = body.error.message
      } catch {
        /* swallow */
      }
      if (code === 'unknown') {
        if (xhr.status >= 500) code = 'upstream_unavailable'
        else if (xhr.status === 429) code = 'rate_limited'
        else if (xhr.status === 401) code = 'unauthorized'
        else if (xhr.status === 413 || xhr.status === 422) code = 'validation_error'
      }
      reject(new ApiError(code as never, message, xhr.status))
    }

    xhr.send(form)
  })
}
