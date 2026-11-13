/**
 * The custom cursor — a dot and a trailing ring that follow the pointer.
 *
 * Lifted out of `features/landing/wow.tsx` so first-run can use it too. It was
 * only ever on the landing page, which meant the product's most distinctive
 * piece of interface disappeared the instant someone signed up — the two
 * screens a new student sees back to back looked like different products.
 *
 * **Where it belongs, and where it does not.** On surfaces that are being
 * *looked at* — the pitch, the intake. Never in the app proper: a screen you
 * work in needs the system cursor and every affordance it carries (the text
 * I-beam, resize handles, the drag states). A custom cursor over a note
 * editor is a costume that costs you information.
 *
 * Hidden entirely on touch (there is no pointer to draw) and under reduced
 * motion (a lagging element that chases you is exactly the complaint).
 *
 * SHAPE: plain — a dot and a ring, nothing drawn onto either one. Several
 * more literal passes went through here (a four-corner viewfinder, a
 * pencil built from angled strokes, the app's own pencil icon) and each
 * got rejected for its own reason — aiming at something, an unclear
 * abstraction, a shape that just wasn't wanted. Landed back on the
 * simplest version on purpose: a dot for precision, a ring that follows a
 * beat behind and reacts to hover/press, no further metaphor riding on top.
 *
 * COLOUR: `mix-blend-mode: difference`, not a fixed cream-or-brand pair.
 * The page has a warm-graphite canvas, a bold-orange close panel, and
 * per-feature tint glows underneath this cursor at different points in the
 * same scroll — no single fixed colour stays legible against all of them.
 * `difference` sidesteps that: the browser computes `|background − cursor|`
 * per pixel as part of normal compositing, so the result is automatically
 * light over dark and dark over light — on video and gradients as much as
 * flat colour — for the cost of one CSS property, no per-frame pixel
 * sampling required. Both colours below have to stay fully opaque for the
 * maths to invert cleanly; an alpha < 1 partially blends with whatever is
 * underneath BEFORE differencing happens, which is why the old hover
 * opacity fade is gone too.
 */

import { useEffect, useRef } from 'react'
import { useReducedMotion } from './motion'

const coarse = () =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

/** What counts as something you can act on. */
const INTERACTIVE = 'a,button,[role="button"],input,textarea,label,select,[tabindex]'

/** How quickly the ring catches the pointer: it closes about two thirds of the gap every `FOLLOW_MS`.
 *  One frame at 60 Hz: the ring sits a hair behind the dot and is on it the moment the hand stops. */
const FOLLOW_MS = 16

const apple = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)

export function DraftingCursor() {
  const dot = useRef<HTMLDivElement>(null)
  const ring = useRef<HTMLDivElement>(null)
  const band = useRef<HTMLDivElement>(null)
  const still = useReducedMotion()
  // `mix-blend-mode: difference` makes the browser re-blend everything under the
  // cursor on every frame. On a Mac's high-density screen, over this page's glows
  // and smooth scrolling, that is what made the cursor feel behind the hand. There
  // it is drawn solid instead, with a thin dark edge so it reads on any background.
  const blend = !apple()

  useEffect(() => {
    if (coarse() || still) return
    let tx = -100
    let ty = -100
    let rx = -100
    let ry = -100
    let hot = false
    let down = false
    let raf = 0
    let last = 0

    const paint = () => {
      if (dot.current) dot.current.style.transform = `translate3d(${tx - 2}px,${ty - 2}px,0)`
      if (ring.current) ring.current.style.transform = `translate3d(${rx - 17}px,${ry - 17}px,0)`
      if (band.current) {
        // Pressing contracts it, which reads as the instrument being set down.
        band.current.style.transform = `scale(${down ? 0.82 : hot ? 1.85 : 1})`
        band.current.style.borderColor = hot ? '#ff5a3c' : '#f5ede4'
      }
    }

    const tick = (now: number) => {
      // The ring still trails, but by time, not by frame: the same short catch-up
      // on a 60 Hz and a 120 Hz screen, and it lands exactly instead of creeping.
      const dt = Math.min(64, now - (last || now))
      last = now
      const k = 1 - Math.exp(-dt / FOLLOW_MS)
      rx += (tx - rx) * k
      ry += (ty - ry) * k
      if (Math.abs(tx - rx) < 0.1 && Math.abs(ty - ry) < 0.1) {
        rx = tx
        ry = ty
        paint()
        raf = 0 // settled: stop until the pointer moves again
        return
      }
      paint()
      raf = requestAnimationFrame(tick)
    }
    const wake = () => {
      if (raf) return
      last = 0
      raf = requestAnimationFrame(tick)
    }

    const onMove = (e: PointerEvent) => {
      tx = e.clientX
      ty = e.clientY
      const t = e.target as Element | null
      hot = !!t?.closest?.(INTERACTIVE)
      // The dot is the pointer: it moves with the event, not a frame later.
      if (dot.current) dot.current.style.transform = `translate3d(${tx - 2}px,${ty - 2}px,0)`
      wake()
    }
    const onDown = () => {
      down = true
      paint()
    }
    const onUp = () => {
      down = false
      paint()
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onDown, { passive: true })
    window.addEventListener('pointerup', onUp, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      cancelAnimationFrame(raf)
    }
  }, [still])

  if (still || coarse()) return null

  const edge = blend ? undefined : '0 0 0 1px rgba(20,15,12,0.55)'
  return (
    <>
      <div
        ref={dot}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[60] h-1 w-1 rounded-full bg-[#f5ede4]"
        style={{ mixBlendMode: blend ? 'difference' : undefined, boxShadow: edge, willChange: 'transform', transform: 'translate3d(-100px,-100px,0)' }}
      />
      {/* Position on the outer element (no transition, so nothing adds delay);
          the press and hover scale on the inner one, where easing belongs. */}
      <div
        ref={ring}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[60] h-[34px] w-[34px]"
        style={{ mixBlendMode: blend ? 'difference' : undefined, willChange: 'transform', transform: 'translate3d(-100px,-100px,0)' }}
      >
        <div
          ref={band}
          className="h-full w-full rounded-full border border-[#f5ede4]"
          style={{ transition: 'transform 140ms ease-out, border-color 220ms ease', boxShadow: edge }}
        />
      </div>
    </>
  )
}
