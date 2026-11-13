/**
 * "Add more questions" / "Add more cards": N more, written into the quiz or
 * deck that already exists, from the same topic, skipping what it already has.
 *
 * Stays open, with its choices intact, when the request fails (a rate limit, a
 * source with nothing in it), so the student can change the source and try
 * again without re-entering anything.
 */

import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { rememberSource, rememberedSource, SourcePicker, sourceReady, type PickedSource } from './SourcePicker'

export function AddMoreModal({
  open,
  kind,
  name,
  topicId,
  max,
  onClose,
  onAdd,
}: {
  open: boolean
  kind: 'quiz' | 'deck'
  /** The quiz or deck's name, for the title. */
  name: string
  /** Its topic: whose notes the source picker offers. */
  topicId: string
  /** The most that can be asked for at once (the server's cap). */
  max: number
  onClose: () => void
  onAdd: (count: number, source: PickedSource) => Promise<void>
}) {
  const noun = kind === 'quiz' ? 'questions' : 'cards'
  const [count, setCount] = useState(Math.min(5, max))
  const [source, setSource] = useState<PickedSource>(rememberedSource)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const { showError } = useToast()

  useEffect(() => {
    if (open) {
      setCount(Math.min(5, max))
      setSource(rememberedSource())
    }
  }, [open, max])

  const submit = async () => {
    // A double-click must not pay for (and append) two batches.
    if (inFlight.current || !sourceReady(source) || max < 1) return
    inFlight.current = true
    setBusy(true)
    try {
      rememberSource(source)
      await onAdd(count, source)
    } catch (err) {
      showError(err)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title={`Add ${noun} to “${name}”`} width="sm">
      <div className="flex flex-col gap-4">
        {max < 1 ? (
          <p className="text-[13px] text-muted">
            This {kind} is as big as one gets. Start a new {kind} for more.
          </p>
        ) : (
          <>
            <p className="text-[13px] leading-relaxed text-muted">
              New {noun} on the same subject, skipping what this {kind} already has. They go at the end.
            </p>
            <SourcePicker topicId={topicId} value={source} onChange={setSource} />
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`add-${kind}-count`} className="setcode">
                How many
              </label>
              <div className="flex items-center gap-3">
                <input
                  id={`add-${kind}-count`}
                  type="range"
                  min={1}
                  max={max}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  className="flex-1 accent-[var(--color-brand)]"
                />
                <span className="nameplate w-8 text-right text-[22px] tabular-nums text-brand">{count}</span>
              </div>
            </div>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {max >= 1 && (
            <Button onClick={submit} disabled={busy || !sourceReady(source)}>
              {busy ? 'Writing…' : `Add ${count} ${noun}`}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
