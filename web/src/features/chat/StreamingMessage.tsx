import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react'
import type { Citation } from '../../api/types'
import { ChatMessage } from './ChatMessage'
import type { StreamPacer } from './streamPacer'
import { prepareStreamingDisplay } from './streamingDisplay'

/**
 * The live reply bubble. The only component that re-renders per revealed
 * frame: it subscribes straight to the pacer, so the thread of finished
 * messages above it (all memoized) is never touched while text streams.
 *
 * The visible text is repaired for display (unclosed code fences, half-typed
 * bold, partial `[[1]]` markers, table rows still being written) so the
 * markdown never reflows when the closing token arrives — see
 * `streamingDisplay.ts`.
 */
export function StreamingMessage({
  pacer,
  citations,
  base,
  onGrow,
}: {
  pacer: StreamPacer
  citations: Citation[]
  base: string
  /** Called after each committed frame so the thread can keep following. */
  onGrow: () => void
}) {
  const text = useSyncExternalStore(pacer.subscribe, pacer.getSnapshot, pacer.getSnapshot)
  const display = useMemo(() => prepareStreamingDisplay(text), [text])

  const message = useMemo(
    () => ({
      id: 'pending',
      role: 'assistant' as const,
      // '…' is ChatMessage's cue to show the typing indicator.
      content: display.trim() ? display : '…',
      citations,
      created_at: '',
    }),
    [display, citations],
  )

  useLayoutEffect(() => {
    onGrow()
  }, [message, onGrow])

  return <ChatMessage message={message} base={base} streaming />
}
