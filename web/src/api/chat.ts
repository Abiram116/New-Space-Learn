import { apiFetch, apiFetchRaw } from './client'
import { notifyProgress } from '../lib/progressEvents'
import { ApiError } from './errors'
import type { ChatMessage, Citation } from './types'

const fetchMessages = (subspaceId: string) =>
  apiFetch<ChatMessage[]>(`/subspaces/${subspaceId}/messages`)

/** Histories asked for ahead of a visit (`lib/prefetch`), each handed to the first
 *  `listMessages` that wants it and then forgotten. */
const primed = new Map<string, { at: number; promise: Promise<ChatMessage[]> }>()
/** Past this a prefetched history is not trusted: it may predate a message. */
const PRIMED_MAX_AGE_MS = 20_000

/** Start loading a topic's history so opening it finds the answer already there. */
export function prefetchMessages(subspaceId: string): void {
  const held = primed.get(subspaceId)
  if (held && Date.now() - held.at < PRIMED_MAX_AGE_MS) return
  const promise = fetchMessages(subspaceId)
  primed.set(subspaceId, { at: Date.now(), promise })
  // A failed head start is not an error: the page asks again for itself.
  promise.catch(() => {
    if (primed.get(subspaceId)?.promise === promise) primed.delete(subspaceId)
  })
}

export const listMessages = (subspaceId: string) => {
  const held = primed.get(subspaceId)
  primed.delete(subspaceId)
  if (held && Date.now() - held.at < PRIMED_MAX_AGE_MS) return held.promise
  return fetchMessages(subspaceId)
}

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
      /** One question the student might ask next, written with the answer; null when there isn't a good one. */
      suggestion: string | null
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
    // A long, thoughtful answer can legitimately take longer than the
    // client's default request timeout to finish streaming — this call
    // already has its own cancellation path via `signal` (stop/regenerate),
    // so the generic timeout would only ever cut off a real answer in
    // progress, never catch anything the caller couldn't already cancel.
    timeoutMs: 0,
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
        // A finished turn counts as studying today (it moves the streak), and
        // an agent may have made cards, a quiz or a note along the way.
        if (evt?.type === 'done') notifyProgress()
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
        suggestion: typeof data.suggestion === 'string' ? data.suggestion : null,
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
