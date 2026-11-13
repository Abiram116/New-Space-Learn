/**
 * Two small lines a review session can show, on desktop and phone alike:
 * what the four grades mean (once, on a student's first review on this
 * device), and how many grades have not reached the server yet.
 */

import { useState, useSyncExternalStore } from 'react'
import { onUnsavedGrades, retryUnsavedGrades, unsavedGradeCount } from '../../api/flashcards'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { cn } from '../../lib/cn'
import { seenOnce } from '../quizzes/phoneKit'

const GRADE_HELP_KEY = 'sl:tip:cards-grade-meaning-v1'

/**
 * Whether to explain the grades. True for the whole of the first review on
 * this device; `markSeen` (called on the first grade) stops it coming back in
 * a later session without pulling it away mid-read, and `dismiss` hides it now.
 */
export function useGradeHelp(): { show: boolean; markSeen: () => void; dismiss: () => void } {
  const [show, setShow] = useState(() => !seenOnce(GRADE_HELP_KEY).seen)
  return {
    show,
    markSeen: () => seenOnce(GRADE_HELP_KEY).mark(),
    dismiss: () => {
      seenOnce(GRADE_HELP_KEY).mark()
      setShow(false)
    },
  }
}

export function GradeHelp({ onDismiss, className }: { onDismiss: () => void; className?: string }) {
  return (
    <div
      role="note"
      className={cn('flex items-start gap-2 rounded-[11px] border border-line bg-well/60 py-1.5 pl-3 pr-1', className)}
    >
      <p className="min-w-0 flex-1 py-1 text-[13px] leading-snug text-muted">
        <strong className="font-semibold text-ink-3">Again</strong>: forgot it.{' '}
        <strong className="font-semibold text-ink-3">Hard</strong>: got it, slowly.{' '}
        <strong className="font-semibold text-ink-3">Good</strong>: knew it.{' '}
        <strong className="font-semibold text-ink-3">Easy</strong>: knew it at once. The time under
        each is when the card comes back.
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Got it, hide this"
        className="phone-tap grid size-9 shrink-0 place-items-center rounded-md text-faint hover:bg-line-soft hover:text-ink-3"
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  )
}

/** Grades that have not been saved yet, kept current as they get through. */
export function useUnsavedGrades(): number {
  return useSyncExternalStore(onUnsavedGrades, unsavedGradeCount, () => 0)
}

/** Short enough for the phone's hint line. */
export const unsavedLine = (n: number): string =>
  `${n} grade${n === 1 ? '' : 's'} not saved yet. Sent when you are back online.`

/**
 * The summary's honest footnote: how many grades are still not saved, and a
 * way to send them now. Renders nothing once they are all in.
 */
export function UnsavedGrades({ onSaved, className }: { onSaved?: () => void; className?: string }) {
  const count = useUnsavedGrades()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  if (count === 0) return null

  const retry = async () => {
    setBusy(true)
    setFailed(false)
    const left = await retryUnsavedGrades()
    setBusy(false)
    setFailed(left > 0)
    if (left < count) onSaved?.()
  }

  return (
    <div
      role="status"
      className={cn('flex flex-col items-center gap-2 rounded-xl bg-sun-soft px-4 py-3 text-sun-deep', className)}
    >
      <p className="text-[13.5px] leading-snug">
        {count} grade{count === 1 ? ' is' : 's are'} not saved yet, so{' '}
        {count === 1 ? 'that card stays' : 'those cards stay'} due. Keep this page open:{' '}
        {count === 1 ? 'it is' : 'they are'} sent when you are back online.
        {failed && ' That did not work yet.'}
      </p>
      <Button variant="secondary" size="sm" onClick={() => void retry()} disabled={busy}>
        {busy ? 'Saving…' : 'Try saving again'}
      </Button>
    </div>
  )
}
