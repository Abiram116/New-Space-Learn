import { Modal, ModalFooter } from './Modal'
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
            onClick={onConfirm}
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
