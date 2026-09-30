/**
 * Minimal modal — traps focus and returns it on close. Kills the page scroll
 * while open.
 *
 * If you need multi-step wizards later, swap this for radix-ui/dialog. Right
 * now every use is a small confirm or a tiny form and this is enough.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'
import { Icon } from './Icon'

// `tabindex="-1"` opts a control out of the trap — the header's × uses it, so
// it never becomes "the first focusable" that steals focus from the form.
const FOCUSABLE =
  'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'md',
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /**
   * The action row, pinned to the bottom of the panel while the body scrolls.
   * Pass a `ModalFooter`. Long forms used to push Save off the bottom of a
   * phone screen; a pinned footer keeps the one primary action in reach.
   */
  footer?: ReactNode
  width?: 'sm' | 'md' | 'lg'
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Focus moves into the dialog on open and back to whatever had it when
    // the dialog closes — otherwise it silently resets to <body> and a
    // keyboard/screen-reader user loses their place in the page underneath.
    const previouslyFocused = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusable.length === 0) return
      const firstEl = focusable[0]
      const lastEl = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
      previouslyFocused?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      // Same beat as every other overlay in the app (`AttachmentViewer`,
      // the dock panel) rather than a hard pop — one shared entrance for
      // "something now covers the screen", reusing the existing keyframe
      // instead of inventing a modal-specific one.
      className="fixed inset-0 z-40 flex items-center justify-center bg-well/80 p-4 backdrop-blur-[2px] motion-safe:animate-[dockSwap_180ms_var(--ease-sl)_both]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          // Column + max-height: the header and footer stay put, only the body
          // scrolls. `dvh` so a phone's collapsing URL bar cannot hide the footer.
          'cardstock flex max-h-[calc(100dvh-2rem)] w-full flex-col rounded-2xl shadow-[0_24px_60px_-20px_rgba(0,0,0,0.85)] focus:outline-none',
          width === 'sm' && 'max-w-sm',
          width === 'md' && 'max-w-md',
          width === 'lg' && 'max-w-lg',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex shrink-0 items-center gap-3 border-b border-line py-3 pl-5 pr-3">
            <h2 className="nameplate min-w-0 flex-1 text-[19px] leading-tight text-ink">{title}</h2>
            {/* Pointer/touch affordance only: keyboard users have Escape, and
                tabindex -1 keeps this out of the focus trap (see FOCUSABLE). */}
            <button
              type="button"
              tabIndex={-1}
              onClick={onClose}
              aria-label="Close dialog"
              className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-lg text-faint transition-colors hover:bg-line-soft hover:text-ink"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-line px-5 py-3.5">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/**
 * The modal action row. The rules, so every dialog agrees:
 *
 *  - Primary on the RIGHT, Cancel immediately to its left. DOM order is the
 *    visual order (Cancel, then primary) so Tab moves the way the eye does.
 *  - A destructive action that is NOT the primary goes in `start`, pinned to
 *    the opposite edge — never adjacent to the primary.
 *  - On a phone the pair shares the row equally, so both stay thumb-sized.
 */
export function ModalFooter({
  start,
  children,
  className,
}: {
  /** Left-anchored slot for a destructive or tertiary action. */
  start?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {start && <div className="mr-auto shrink-0">{start}</div>}
      <div className={cn('flex items-center gap-2 max-sm:flex-1 max-sm:[&>*]:flex-1', !start && 'ml-auto max-sm:ml-0')}>
        {children}
      </div>
    </div>
  )
}
