import { memo, useEffect, useState } from 'react'
import type { FeedbackKind } from '../../api/feedback'
import type { AskReason } from './feedbackPolicy'
import type { ChatMessage as Message, Citation } from '../../api/types'
import { Icon } from '../../components/ui/Icon'
import { Rise } from '../../components/ui/motion'
import { cn } from '../../lib/cn'
import { AddToNoteButton } from './AddToNote'
import { FeedbackChips } from './FeedbackChips'
import { MarkdownMessage } from './MarkdownMessage'
import { PassagePreview } from './PassagePreview'
import './chat.css'

export type MessageFeedback = {
  chips: FeedbackKind[]
  /** Why the policy wants to ask, or null when it is only showing thumbs. */
  reason: AskReason
  messageId: string
  subspaceId: string
  onRecorded: () => void
  /** Fired only when an *ask* is actually shown, so the cooldown tracks
   *  interruptions rather than renders. The passive thumbs appear on every
   *  answer and must not start a cooldown — if they did, the one control that
   *  is supposed to always be available would suppress the rare one that
   *  isn't. */
  onOffered: () => void
  /** Try that answer again. Always available on the last complete answer —
   *  an action, not a feedback tap, though it also records one. */
  onRegenerate: () => void
}

/**
 * Memoized so a token arriving in the streaming bubble doesn't re-render
 * every already-finished message in the thread.
 *
 * `ChatViewInner` re-renders on every `token` event (that's how the pending
 * bubble updates), which used to re-run this component — and the full
 * `ReactMarkdown` parse + `rehype-highlight` pass inside it — for every
 * message in the conversation, once per token. On a long thread that is
 * hundreds of needless full markdown re-parses for a single reply. Props for
 * a finished message are referentially stable across that re-render
 * (`message` keeps its object identity in `history.data`, `feedback` is
 * `undefined` for everything but the last answer while streaming), so a
 * plain memo is enough to make only the pending bubble — whose `message` prop
 * is a fresh object every token — do the work of re-rendering.
 */
