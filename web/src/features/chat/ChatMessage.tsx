import { useEffect } from 'react'
import type { FeedbackKind } from '../../api/feedback'
import type { AskReason } from './feedbackPolicy'
import type { ChatMessage as Message } from '../../api/types'
import { Icon } from '../../components/ui/Icon'
import { Rise } from '../../components/ui/motion'
import { Leaf } from '../../components/ui/Surface'
import { FeedbackChips } from './FeedbackChips'
import { MarkdownMessage } from './MarkdownMessage'

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
}

export function ChatMessage({
  message,
  feedback,
}: {
  message: Message
  feedback?: MessageFeedback
}) {
  // Bubbles lift in rather than appearing. Short and small — a chat log is
  // read continuously, so anything longer would be in the way.
  if (message.role === 'user') {
    return (
      <Rise distance={10} className="max-w-[70%] self-end">
        {/* Tinted, not saturated. A full-brand fill made every question the
            loudest thing on screen — brighter than the answer it was asking
            about, which inverts the hierarchy. `brand-soft` still reads as
            "this one is mine" without shouting it. */}
        <div className="rounded-[18px_18px_5px_18px] border border-brand/25 bg-brand-soft px-3.5 py-2.5 text-[14px] leading-relaxed text-ink whitespace-pre-wrap">
          {message.content}
        </div>
      </Rise>
    )
  }

  const citations = message.citations ?? []

  return (
    <Rise distance={6} className="max-w-[88%]">
    {/* LEAF, not a bubble. The user's turn stays a bubble because it is a
        thing they said; the answer is a thing they *read*, often several
        paragraphs with citations under it. Giving both the same rounded
        border made a long grounded answer look like a text message.
        `p-0 pr-4` keeps the leaf's own left gutter as the margin rule. */}
    <Leaf className="flex flex-col gap-2.5 py-1 pr-4 text-[14px] leading-[1.65]">
      {citations.length > 0 && (
        <div className="flex items-center gap-2 text-[12px] font-semibold text-muted">
          <span className="grid h-5 w-5 place-items-center rounded-md bg-brand-soft text-brand-deep">
            <Icon name="sparkle" size={11} filled />
          </span>
          Answered from {citations.length} source{citations.length === 1 ? '' : 's'}
        </div>
      )}

      {message.content === '\u2026' ? (
        <Thinking />
      ) : (
        <MarkdownMessage content={message.content} />
      )}

      {citations.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {citations.map((c) => (
            <div
              key={c.marker}
              className="min-w-40 flex-1 rounded-xl border-[1.5px] border-line px-2.5 py-2 text-[11.5px]"
            >
              <div className="flex gap-1.5 font-bold">
                <span className="text-brand">{c.marker}</span>
                <span className="truncate">{c.document_name}</span>
              </div>
              <div className="text-muted">
                {c.locator} · {c.snippet}
              </div>
            </div>
          ))}
        </div>
      )}
    </Leaf>
    {/* Outside the Leaf: this is a control, not part of what was written.
        A `srv-` id means the server sent no message_id (an older backend), so
        there is nothing to attach feedback to — the row is skipped rather than
        posting against an id the server would reject. */}
    {feedback && !feedback.messageId.startsWith('srv-') && (
      <FeedbackRow feedback={feedback} />
    )}
    </Rise>
  )
}

function FeedbackRow({ feedback }: { feedback: MessageFeedback }) {
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
        onRecorded={feedback.onRecorded}
      />
    </div>
  )
}

/**
 * The gap between sending and the first token.
 *
 * Three dots rising in sequence — the same beat as a card being dealt, so the
 * wait belongs to this world rather than borrowing a generic chat spinner. It
 * holds a fixed height so the bubble doesn't jump when real text replaces it.
 */
function Thinking() {
  return (
    <div className="flex h-5 items-center gap-1.5" role="status" aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-brand"
          style={{ animation: `thinkPulse 1.15s ${i * 0.16}s ease-in-out infinite` }}
        />
      ))}
      <style>{`
        @keyframes thinkPulse {
          0%, 100% { opacity: 0.25; transform: translateY(0) scale(0.85); }
          40%      { opacity: 1;    transform: translateY(-3px) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="thinkPulse"] { animation: none !important; opacity: 0.7; }
        }
      `}</style>
    </div>
  )
}
