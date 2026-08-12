import { apiFetch, apiFetchRaw } from './client'
import { ApiError } from './errors'
import type { ChatMessage, Citation } from './types'

export const listMessages = (subspaceId: string) =>
  apiFetch<ChatMessage[]>(`/subspaces/${subspaceId}/messages`)

export type ChatStreamEvent =
  | { type: 'token'; delta: string }
  | { type: 'citation'; citation: Citation }
  | {
      type: 'done'
      messageId: string | null
      userMessageId: string | null
      citations: Citation[]
      /**
       * The canonical stored reply. Differs from the concatenated tokens only
       * when the server stripped a citation marker pointing at a source that
       * doesn't exist — reconcile against this so the bubble matches what a
       * refresh would show.
       */
      content: string | null
    }
  | { type: 'error'; code: string; message: string }

/**
 * Consume the SSE stream from `/subspaces/:id/chat`.
 *
 * Yields typed events. The caller renders tokens as they arrive, appends
 * citations to a side panel, and treats `done` / `error` as terminal.
 */
export async function* streamChat(
  subspaceId: string,
  text: string,
  signal?: AbortSignal,
  /** True for a Regenerate click: the same question again, not a new turn.
   *  The backend skips re-storing it so the question doesn't appear twice for
   *  one answer that changed. */
  regenerate = false,
  /** Pasted screenshots, as `data:` URLs. Sent inline with the question
   *  rather than uploaded first: a pasted image belongs to one turn, not to
   *  the topic's indexed material. */
  images: string[] = [],
): AsyncGenerator<ChatStreamEvent> {
  const res = await apiFetchRaw(`/subspaces/${subspaceId}/chat`, {
    method: 'POST',
    body: { text, regenerate, images },
    signal,
  })
  if (!res.body) {
    throw new ApiError('upstream_unavailable', 'Chat is offline.')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // SSE events are terminated by a blank line.
      let idx: number
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const evt = parseSseEvent(raw)
        if (evt) yield evt
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function parseSseEvent(raw: string): ChatStreamEvent | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (dataLines.length === 0) return null
  let payload: unknown
  try {
    payload = JSON.parse(dataLines.join('\n'))
  } catch {
    return null
  }
  const data = payload as Record<string, unknown>
  switch (event) {
    case 'token':
      return { type: 'token', delta: String(data.delta ?? '') }
    case 'citation':
      return { type: 'citation', citation: data as unknown as Citation }
    case 'done':
      return {
        type: 'done',
        messageId: (data.message_id as string | null) ?? null,
        userMessageId: (data.user_message_id as string | null) ?? null,
        citations: (data.citations as Citation[]) ?? [],
        content: (data.content as string | undefined) ?? null,
      }
    case 'error':
      return {
        type: 'error',
        code: String(data.code ?? 'unknown'),
        message: String(data.message ?? 'Chat stopped.'),
      }
    default:
      return null
  }
}
