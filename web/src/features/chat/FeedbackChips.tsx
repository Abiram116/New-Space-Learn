/**
 * The feedback control under an answer.
 *
 * Two layers, and the split is the whole design.
 *
 * **Passive, always present.** A quiet thumbs pair on the latest answer. It
 * asks nothing — no "How was that?", no prompt text at all — so a student who
 * ignores it pays one glance, forever. This is where most evidence should come
 * from, because it is available every turn without ever interrupting.
 *
 * **Active, almost never.** The reason chips. They appear on a thumbs-down —
 * an ask the student invited by saying something was wrong — or when
 * `feedbackPolicy` reports a genuine trigger: confusion with no direction, a
 * second regeneration, or a dimension whose evidence contradicts itself. Never
 * on a timer.
 *
 * It sits outside the answer's `Leaf` so it reads as a control rather than as
 * part of what was written, at the same weight as the citation captions above
 * it. One tap ends the interaction either way: no modal, no "tell us more" —
 * the entire value is one bit of evidence at near-zero cost, and anything that
 * makes the tap expensive destroys that trade.
 *
 * The record is optimistic — the acknowledgement appears immediately and a
 * failed request is swallowed. A student who taps "too long" and gets a red
 * toast has been punished for helping, and silently losing one piece of
 * evidence is a rounding error against that.
 */

import { useState } from 'react'
import { sendFeedback, type FeedbackKind } from '../../api/feedback'
import { Icon } from '../../components/ui/Icon'
import { cn } from '../../lib/cn'
import { CHIP_LABEL, REASON_PROMPT, type AskReason } from './feedbackPolicy'

export function FeedbackChips({
  chips,
  reason,
  messageId,
  subspaceId,
  onRecorded,
}: {
  /** Reason chips to offer. May be empty — the thumbs still render. */
  chips: FeedbackKind[]
  /** Why the policy wants to ask, or null when it doesn't. */
  reason: AskReason
  messageId: string
  subspaceId: string
  onRecorded: () => void
}) {
  const [given, setGiven] = useState<FeedbackKind | null>(null)
  /** Set by thumbs-down: the student asked to say more, so chips are welcome. */
  const [invited, setInvited] = useState(false)

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

  // Thumbs-down records nothing on its own. "This was wrong" with no direction
  // is not evidence the preference model can use — it would lower every
  // leading preference a little on no information, which is the right response
  // to a *silent* retry and the wrong one when the student is right there and
  // about to tell you why. So it opens the chips, and the chip carries the
  // signal.
  const showChips = chips.length > 0 && (invited || reason !== null)

  return (
    <div className="flex flex-col gap-1.5 pl-4">
      <div className="flex items-center gap-1">
        <Thumb name="thumbUp" label="This helped" onClick={() => record('useful')} />
        <Thumb
          name="thumbDown"
          label="Something was off"
          active={invited}
          onClick={() => setInvited(true)}
        />
        {invited ? (
          <span className="ml-1.5 text-[11.5px] text-faint">What was off?</span>
        ) : (
          showChips &&
          reason !== null && (
            <span className="ml-1.5 text-[11.5px] text-faint">{REASON_PROMPT[reason]}</span>
          )
        )}
      </div>

      {showChips && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips
            // `useful` is the thumbs-up; offering it twice in one row is noise.
            .filter((kind) => kind !== 'useful')
            .map((kind) => (
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
      )}
    </div>
  )
}

function Thumb({
  name,
  label,
  active = false,
  onClick,
}: {
  name: 'thumbUp' | 'thumbDown'
  label: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'grid h-7 w-7 place-items-center rounded-md transition-colors cursor-pointer',
        // `text-muted`, not `text-faint`. Both clear the contrast floor, but
        // this is the only always-present control on an answer — it has to be
        // findable, not merely legible once you know it is there.
        active ? 'bg-brand-soft text-brand-deep' : 'text-muted hover:bg-line-soft hover:text-ink',
      )}
    >
      <Icon name={name} size={15} filled={active} />
    </button>
  )
}
