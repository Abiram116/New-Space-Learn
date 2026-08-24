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
 * simplest version on purpose: a dot for precision, a ring that lags and
 * reacts to hover/press for feel, no further metaphor riding on top.
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

export function DraftingCursor() {
  const dot = useRef<HTMLDivElement>(null)
  const ring = useRef<HTMLDivElement>(null)
  const still = useReducedMotion()

  useEffect(() => {
    if (coarse() || still) return
    let tx = -100
    let ty = -100
    let rx = -100
    let ry = -100
    let hot = false
    let down = false
    let raf = 0

    const onMove = (e: PointerEvent) => {
      tx = e.clientX
      ty = e.clientY
      const t = e.target as Element | null
      hot = !!t?.closest?.(INTERACTIVE)
    }
    const onDown = () => {
      down = true
    }
    const onUp = () => {
      down = false
    }

    const tick = () => {
      // The ring trails the dot rather than tracking it. The lag is the whole
      // character: a rigid ring is a cursor, a trailing one is an instrument
      // being moved across a surface.
      rx += (tx - rx) * 0.16
      ry += (ty - ry) * 0.16

      if (dot.current) {
        dot.current.style.transform = `translate3d(${tx - 2}px,${ty - 2}px,0)`
      }
      if (ring.current) {
        // Pressing contracts it, which reads as the instrument being set down.
        // Without this a click has no cursor-side feedback at all, and the
        // ring feels painted on rather than held.
        const scale = down ? 0.82 : hot ? 1.85 : 1
        ring.current.style.transform = `translate3d(${rx - 17}px,${ry - 17}px,0) scale(${scale})`
        // Solid, full opacity — see the header note on why `difference`
        // needs that to invert cleanly.
        ring.current.style.borderColor = hot ? '#ff5a3c' : '#f5ede4'
      }
      raf = requestAnimationFrame(tick)
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onDown, { passive: true })
    window.addEventListener('pointerup', onUp, { passive: true })
    raf = requestAnimationFrame(tick)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      cancelAnimationFrame(raf)
    }
  }, [still])

  if (still || coarse()) return null

  return (
    <>
      <div
        ref={dot}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[60] h-1 w-1 rounded-full bg-[#f5ede4]"
        style={{ mixBlendMode: 'difference' }}
      />
      <div
        ref={ring}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[60] h-[34px] w-[34px] rounded-full border"
        style={{
          transition: 'transform 120ms linear, border-color 220ms ease',
          mixBlendMode: 'difference',
        }}
      />
    </>
  )
}
