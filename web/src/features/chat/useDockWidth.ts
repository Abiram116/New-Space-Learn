import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A user-resizable dock width, remembered between sessions.
 *
 * Once the dock stops being a fixed strip of context and starts holding real
 * work — a note being edited, a document list — one width cannot suit both
 * "glance at sources" and "write in here for ten minutes". So it is dragged,
 * and the choice sticks.
 *
 * The drag deliberately does **not** run through React state per frame:
 * `onPointerMove` writes the pixel value straight to the element, and state is
 * updated once on release. Re-rendering a panel full of content on every
 * mousemove is what makes a resize handle feel like it is dragging through
 * treacle.
 */

const KEY = 'sl:dock-width'
/** Narrower and the title, the buttons and the tiles start to wrap. */
export const DOCK_MIN = 300
/** Wider and the sidebar stops being a sidebar: its content is built for a column,
 *  and the chat is the thing the page is for. */
export const DOCK_MAX = 440
export const DOCK_DEFAULT = 320
/** What the chat and the left navigation need, so a wide sidebar never squeezes them out. */
const KEEP_FOR_CHAT = 700

/** The widest the sidebar may be right now: the ceiling, or less on a narrow window. */
export function maxWidth(viewport: number = typeof window === 'undefined' ? 1600 : window.innerWidth): number {
  return Math.max(DOCK_MIN, Math.min(DOCK_MAX, viewport - KEEP_FOR_CHAT))
}

/** Any width, brought inside the limits. People may drag as they like within them. */
export function clamp(px: number, viewport?: number): number {
  return Math.min(maxWidth(viewport), Math.max(DOCK_MIN, px))
}

function read(): number {
  if (typeof window === 'undefined') return DOCK_DEFAULT
  const raw = Number(window.localStorage.getItem(KEY))
  return Number.isFinite(raw) && raw > 0 ? clamp(raw) : DOCK_DEFAULT
}

export function useDockWidth() {
  const [width, setWidth] = useState<number>(read)
  const ref = useRef<HTMLElement | null>(null)
  const [dragging, setDragging] = useState(false)

  // A window made narrower after the sidebar was widened: bring it back inside.
  useEffect(() => {
    const fit = () => setWidth((w) => clamp(w))
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault()
      const startX = event.clientX
      const startW = ref.current?.getBoundingClientRect().width ?? width
      let latest = startW
      setDragging(true)

      const move = (e: PointerEvent) => {
        // The handle is on the dock's LEFT edge, so dragging left widens it.
        latest = clamp(startW + (startX - e.clientX))
        if (ref.current) ref.current.style.width = `${latest}px`
      }
      const up = () => {
        setDragging(false)
        setWidth(latest)
        try {
          window.localStorage.setItem(KEY, String(latest))
        } catch {
          // Private mode or a full quota. A width that does not persist is a
          // far smaller problem than a resize handle that throws.
        }
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [width],
  )

  // Text selection during a drag turns the whole page blue and makes the
  // gesture feel broken.
  useEffect(() => {
    if (!dragging) return
    const prev = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    return () => {
      document.body.style.userSelect = prev
      document.body.style.cursor = ''
    }
  }, [dragging])

  /** Keyboard resize, so the dock is not mouse-only. */
  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 48 : 16
    let next: number | null = null
    if (event.key === 'ArrowLeft') next = clamp(width + step)
    if (event.key === 'ArrowRight') next = clamp(width - step)
    if (next === null) return
    event.preventDefault()
    setWidth(next)
    try {
      window.localStorage.setItem(KEY, String(next))
    } catch {
      /* see above */
    }
  }, [width])

  return { width, ref, dragging, onPointerDown, onKeyDown }
}
