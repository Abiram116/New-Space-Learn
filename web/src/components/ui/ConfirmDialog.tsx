import { useEffect, useRef } from 'react'
import { Modal, ModalFooter } from './Modal'
import { Button } from './Button'

/** Longer than a double-click, shorter than changing your mind. */
const DOUBLE_PRESS_MS = 500

/** Destructive-action confirmation. Copy stays neutral; caller supplies verb. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  destructive = false,
  loading = false,
}: {
  open: boolean
  title: string
  description?: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  destructive?: boolean
  loading?: boolean
}) {
  // One press, one action. `loading` covers a caller that sets it, but only
  // from the next render: a double-click, or Enter held down on the button,
  // lands a second press before then, and on a phone the sheet is still
  // tappable while it slides away. So a press is ignored while the previous
  // one is still being handled: until its promise settles when the caller
  // returned one, and for a double-click's length either way.
  const held = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  // Each time it opens it is a new question: a slow request from the last one
  // (callers often close first and delete after) must not swallow this press.
  useEffect(() => {
    if (open) held.current = false
  }, [open])
  const confirm = () => {
    if (held.current) return
    held.current = true
    let settled = false
    let waited = false
    const release = () => {
      if (settled && waited) held.current = false
    }
    timer.current = window.setTimeout(() => {
      waited = true
      release()
    }, DOUBLE_PRESS_MS)
    const done = () => {
      settled = true
      release()
    }
    try {
      // Typed `() => void`, but callers routinely pass an async function.
      const result: unknown = (onConfirm as () => unknown)()
      if (result instanceof Promise) result.then(done, done)
      else done()
    } catch (err) {
      done()
      throw err
    }
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      width="sm"
      footer={
        <ModalFooter>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          {/* The destructive button is labelled with the verb ("Delete"), and
              holds its width while loading so the row does not jump. */}
          <Button
            onClick={confirm}
            disabled={loading}
            variant={destructive ? 'danger' : 'primary'}
            className="min-w-28"
          >
            {loading ? 'Working…' : confirmLabel}
          </Button>
        </ModalFooter>
      }
    >
      {description && <p className="text-[14px] leading-relaxed text-muted">{description}</p>}
    </Modal>
  )
}