export const ChatMessage = memo(function ChatMessage({
  message,
  feedback,
  subspaceId,
  base,
  streaming = false,
  instant = false,
}: {
  message: Message
  feedback?: MessageFeedback
  /** Omitted only for the transient pending-stream bubble, which has no
   *  real content yet to add anywhere. */
  subspaceId?: string
  /** Route prefix for this topic — citations link into `${base}/docs?d=`,
   *  the same convention NoteEditor's own citation links already use.
   *  Omitted only for the pending bubble, same as `subspaceId`. */
  base?: string
  /** The live bubble: block-reveal animation on, no entrance lift of its own
   *  beyond the first mount. */
  streaming?: boolean
  /** A reply that was just streamed in this session and is now final. It has
   *  already been on screen for seconds, so lifting it in again would read as
   *  the whole answer blinking at the moment it finishes. */
  instant?: boolean
}) {
  // The citation whose passage is open, if any.
  const [viewing, setViewing] = useState<Citation | null>(null)
  const [showSources, setShowSources] = useState(false)
  // Bubbles lift in rather than appearing. Short and small — a chat log is
  // read continuously, so anything longer would be in the way.
  if (message.role === 'user') {
    return (
      <Rise distance={10} className="max-w-[85%] self-end sm:max-w-[75%]">
        {/* Tinted, not saturated. A full-brand fill made every question the
            loudest thing on screen — brighter than the answer it was asking
            about, which inverts the hierarchy. `brand-soft` still reads as
            "this one is mine" without shouting it. */}
        <div id={`msg-${message.id}`} className="scroll-mt-24 rounded-[18px_18px_5px_18px] border border-brand/25 bg-brand-soft px-4 py-2.5 text-[16px] leading-[1.55] text-ink whitespace-pre-wrap [overflow-wrap:anywhere]">
          {message.content}
        </div>
      </Rise>
    )
  }

  const citations = message.citations ?? []

  const body = (
    <>
    {/* The answer is the page, not an object on it.
        This was a `Leaf` — tinted fill, margin rule down the left, capped at
        88%. A leaf is the right material for a note, where the sheet IS the
        screen and the rule is its edge. In a chat it is one nesting too many:
        the column is already centred and measured, so a second bordered,
        tinted container inside it made every answer read as a pull-quote
        indented under the question. Two boxes, one idea.
        So the answer sets plainly in the column. The distinction from the
        student's turn is already fully carried by *their* turn being a
        bubble — an answer doesn't need a container to say "not yours" when
        the only other thing on screen is visibly theirs. */}
    <div className="flex flex-col gap-3">
      {citations.length > 0 && (
        <div className="flex items-center gap-2 text-[12.5px] font-semibold text-muted">
          <span className="grid h-5 w-5 place-items-center rounded-md bg-brand-soft text-brand-deep">
            <Icon name="sparkle" size={11} filled />
          </span>
          Answered from {citations.length} source{citations.length === 1 ? '' : 's'}
        </div>
      )}

      {message.content === '\u2026' ? (
        <Thinking />
      ) : (
        <MarkdownMessage
          content={message.content}
          citations={citations}
          base={base}
          streaming={streaming}
          onCite={base ? setViewing : undefined}
        />
      )}

      {citations.length > 0 && (
        <div className="flex flex-col gap-1">
          {/* Closed by default: the markers in the text already say which source
              backs which claim, and a wall of cards under every answer is more to
              scroll past than to use. Open it when you want to check one. */}
          <button
            type="button"
            onClick={() => setShowSources((v) => !v)}
            aria-expanded={showSources}
            className="flex w-fit cursor-pointer items-center gap-1.5 rounded-md py-1 text-[12.5px] font-semibold text-muted transition-colors hover:text-ink"
          >
            Sources · {citations.length}
            <Icon name="chevronDown" size={13} className={cn('transition-transform', showSources && 'rotate-180')} />
          </button>
          {showSources && (
            <ul className="flex flex-col divide-y divide-line-soft overflow-hidden rounded-[10px] border border-line bg-raised/40">
              {citations.map((c) => {
                const row = (
                  <>
                    <span className="w-4 shrink-0 text-right font-bold text-brand">{c.marker}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold text-ink-2">{c.document_name}</span>
                    <span className="max-w-[45%] shrink-0 truncate text-muted">{c.locator}</span>
                  </>
                )
                // `base` is only omitted for the pending/streaming bubble, which
                // never has real citations yet — but guard anyway rather than
                // ever offer a preview that cannot link back to its file.
                return (
                  <li key={c.marker}>
                    {base ? (
                      <button
                        type="button"
                        onClick={() => setViewing(c)}
                        title={c.snippet}
                        className="flex min-h-9 w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-raised"
                      >
                        {row}
                      </button>
                    ) : (
                      <div className="flex min-h-9 items-center gap-2 px-2.5 py-1.5 text-[12px]">{row}</div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
    {/* Outside the answer: these are controls, not part of what was written. */}
    <div className="mt-2 flex items-center gap-1">
      {/* Available on every real answer, not just the latest — saving
          something you asked about five turns ago is completely ordinary,
          and gating this the way FeedbackRow gates on "last + complete"
          would make it disappear the moment you asked a follow-up. */}
      {subspaceId && message.content !== '…' && (
        <AddToNoteButton subspaceId={subspaceId} content={message.content} />
      )}
    </div>
    {/* A `srv-` id means the server sent no message_id (an older backend), so
        there is nothing to attach feedback to — the row is skipped rather than
        posting against an id the server would reject. */}
    {feedback && !feedback.messageId.startsWith('srv-') && (
      <FeedbackRow feedback={feedback} content={message.content} />
    )}
      <PassagePreview citation={viewing} base={base} onClose={() => setViewing(null)} />
    </>
  )
  return instant ? <div>{body}</div> : <Rise distance={6}>{body}</Rise>
})

function FeedbackRow({ feedback, content }: { feedback: MessageFeedback; content: string }) {
  const { onOffered, reason } = feedback
  const asked = reason !== null && feedback.chips.length > 0
  // Reported on mount, not during render: telling the parent to advance its
  // counter while it is rendering is a setState-during-render warning and, in
  // StrictMode, a double count.
  useEffect(() => {
    if (asked) onOffered()
  }, [asked, onOffered])

  return (
    <div className="mt-2">
      <FeedbackChips
        chips={feedback.chips}
        reason={reason}
        messageId={feedback.messageId}
        subspaceId={feedback.subspaceId}
        content={content}
        onRecorded={feedback.onRecorded}
        onRegenerate={feedback.onRegenerate}
      />
    </div>
  )
}

/**
 * The gap between sending and the first token.
 *
 * Three dots rising in sequence — the same beat as a card being dealt, so the
 * wait belongs to this world rather than borrowing a generic chat spinner. It
 * holds the height of one line of reply text so the bubble doesn't jump when
 * real text replaces it. Keyframes live in chat.css, where reduced motion
 * turns them into three still dots.
 */
function Thinking() {
  return (
    <div className="chat-think" role="status" aria-label="Thinking">
      <span />
      <span />
      <span />
    </div>
  )
}
