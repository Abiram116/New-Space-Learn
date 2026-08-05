/**
 * Minimal modal — trap focus? no. Kill the page scroll while open? yes.
 *
 * If you need multi-step wizards later, swap this for radix-ui/dialog. Right
 * now every use is a small confirm or a tiny form and this is enough.
 */

import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'md',
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  width?: 'sm' | 'md' | 'lg'
}) {
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onEsc)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onEsc)
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-well/80 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={cn(
          'cardstock w-full rounded-2xl shadow-[0_24px_60px_-20px_rgba(0,0,0,0.85)]',
          width === 'sm' && 'max-w-sm',
          width === 'md' && 'max-w-md',
          width === 'lg' && 'max-w-lg',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="border-b border-line px-5 py-3.5">
            <h2 className="nameplate text-[19px] text-ink">{title}</h2>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
