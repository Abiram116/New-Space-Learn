/**
 * The feedback row under an answer.
 *
 * Quiet by construction. It sits outside the answer's `Leaf` so it reads as a
 * control rather than as part of what was written, it is the same weight as the
 * citation captions above it, and it never occupies space it isn't using — an
 * empty policy result renders nothing at all rather than a collapsed row.
 *
 * One tap ends the interaction. No modal, no "tell us more", no second step:
 * the entire value is in getting one bit of evidence at near-zero cost to the
 * student, and anything that makes the tap expensive destroys that trade.
 *
 * The record is optimistic — the acknowledgement appears immediately and a
 * failed request is swallowed. A student who taps "too long" and gets a red
 * toast has been punished for helping, and the cost of silently losing one
 * piece of evidence is a rounding error against that.
 */

import { useState } from 'react'
import { sendFeedback, type FeedbackKind } from '../../api/feedback'
import { Icon } from '../../components/ui/Icon'
import { CHIP_LABEL } from './feedbackPolicy'

export function FeedbackChips({
  chips,
  messageId,
  subspaceId,
  onRecorded,
}: {
  chips: FeedbackKind[]
  messageId: string
  subspaceId: string
  onRecorded: () => void
}) {
  const [given, setGiven] = useState<FeedbackKind | null>(null)

  if (chips.length === 0) return null

  const record = (kind: FeedbackKind) => {
    setGiven(kind)
    onRecorded()
    void sendFeedback({
      surface: 'chat',
      target_id: messageId,
      subspace_id: subspaceId,
      kind,
    }).catch(() => {
      // Deliberately silent. See the note above.
    })
  }

  if (given) {
    return (
      <div className="flex items-center gap-1.5 pl-4 text-[11.5px] text-muted">
        <Icon name="check" size={11} className="text-mint-deep" />
        {given === 'useful' ? 'Glad it helped.' : 'Noted — I’ll adjust.'}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 pl-4">
      <span className="text-[11.5px] text-faint">How was that?</span>
      {chips.map((kind) => (
        <button
          key={kind}
          type="button"
          onClick={() => record(kind)}
          className="rounded-full border border-line px-2.5 py-1 text-[11.5px] text-ink-3 transition-colors cursor-pointer hover:border-brand/50 hover:bg-brand-soft hover:text-brand-deep"
        >
          {CHIP_LABEL[kind]}
        </button>
      ))}
    </div>
  )
}
