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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Map<number, number>>(new Map())

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) window.clearTimeout(timer)
    timers.current.delete(id)
  }, [])

  const show = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = ++counter
      setToasts((prev) => [...prev, { id, kind, message }])
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
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((t) => (
          <button
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={cn(
              'pointer-events-auto max-w-md rounded-xl px-4 py-2.5 text-sm shadow-lg backdrop-blur transition-all cursor-pointer',
              t.kind === 'error' && 'bg-coral-deep text-white',
              t.kind === 'success' && 'bg-mint text-white',
              t.kind === 'info' && 'bg-ink text-white',
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
