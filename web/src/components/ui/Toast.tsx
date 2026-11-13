/**
 * Tiny toast system. One provider at the root; anything else calls `useToast`.
 *
 * We intentionally don't add a queue-with-priorities or slick spring animations
 * — this is a fallback surface for errors we couldn't recover from. It should
 * fade in, be readable, and get out of the way.
 */

import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { friendlyMessage } from '../../api/errors'

type ToastKind = 'info' | 'success' | 'error'

type Toast = {
  id: number
  kind: ToastKind
  message: string
}

type ToastCtx = {
  show: (message: string, kind?: ToastKind) => void
  showError: (err: unknown) => void
}

const Ctx = createContext<ToastCtx | null>(null)

let counter = 0

/** Most on screen at once. A failing screen can raise one per request; past
 *  this the oldest gives way rather than the stack climbing over the page. */
const MAX_TOASTS = 3

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Map<number, number>>(new Map())
  // What is showing, readable synchronously: `show` has to decide against the
  // current list, and two calls in one tick would both see a stale `toasts`.
  const showing = useRef<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    showing.current = showing.current.filter((t) => t.id !== id)
    setToasts(showing.current)
    const timer = timers.current.get(id)
    if (timer) window.clearTimeout(timer)
    timers.current.delete(id)
  }, [])

  const show = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      // The same thing said again while it is still up (five requests failing
      // for one reason) keeps the one toast and restarts its clock.
      const same = showing.current.find((t) => t.message === message && t.kind === kind)
      const id = same ? same.id : ++counter
      if (same) {
        window.clearTimeout(timers.current.get(id))
      } else {
        const next = [...showing.current, { id, kind, message }]
        for (const dropped of next.splice(0, Math.max(0, next.length - MAX_TOASTS))) {
          window.clearTimeout(timers.current.get(dropped.id))
          timers.current.delete(dropped.id)
        }
        showing.current = next
        setToasts(next)
      }
      const timer = window.setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 3500)
      timers.current.set(id, timer)
    },
    [dismiss],
  )

  const showError = useCallback(
    (err: unknown) => show(friendlyMessage(err), 'error'),
    [show],
  )

  // Catch unhandled promise rejections so nothing bubbles to the console for
  // the user to see. This is a defensive fallback — call `showError` directly
  // in your catch blocks whenever you can, because it's more targeted.
  useEffect(() => {
    const onRej = (e: PromiseRejectionEvent) => {
      if (e.reason instanceof Error) e.preventDefault()
      showError(e.reason)
    }
    window.addEventListener('unhandledrejection', onRej)
    return () => window.removeEventListener('unhandledrejection', onRej)
  }, [showError])

  useEffect(() => {
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t))
      timers.current.clear()
    }
  }, [])

  return (
    <Ctx.Provider value={{ show, showError }}>
      {children}
      {/* `--sl-toast-lift` is set by the phone shell to clear its bottom tab
          bar; unset (0) everywhere else, so desktop sits where it always has. */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+var(--sl-toast-lift,0px))] z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((t) => (
          <button
            key={t.id}
            onClick={() => dismiss(t.id)}
            /* Dark fill, light tinted text — the same soft/deep pairing the
               flashcard grade buttons use, rather than a one-off colour.
               White on the bright tones measured 1.2–2.0:1 (and `bg-ink` is
               a near-white token, so the info toast was white-on-white at
               1.16:1). These pairings measure 8.5–12.2:1. */
            className={cn(
              // `anywhere`: a long unbroken string (a file name, an address) wraps
              // inside the toast instead of pushing it off the side of a phone.
              'pointer-events-auto max-w-md rounded-xl border px-4 py-2.5 text-sm shadow-lg backdrop-blur t-move cursor-pointer [overflow-wrap:anywhere]',
              t.kind === 'error' && 'border-coral/30 bg-coral-soft text-coral-deep',
              t.kind === 'success' && 'border-mint/30 bg-mint-soft text-mint-deep',
              t.kind === 'info' && 'border-line-dash bg-line text-ink',
            )}
          >
            {t.message}
          </button>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
