import { Modal } from './Modal'
import { Button } from './Button'

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
  return (
    <Modal open={open} onClose={onCancel} title={title} width="sm">
      <div className="flex flex-col gap-4">
        {description && <p className="text-sm text-muted">{description}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={loading}
            className={destructive ? 'bg-coral-deep hover:bg-coral-deep/90' : undefined}
          >
            {loading ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
