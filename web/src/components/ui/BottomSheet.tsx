/**
 * A sheet that rises from the bottom edge — the phone's dialog.
 *
 *     <BottomSheet open={open} onClose={close} title="Topics" footer={<Button>…</Button>}>
 *       …scrolling body…
 *     </BottomSheet>
 *
 * Props: `open`, `onClose`, optional `title`, optional `footer` (pinned under
 * the scrolling body, safe-area aware), optional `compact` (tighter body, for
 * confirmations), optional `className` on the panel.
 *
 * What it does, so callers don't have to:
 *   - Portals to <body>, locks the page scroll, traps focus, returns focus to
 *     whatever opened it, closes on Escape and on a backdrop tap.
 *   - Drag the handle or header down to dismiss (pointer events; only
 *     `transform` moves, so it stays on the compositor). The thresholds live
 *     in `sheetDrag.ts`, tested on their own.
 *   - Never taller than 85dvh, and lifted above the on-screen keyboard where
 *     the browser lets the keyboard cover the page (iOS).
 *   - Honours reduced motion: it appears and disappears without travelling.
 *
 * `Modal` renders through this automatically on phones, so every existing
 * dialog is already a sheet there. Reach for BottomSheet directly only for
 * phone-only UI.
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'
import { Icon } from './Icon'
import { useReducedMotion } from './motion'
import { backdropOpacity, sheetDragOffset, shouldDismissSheet } from './sheetDrag'
import { useKeyboard } from './useKeyboard'

const FOCUSABLE =
  'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Long enough for the slide out; the element stays mounted until it ends. */
const EXIT_MS = 240

type Drag = { startY: number; lastY: number; lastT: number; velocity: number; pointerId: number }

export function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
  compact = false,
  className,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /** Pinned under the body; stays in reach while the body scrolls. */
  footer?: ReactNode
  /** Tighter spacing for a one-line confirmation. */
  compact?: boolean
  className?: string
}) {
  const reduced = useReducedMotion()
  const keyboard = useKeyboard()
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  // The latest onClose without re-running the focus effect every render —
  // callers routinely pass an inline arrow.
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  // Mount → paint off-screen → slide in. Close → slide out → unmount.
  useEffect(() => {
    if (open) {
      setMounted(true)
      if (reduced) {
        setShown(true)
        return
      }
      const raf = window.requestAnimationFrame ?? ((cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 16))
      const caf = window.cancelAnimationFrame ?? window.clearTimeout
      let inner = 0
      const outer = raf(() => {
        inner = raf(() => setShown(true))
      })
      return () => {
        caf(outer)
        caf(inner)
      }
    }
    setShown(false)
    const t = window.setTimeout(() => setMounted(false), reduced ? 0 : EXIT_MS)
    return () => window.clearTimeout(t)
  }, [open, reduced])

  // Focus in, trap, Escape, scroll lock — for as long as it is open.
  useEffect(() => {
    if (!open || !mounted) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const previouslyFocused = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel)?.focus({ preventScroll: true })

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeRef.current()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusable.length === 0) {
        e.preventDefault()
        return
      }
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
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.({ preventScroll: true })
    }
  }, [open, mounted])

  const setOffset = useCallback((offset: number) => {
    const panel = panelRef.current
    if (!panel) return
    panel.style.transform = `translate3d(0, ${offset}px, 0)`
    if (backdropRef.current) {
      backdropRef.current.style.opacity = String(backdropOpacity(offset, panel.offsetHeight))
    }
  }, [])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Primary button / a finger only, and never when the press began on a
    // control inside the header (the close button).
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    drag.current = { startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, velocity: 0, pointerId: e.pointerId }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    if (panelRef.current) panelRef.current.style.transition = 'none'
    if (backdropRef.current) backdropRef.current.style.transition = 'none'
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    const dt = Math.max(1, e.timeStamp - d.lastT)
    // Smoothed so one jittery sample at release can't decide the outcome.
    d.velocity = 0.7 * ((e.clientY - d.lastY) / dt) + 0.3 * d.velocity
    d.lastY = e.clientY
    d.lastT = e.timeStamp
    setOffset(sheetDragOffset(e.clientY - d.startY))
  }

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    drag.current = null
    const panel = panelRef.current
    if (!panel) return
    panel.style.transition = ''
    if (backdropRef.current) backdropRef.current.style.transition = ''
    const dy = e.clientY - d.startY
    if (shouldDismissSheet({ dy, velocity: d.velocity, height: panel.offsetHeight })) {
      // The parent flips `open`, and React's `shown=false` transform carries
      // the sheet the rest of the way out from wherever the finger left it.
      closeRef.current()
    } else {
      setOffset(0)
    }
  }

  if (!mounted) return null

  const lift = keyboard.open ? keyboard.inset : 0

  return createPortal(
    <div className="fixed inset-0 z-40 flex flex-col justify-end" data-sheet-root="">
      <div
        ref={backdropRef}
        aria-hidden
        onClick={() => closeRef.current()}
        className={cn(
          'absolute inset-0 bg-well/80 backdrop-blur-[2px] transition-opacity duration-200 ease-out',
          shown ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'cardstock relative mx-auto flex w-full max-w-xl flex-col rounded-t-[22px] border-b-0 focus:outline-none',
          'max-h-[85dvh] shadow-[0_-18px_48px_-20px_rgba(0,0,0,0.85)]',
          'transition-transform duration-300 ease-[var(--ease-out-expo)] will-change-transform',
          className,
        )}
        style={{
          transform: shown ? 'translate3d(0, 0px, 0)' : 'translate3d(0, 100%, 0)',
          marginBottom: lift || undefined,
          maxHeight: keyboard.open ? Math.max(200, keyboard.visibleHeight - 12) : undefined,
        }}
      >
        {/* Drag zone: the handle and the header. The body is left alone so
            its own scrolling never fights the gesture. */}
        <div
          className="shrink-0 touch-none select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div className="flex h-6 items-end justify-center" aria-hidden>
            <span className="h-[5px] w-10 rounded-full bg-line-dash" />
          </div>
          {title && (
            <div className="flex items-center gap-3 pb-1 pl-5 pr-2 pt-2">
              <h2 className="nameplate min-w-0 flex-1 truncate text-[20px] leading-tight text-ink">{title}</h2>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => closeRef.current()}
                aria-label="Close"
                className="t-control grid h-11 w-11 shrink-0 place-items-center rounded-full text-faint active:bg-line-soft"
              >
                <Icon name="close" size={17} />
              </button>
            </div>
          )}
        </div>

        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto overscroll-contain px-5',
            compact ? 'pb-3 pt-1' : 'pb-4 pt-2',
            !footer && 'pb-[max(16px,env(safe-area-inset-bottom))]',
          )}
        >
          {children}
        </div>

        {footer && (
          <div className="shrink-0 border-t border-line px-5 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
