/**
 * The drafting reticle — a registration mark that follows the pointer.
 *
 * Lifted out of `features/landing/wow.tsx` so first-run can use it too. It was
 * only ever on the landing page, which meant the product's most distinctive
 * piece of interface disappeared the instant someone signed up — the two
 * screens a new student sees back to back looked like different products.
 *
 * **Where it belongs, and where it does not.** On surfaces that are being
 * *looked at* — the pitch, the intake. Never in the app proper: a screen you
 * work in needs the system cursor and every affordance it carries (the text
 * I-beam, resize handles, the drag states). A reticle over a note editor is a
 * costume that costs you information.
 *
 * Hidden entirely on touch (there is no pointer to draw) and under reduced
 * motion (a lagging element that chases you is exactly the complaint).
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
        // reticle feels painted on rather than held.
        const scale = down ? 0.82 : hot ? 1.85 : 1
        ring.current.style.transform = `translate3d(${rx - 17}px,${ry - 17}px,0) scale(${scale})`
        ring.current.style.opacity = hot ? '1' : '0.7'
        ring.current.style.borderColor = hot
          ? 'rgba(255,90,60,0.85)'
          : 'rgba(245,237,228,0.34)'
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
        className="pointer-events-none fixed left-0 top-0 z-[60] h-1 w-1 rounded-full bg-brand"
      />
      {/* A ring with four registration ticks, not a plain circle. The ticks are
          what make it read as a drafting mark being aligned over the page
          rather than as a generic custom cursor. */}
      <div
        ref={ring}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[60] h-[34px] w-[34px] rounded-full border"
        style={{ transition: 'transform 120ms linear, border-color 220ms ease, opacity 220ms ease' }}
      >
        {[
          'left-1/2 top-[-5px] h-[4px] w-px -translate-x-1/2',
          'left-1/2 bottom-[-5px] h-[4px] w-px -translate-x-1/2',
          'top-1/2 left-[-5px] w-[4px] h-px -translate-y-1/2',
          'top-1/2 right-[-5px] w-[4px] h-px -translate-y-1/2',
        ].map((pos) => (
          <span key={pos} className={`absolute bg-[rgba(245,237,228,0.45)] ${pos}`} />
        ))}
      </div>
    </>
  )
}
